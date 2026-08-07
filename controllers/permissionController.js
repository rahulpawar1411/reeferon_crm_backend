// ====================================================================
// Permission Requests Controller
// (backend/controllers/permissionController.js)
// Implements secure workflow for DO operators to request edit/delete permissions
// and for Super Admins to approve/deny them, using ONLY the existing
// do_operator_activities table! No separate requests table is needed.
// ====================================================================

const db = require('../config/db');
const { logActivity, extractRemark, getActorLabel } = require('../utils/logger');
const { handleControllerError } = require('../utils/errorHandler');

/**
 * On Super Admin approve of Chamber Add: create chamber (if needed) and raise DO chamber_limit
 * so Registered Operators Directory + mobile GET /api/chambers stay in sync.
 */
async function applyApprovedChamberAdd(operatorEmail, requestDescription, recordId) {
  const desc = String(requestDescription || '');
  const nameMatch = desc.match(/ADD chamber "([^"]+)"/i);
  const remarkMatch = desc.match(/Remark:\s*(.+)$/i);
  const name = (nameMatch?.[1] || '').trim();
  if (!name) {
    return { ok: false, reason: 'missing_name' };
  }

  const { chamberAddPermissionId, pickDoChambers } = require('./chamberController');
  const expectedId = chamberAddPermissionId(name);
  if (Number(recordId) !== Number(expectedId)) {
    // Still allow if description has the name (legacy / hash drift)
  }

  let chamberId = null;
  const [dup] = await db.query('SELECT id, name FROM chambers WHERE name = ? LIMIT 1', [name]);
  if (dup.length > 0) {
    chamberId = dup[0].id;
  } else {
    const [result] = await db.query('INSERT INTO chambers (name) VALUES (?)', [name]);
    chamberId = result.insertId;
  }

  const [userRows] = await db.query(
    'SELECT chamber_limit FROM do_operators WHERE email = ? LIMIT 1',
    [operatorEmail]
  );
  let limit = parseInt(userRows[0]?.chamber_limit || 4, 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 4;

  const [all] = await db.query('SELECT id, name FROM chambers ORDER BY id ASC');
  let picked = pickDoChambers(all, limit);
  const included = picked.some((c) => Number(c.id) === Number(chamberId));
  if (!included) {
    let newLimit = Math.min(50, Math.max(limit + 1, picked.length + 1));
    while (
      newLimit <= 50 &&
      !pickDoChambers(all, newLimit).some((c) => Number(c.id) === Number(chamberId))
    ) {
      newLimit += 1;
    }
    await db.query(
      'UPDATE do_operators SET chamber_limit = ? WHERE email = ?',
      [newLimit, operatorEmail]
    );
    limit = newLimit;
  }

  try {
    const actorLabel = operatorEmail;
    await logActivity(
      operatorEmail,
      'ADD_CHAMBER',
      'Chamber Master',
      `Super Admin approved add of chamber "${name}" (id: ${chamberId}) for ${actorLabel}${
        remarkMatch?.[1] ? `. Remark: ${remarkMatch[1].trim()}` : ''
      }. Limit now ${limit}.`
    );
  } catch (_) {}

  return {
    ok: true,
    id: chamberId,
    name,
    chamber_limit: limit,
    remark: (remarkMatch?.[1] || '').trim()
  };
}

// 1. GET ALL OR USER-SPECIFIC PERMISSION REQUESTS
exports.getPermissionRequests = async (req, res) => {
  try {
    let rows;
    const selectCols = `
        SELECT a.id, a.operator_email, a.log_type AS record_type, a.permission_req AS record_id, a.action AS raw_action,
               CASE 
                 WHEN a.action IN ('REQUEST_EDIT', 'REQUEST_DELETE') THEN 'Pending'
                 WHEN a.action IN ('GRANT_PERMISSION', 'GRANT_DELETE') THEN 'Approved'
                 WHEN a.action IN ('USE_EDIT_PERMISSION', 'USE_DELETE_PERMISSION') THEN 'Used'
                 ELSE 'Denied'
               END AS status,
               a.description, a.remark, a.created_at, a.do_action_completed_at,
               r.description AS request_description,
               r.remark AS request_remark,
               c.chamber_id, c.chamber_name, c.client_name, c.shift, c.entry_date,
               c.reference_no AS log_reference_no
        FROM do_operator_activities a
        LEFT JOIN do_operator_activities r ON r.operator_email = a.operator_email 
          AND r.log_type = a.log_type 
          AND r.permission_req = a.permission_req
          AND r.action IN ('REQUEST_EDIT', 'REQUEST_DELETE')
        LEFT JOIN daily_chamber_temp_logs c
          ON a.log_type = 'Chamber' AND c.id = a.permission_req
    `;

    if (req.user.role === 'super_admin') {
      [rows] = await db.query(`
        ${selectCols}
        WHERE a.id IN (
          SELECT MAX(id)
          FROM do_operator_activities
          WHERE action IN ('REQUEST_EDIT', 'REQUEST_DELETE', 'GRANT_PERMISSION', 'GRANT_DELETE', 'DENY_PERMISSION', 'DENY_DELETE', 'USE_EDIT_PERMISSION', 'USE_DELETE_PERMISSION')
          GROUP BY operator_email, log_type, permission_req
        )
        ORDER BY a.id DESC
      `);
    } else {
      [rows] = await db.query(`
        ${selectCols}
        WHERE a.operator_email = ? 
          AND a.id IN (
            SELECT MAX(id)
            FROM do_operator_activities
            WHERE action IN ('REQUEST_EDIT', 'REQUEST_DELETE', 'GRANT_PERMISSION', 'GRANT_DELETE', 'DENY_PERMISSION', 'DENY_DELETE', 'USE_EDIT_PERMISSION', 'USE_DELETE_PERMISSION')
            GROUP BY operator_email, log_type, permission_req
          )
        ORDER BY a.id DESC
      `, [req.user.email]);
    }
    return res.json(rows);
  } catch (err) {
    return handleControllerError(res, err, {
      checkpoint: 'getPermissionRequests',
      req,
      clientMessage: 'Failed to fetch permission requests.'
    });
  }
};

// 2. CREATE A NEW PERMISSION REQUEST (Edit or Delete)
exports.createPermissionRequest = async (req, res) => {
  try {
    const { record_type, record_id, action = 'Edit', description, remark } = req.body;
    const operator_email = req.user.email;

    if (!record_type || !record_id) {
      return res.status(400).json({ error: 'Record type and Record ID are required.' });
    }

    const reqActionType = action === 'Edit' ? 'REQUEST_EDIT' : 'REQUEST_DELETE';
    const grantActionType = action === 'Edit' ? 'GRANT_PERMISSION' : 'GRANT_DELETE';

    // Check the latest action status for this record
    const [existing] = await db.query(`
      SELECT action, id FROM do_operator_activities
      WHERE operator_email = ? AND log_type = ? AND permission_req = ?
      ORDER BY id DESC LIMIT 1
    `, [operator_email, record_type, record_id]);

    if (existing.length > 0) {
      const latestAction = existing[0].action;
      if (latestAction === reqActionType) {
        return res.status(400).json({ 
          error: `A permission request for this record is already pending approval.`, 
          request: { status: 'Pending' } 
        });
      }
      if (latestAction === grantActionType) {
        return res.status(400).json({ 
          error: `Permission to perform this action has already been granted.`, 
          request: { status: 'Approved' } 
        });
      }
    }

    // Fetch target record's reference_no (skip for MasterSetup / ChamberMaster)
    let refQuery = '';
    if (record_type === 'Chamber') {
      refQuery = 'SELECT reference_no FROM daily_chamber_temp_logs WHERE id = ? LIMIT 1';
    } else if (record_type === 'Inward') {
      refQuery = 'SELECT reference_no FROM inward_temp_logs WHERE inward_id = ? LIMIT 1';
    } else if (record_type === 'Outward') {
      refQuery = 'SELECT reference_no FROM outward_temp_logs WHERE outward_id = ? LIMIT 1';
    }
    
    let reference_no = '';
    if (refQuery) {
      const [refRows] = await db.query(refQuery, [record_id]);
      if (refRows.length > 0) {
        reference_no = refRows[0].reference_no;
      }
    }
    const refText = reference_no
      ? `Ref: ${reference_no}`
      : (record_type === 'MasterSetup'
        ? 'Master Setup'
        : record_type === 'ChamberMaster'
          ? `Chamber #${record_id}`
          : record_type === 'ClientMaster'
            ? `ClientMaster #${record_id}`
            : `ID: ${record_id}`);

    // Insert new request as an activity log row (description + structured remark)
    const actionLabel = action === 'Edit' ? 'edit' : 'delete';
    let descText =
      description ||
      (record_type === 'MasterSetup'
        ? `Master Setup opened (no Super Admin allow required).`
        : record_type === 'ChamberMaster'
          ? `Requested Super Admin allow for chamber master (${refText}).`
          : record_type === 'ClientMaster'
            ? `Client master ${actionLabel} notified to Super Admin (${refText}) — no allow required.`
            : `Requested permission to ${actionLabel} ${record_type} log (${refText})`);

    const resolvedRemark =
      (remark != null && String(remark).trim()) ||
      extractRemark(descText) ||
      null;
    if (resolvedRemark && !/Remark\s*:/i.test(descText)) {
      descText = `${descText} Remark: ${resolvedRemark}`;
    }

    await logActivity(
      operator_email,
      reqActionType,
      record_type,
      descText,
      record_id,
      resolvedRemark
    );

    // Fetch the inserted row to return its ID
    const [inserted] = await db.query(`
      SELECT id FROM do_operator_activities 
      WHERE operator_email = ? AND action = ? AND log_type = ? AND permission_req = ?
      ORDER BY id DESC LIMIT 1
    `, [operator_email, reqActionType, record_type, record_id]);

    return res.status(201).json({
      message: 'Permission request submitted successfully.',
      requestId: inserted[0] ? inserted[0].id : null
    });
  } catch (err) {
    return handleControllerError(res, err, {
      checkpoint: 'createPermissionRequest',
      req,
      clientMessage: 'Failed to create permission request.'
    });
  }
};

// 3. SUPER ADMIN: APPROVE OR DENY PERMISSION REQUEST
exports.updatePermissionRequestStatus = async (req, res) => {
  try {
    const { id } = req.params; // The ID of the REQUEST log entry
    const { status, remark: saRemarkRaw } = req.body; // 'Approved' or 'Denied' + optional SA remark

    if (!['Approved', 'Denied'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be Approved or Denied.' });
    }

    // Fetch the request log details to identify who, what, and which ID was requested
    const [reqRows] = await db.query(`
      SELECT operator_email, action, log_type AS record_type, permission_req AS record_id, description, remark
      FROM do_operator_activities 
      WHERE id = ? LIMIT 1
    `, [id]);

    if (reqRows.length === 0) {
      return res.status(404).json({ error: 'Permission request log not found.' });
    }

    const {
      operator_email,
      action: requestAction,
      record_type,
      record_id,
      description: requestDescription,
      remark: requestRemarkCol
    } = reqRows[0];
    const isEdit = requestAction === 'REQUEST_EDIT';
    const requestRemark =
      (requestRemarkCol && String(requestRemarkCol).trim()) ||
      extractRemark(requestDescription) ||
      '';
    const saRemark = saRemarkRaw != null ? String(saRemarkRaw).trim() : '';

    // Determine target status action type
    let targetAction;
    if (status === 'Approved') {
      targetAction = isEdit ? 'GRANT_PERMISSION' : 'GRANT_DELETE';
    } else {
      targetAction = isEdit ? 'DENY_PERMISSION' : 'DENY_DELETE';
    }

    // Fetch target record details for a clear DO notification message
    let approvalRefNo = '';
    let chamberName = '';
    let clientName = '';
    let shiftName = '';
    let appliedChamberAdd = null;

    if (record_type === 'Chamber') {
      const [approvalRefRows] = await db.query(
        `SELECT reference_no, chamber_name, client_name, shift
         FROM daily_chamber_temp_logs WHERE id = ? LIMIT 1`,
        [record_id]
      );
      if (approvalRefRows.length > 0) {
        approvalRefNo = approvalRefRows[0].reference_no || '';
        chamberName = approvalRefRows[0].chamber_name || '';
        clientName = approvalRefRows[0].client_name || '';
        shiftName = approvalRefRows[0].shift || '';
      }
    } else if (record_type === 'ChamberMaster') {
      // ADD chamber: create on approve + bump DO chamber_limit (Operators Directory + mobile sync)
      if (status === 'Approved' && isEdit) {
        appliedChamberAdd = await applyApprovedChamberAdd(operator_email, requestDescription, record_id);
        if (appliedChamberAdd?.name) chamberName = appliedChamberAdd.name;
      }
      if (!chamberName) {
        const [chRows] = await db.query(
          'SELECT name FROM chambers WHERE id = ? LIMIT 1',
          [record_id]
        );
        if (chRows.length > 0) {
          chamberName = chRows[0].name || '';
        } else {
          const nameMatch = String(requestDescription || '').match(/ADD chamber "([^"]+)"/i)
            || String(requestDescription || '').match(/delete chamber "([^"]+)"/i);
          chamberName = nameMatch?.[1] || `Chamber #${record_id}`;
        }
      }
    } else if (record_type === 'ClientMaster') {
      // Names live in the original request description; keep chamber/client empty here
      chamberName = 'Client Master';
      clientName = `#${record_id}`;
    } else if (record_type === 'Inward') {
      const [approvalRefRows] = await db.query(
        'SELECT reference_no FROM inward_temp_logs WHERE inward_id = ? LIMIT 1',
        [record_id]
      );
      if (approvalRefRows.length > 0) approvalRefNo = approvalRefRows[0].reference_no || '';
    } else if (record_type === 'Outward') {
      const [approvalRefRows] = await db.query(
        'SELECT reference_no FROM outward_temp_logs WHERE outward_id = ? LIMIT 1',
        [record_id]
      );
      if (approvalRefRows.length > 0) approvalRefNo = approvalRefRows[0].reference_no || '';
    }

    const actionWord =
      record_type === 'MasterSetup'
        ? 'Master Setup'
        : record_type === 'ChamberMaster'
          ? (isEdit ? 'Chamber Add' : 'Chamber Delete')
          : record_type === 'ClientMaster'
            ? (isEdit ? 'Client Edit' : 'Client Delete')
            : (isEdit ? 'Edit' : 'Delete');
    const outcome = status === 'Approved' ? 'approved' : 'denied';
    const detailParts =
      record_type === 'MasterSetup'
        ? ['Chambers & Clients management']
        : record_type === 'ChamberMaster'
          ? [isEdit ? 'Add chamber' : 'Master delete', chamberName || `#${record_id}`]
          : record_type === 'ClientMaster'
            ? [isEdit ? 'Edit client name' : 'Delete client name', `#${record_id}`]
            : [chamberName, clientName, shiftName, approvalRefNo || `#${record_id}`].filter(Boolean);

    let saActor = '';
    try {
      saActor = await getActorLabel(req.user);
    } catch (_) {
      saActor = req.user?.email || 'Super Admin';
    }

    const approvalParts = [
      `${actionWord} ${outcome}`,
      detailParts.join(' · '),
      requestRemark ? `Request remark: ${requestRemark}` : null,
      saRemark ? `SA remark: ${saRemark}` : null,
      saActor ? `Decided by: ${saActor}` : null
    ].filter(Boolean);
    const approvalMessage = approvalParts.join(' · ');
    const storedRemark = saRemark || requestRemark || null;

    await logActivity(
      operator_email,
      targetAction,
      record_type,
      approvalMessage,
      record_id,
      storedRemark
    );

    return res.json({
      message: `Permission request ${status.toLowerCase()} successfully.`,
      chamber_add: appliedChamberAdd || null,
      remark: storedRemark
    });
  } catch (err) {
    return handleControllerError(res, err, {
      checkpoint: 'updatePermissionRequest',
      req,
      clientMessage: 'Failed to update permission request.'
    });
  }
};

// DO: mark notification handled (moves to Completed after Proceed / follow-up action)
exports.markPermissionActionComplete = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      `SELECT id, operator_email, action, log_type, permission_req FROM do_operator_activities WHERE id = ? LIMIT 1`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found.' });
    }

    const row = rows[0];
    const allowedActions = [
      'REQUEST_EDIT',
      'REQUEST_DELETE',
      'GRANT_PERMISSION',
      'GRANT_DELETE',
      'DENY_PERMISSION',
      'DENY_DELETE',
      'USE_EDIT_PERMISSION',
      'USE_DELETE_PERMISSION'
    ];
    if (!allowedActions.includes(row.action)) {
      return res.status(400).json({ error: 'This activity cannot be marked complete.' });
    }

    if (req.user.role !== 'super_admin' && row.operator_email !== req.user.email) {
      return res.status(403).json({ error: 'Not allowed to update this notification.' });
    }

    await db.query(
      `UPDATE do_operator_activities SET do_action_completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );

    // One-time grants: consume so next action needs SA approve again
    if (
      (row.log_type === 'MasterSetup' ||
        row.log_type === 'ChamberMaster' ||
        row.log_type === 'ClientMaster') &&
      (row.action === 'GRANT_PERMISSION' || row.action === 'GRANT_DELETE')
    ) {
      try {
        await exports.consumeGrantedPermission(
          row.operator_email,
          row.log_type,
          row.permission_req,
          row.action === 'GRANT_DELETE' ? 'Delete' : 'Edit'
        );
      } catch (_) {}
    }

    const [updated] = await db.query(
      `SELECT do_action_completed_at FROM do_operator_activities WHERE id = ? LIMIT 1`,
      [id]
    );

    return res.json({
      message: 'Notification moved to completed.',
      do_action_completed_at: updated[0]?.do_action_completed_at || null
    });
  } catch (err) {
    return handleControllerError(res, err, {
      checkpoint: 'markPermissionActionComplete',
      req,
      clientMessage: 'Failed to mark notification complete.'
    });
  }
};

/**
 * Structured Super Allow trail for History Log / Profile Lookup.
 * Query: record_type=Chamber|Inward|Outward|ChamberMaster..., record_id=<id>
 */
exports.getRecordPermissionHistory = async (req, res) => {
  try {
    const record_type = String(req.query.record_type || '').trim();
    const record_id = parseInt(req.query.record_id, 10);

    if (!record_type || !Number.isFinite(record_id)) {
      return res.status(400).json({ error: 'record_type and record_id are required.' });
    }

    // Normalize common aliases from frontend
    let logType = record_type;
    if (/^chamber/i.test(record_type) && !/master/i.test(record_type)) logType = 'Chamber';
    if (/^inward/i.test(record_type)) logType = 'Inward';
    if (/^outward/i.test(record_type)) logType = 'Outward';

    const [rows] = await db.query(
      `
      SELECT
        id,
        operator_email,
        action,
        log_type,
        description,
        remark,
        permission_req,
        created_at,
        do_action_completed_at,
        CASE
          WHEN action IN ('REQUEST_EDIT', 'REQUEST_DELETE') THEN 'Pending'
          WHEN action IN ('GRANT_PERMISSION', 'GRANT_DELETE') THEN 'Approved'
          WHEN action IN ('USE_EDIT_PERMISSION', 'USE_DELETE_PERMISSION') THEN 'Used'
          WHEN action IN ('DENY_PERMISSION', 'DENY_DELETE') THEN 'Denied'
          ELSE action
        END AS decision
      FROM do_operator_activities
      WHERE permission_req = ?
        AND (
          log_type = ?
          OR (? = 'Chamber' AND (log_type = 'Chamber' OR log_type LIKE 'Chamber%'))
          OR (? = 'Inward' AND (log_type = 'Inward' OR log_type LIKE 'Inward%'))
          OR (? = 'Outward' AND (log_type = 'Outward' OR log_type LIKE 'Outward%'))
        )
        AND action IN (
          'REQUEST_EDIT', 'REQUEST_DELETE',
          'GRANT_PERMISSION', 'GRANT_DELETE',
          'DENY_PERMISSION', 'DENY_DELETE',
          'USE_EDIT_PERMISSION', 'USE_DELETE_PERMISSION',
          'UPDATE', 'DELETE', 'CREATE'
        )
      ORDER BY id ASC
      `,
      [record_id, logType, logType, logType, logType]
    );

    const items = (rows || []).map((row) => {
      const desc = String(row.description || '');
      const requestRemark =
        (row.remark && String(row.remark).trim()) ||
        extractRemark(desc) ||
        '';
      const saRemarkMatch = desc.match(/SA remark:\s*([^·]+)/i);
      const decidedByMatch = desc.match(/Decided by:\s*([^·]+)/i);
      const changesMatch = desc.match(/Changes:\s*([^·]+?)(?:\.\s*Remarks:|$)/i);
      const changesText = changesMatch ? changesMatch[1].trim() : '';
      const change_rows = [];
      if (changesText) {
        const segments = changesText.split(/\s*\|\s*/);
        segments.forEach((segment) => {
          String(segment)
            .split(/\s*,\s*(?=[^,:]+:\s)/)
            .forEach((part) => {
              const m = part.match(/^(.*?):\s*(.*?)\s*(?:➔|→|->)\s*(.*)$/);
              if (m) {
                change_rows.push({
                  field: m[1].trim(),
                  from: m[2].trim() || 'N/A',
                  to: m[3].trim() || 'N/A'
                });
              }
            });
        });
      }
      const isEdit = /EDIT|GRANT_PERMISSION|REQUEST_EDIT|USE_EDIT|UPDATE/i.test(row.action);
      const isDelete = /DELETE|GRANT_DELETE|REQUEST_DELETE|USE_DELETE/i.test(row.action);

      let eventLabel = row.decision || row.action;
      if (row.action === 'REQUEST_EDIT') eventLabel = 'DO requested Edit allow';
      else if (row.action === 'REQUEST_DELETE') eventLabel = 'DO requested Delete allow';
      else if (row.action === 'GRANT_PERMISSION') eventLabel = 'Super Admin ALLOWED Edit';
      else if (row.action === 'GRANT_DELETE') eventLabel = 'Super Admin ALLOWED Delete';
      else if (row.action === 'DENY_PERMISSION') eventLabel = 'Super Admin DENIED Edit';
      else if (row.action === 'DENY_DELETE') eventLabel = 'Super Admin DENIED Delete';
      else if (row.action === 'USE_EDIT_PERMISSION') eventLabel = 'DO used Edit permission';
      else if (row.action === 'USE_DELETE_PERMISSION') eventLabel = 'DO used Delete permission';
      else if (row.action === 'UPDATE') eventLabel = 'Record updated (after allow)';
      else if (row.action === 'DELETE') eventLabel = 'Record deleted';

      return {
        id: row.id,
        action: row.action,
        decision: row.decision,
        event_label: eventLabel,
        request_type: isDelete ? 'Delete' : isEdit ? 'Edit' : 'Other',
        operator_email: row.operator_email,
        description: desc,
        remark: requestRemark || null,
        sa_remark: saRemarkMatch ? saRemarkMatch[1].trim() : null,
        decided_by: decidedByMatch ? decidedByMatch[1].trim() : null,
        changes: changesText || null,
        change_rows,
        date: row.created_at,
        completed_at: row.do_action_completed_at || null
      };
    });

    return res.json({
      success: true,
      record_type: logType,
      record_id,
      count: items.length,
      items
    });
  } catch (err) {
    return handleControllerError(res, err, {
      checkpoint: 'getRecordPermissionHistory',
      req,
      clientMessage: 'Failed to fetch Super Allow history for this record.'
    });
  }
};

// 4. CHECK IF PERMISSION IS GRANTED (supports both Edit and Delete actions)
exports.checkPermission = async (req, res) => {
  try {
    const { record_type, record_id, action = 'Edit' } = req.query;

    if (!record_type || !record_id) {
      return res.status(400).json({ error: 'Record type and record ID are required.' });
    }

    // Super Admin never needs DO permission approval
    if (req.user?.role === 'super_admin') {
      return res.json({
        approved: true,
        status: 'Approved',
        bypass: true,
        role: 'super_admin'
      });
    }

    const operator_email = req.user.email;

    // 1. Check system configuration settings first
    const configKey = `${record_type}_${action}`;
    const [configRows] = await db.query(`
      SELECT description FROM do_operator_activities
      WHERE operator_email = 'system' AND log_type = 'SYSTEM_CONFIG' AND action = ?
      ORDER BY id DESC LIMIT 1
    `, [configKey]);

    const isDirectAllowed = configRows.length > 0 && configRows[0].description === 'Allow';
    if (isDirectAllowed) {
      return res.json({ approved: true, status: 'Approved' });
    }

    // 2. Check individual request log status
    const reqActionType = action === 'Edit' ? 'REQUEST_EDIT' : 'REQUEST_DELETE';
    const grantActionType = action === 'Edit' ? 'GRANT_PERMISSION' : 'GRANT_DELETE';
    const denyActionType = action === 'Edit' ? 'DENY_PERMISSION' : 'DENY_DELETE';
    const useActionType = action === 'Edit' ? 'USE_EDIT_PERMISSION' : 'USE_DELETE_PERMISSION';

    const [rows] = await db.query(`
      SELECT action, id, description FROM do_operator_activities
      WHERE operator_email = ? AND log_type = ? AND permission_req = ?
      ORDER BY id DESC LIMIT 1
    `, [operator_email, record_type, record_id]);

    if (rows.length === 0) {
      return res.json({ approved: false, status: 'None' });
    }

    const latest = rows[0];
    let calculatedStatus = 'None';
    if (latest.action === reqActionType) calculatedStatus = 'Pending';
    else if (latest.action === grantActionType) calculatedStatus = 'Approved';
    else if (latest.action === denyActionType) calculatedStatus = 'Denied';
    else if (latest.action === useActionType) calculatedStatus = 'Used';

    return res.json({
      approved: latest.action === grantActionType,
      status: calculatedStatus,
      request: {
        id: latest.id,
        operator_email,
        record_type,
        record_id,
        action,
        status: calculatedStatus,
        description: latest.description
      }
    });
  } catch (err) {
    return handleControllerError(res, err, {
      checkpoint: 'checkPermission',
      req,
      clientMessage: 'Failed to check permission.'
    });
  }
};

/**
 * One-time grant: after DO successfully edits/deletes, mark permission as used
 * so another Super Admin approval is required for the next change.
 */
exports.consumeGrantedPermission = async (operatorEmail, recordType, recordId, action = 'Edit') => {
  if (!operatorEmail || !recordType || !recordId) return false;

  const grantActionType = action === 'Edit' ? 'GRANT_PERMISSION' : 'GRANT_DELETE';
  const useActionType = action === 'Edit' ? 'USE_EDIT_PERMISSION' : 'USE_DELETE_PERMISSION';

  const [rows] = await db.query(
    `SELECT action FROM do_operator_activities
     WHERE operator_email = ? AND log_type = ? AND permission_req = ?
     ORDER BY id DESC LIMIT 1`,
    [operatorEmail, recordType, recordId]
  );

  if (!rows.length || rows[0].action !== grantActionType) {
    return false;
  }

  const actionWord = action === 'Edit' ? 'Edit' : 'Delete';
  await logActivity(
    operatorEmail,
    useActionType,
    recordType,
    `${actionWord} used · #${recordId}`,
    recordId
  );
  return true;
};

/**
 * Returns true if DO may proceed (system Allow, or active GRANT not yet used).
 * Super Admin / Sub Admin callers should not use this gate.
 */
exports.hasActivePermission = async (operatorEmail, recordType, recordId, action = 'Edit') => {
  const configKey = `${recordType}_${action}`;
  const [configRows] = await db.query(
    `SELECT description FROM do_operator_activities
     WHERE operator_email = 'system' AND log_type = 'SYSTEM_CONFIG' AND action = ?
     ORDER BY id DESC LIMIT 1`,
    [configKey]
  );
  if (configRows.length > 0 && configRows[0].description === 'Allow') {
    return true;
  }

  const grantActionType = action === 'Edit' ? 'GRANT_PERMISSION' : 'GRANT_DELETE';
  const [rows] = await db.query(
    `SELECT action FROM do_operator_activities
     WHERE operator_email = ? AND log_type = ? AND permission_req = ?
     ORDER BY id DESC LIMIT 1`,
    [operatorEmail, recordType, recordId]
  );
  return rows.length > 0 && rows[0].action === grantActionType;
};

// 5. GET SYSTEM PERMISSION CONFIG
exports.getSystemConfig = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT action AS config_key, description AS config_value FROM do_operator_activities
      WHERE operator_email = 'system' AND log_type = 'SYSTEM_CONFIG'
      AND id IN (
        SELECT MAX(id) FROM do_operator_activities
        WHERE operator_email = 'system' AND log_type = 'SYSTEM_CONFIG'
        GROUP BY action
      )
    `);
    
    // Default system configurations
    const config = {
      Chamber_Edit: 'Require Approval',
      Chamber_Delete: 'Require Approval',
      ChamberMaster_Edit: 'Require Approval',
      ChamberMaster_Delete: 'Require Approval',
      ClientMaster_Edit: 'Allow',
      ClientMaster_Delete: 'Allow',
      Inward_Edit: 'Require Approval',
      Inward_Delete: 'Require Approval',
      Outward_Edit: 'Require Approval',
      Outward_Delete: 'Require Approval',
    };

    rows.forEach(row => {
      config[row.config_key] = row.config_value;
    });

    // Client master is always notify-only (no Super Admin allow gate)
    config.ClientMaster_Edit = 'Allow';
    config.ClientMaster_Delete = 'Allow';

    return res.json(config);
  } catch (err) {
    return handleControllerError(res, err, {
      checkpoint: 'getSystemConfig',
      req,
      clientMessage: 'Failed to fetch configuration.'
    });
  }
};

// 6. UPDATE SYSTEM PERMISSION CONFIG
exports.updateSystemConfig = async (req, res) => {
  try {
    const { config_key, config_value } = req.body;
    if (!config_key || !['Allow', 'Require Approval'].includes(config_value)) {
      return res.status(400).json({ error: 'Invalid configuration key or value.' });
    }

    await logActivity(
      'system',
      config_key,
      'SYSTEM_CONFIG',
      config_value,
      null
    );

    // Also log this as a security event for audit purposes
    await logActivity(
      req.user.email,
      'UPDATE_CONFIG',
      'SECURITY',
      `Updated permission configuration: Set DO operator access for ${config_key.replace('_', ' ')} to ${config_value}`,
      null
    );

    return res.json({ message: 'Configuration updated successfully.' });
  } catch (err) {
    return handleControllerError(res, err, {
      checkpoint: 'updateSystemConfig',
      req,
      clientMessage: 'Failed to update configuration.'
    });
  }
};
