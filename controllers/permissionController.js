// ====================================================================
// Permission Requests Controller
// (backend/controllers/permissionController.js)
// Implements secure workflow for DO operators to request edit/delete permissions
// and for Super Admins to approve/deny them, using ONLY the existing
// do_operator_activities table! No separate requests table is needed.
// ====================================================================

const db = require('../config/db');
const { logActivity } = require('../utils/logger');

// 1. GET ALL OR USER-SPECIFIC PERMISSION REQUESTS
exports.getPermissionRequests = async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'super_admin') {
      [rows] = await db.query(`
        SELECT a.id, a.operator_email, a.log_type AS record_type, a.permission_req AS record_id, a.action AS raw_action,
               CASE 
                 WHEN a.action IN ('REQUEST_EDIT', 'REQUEST_DELETE') THEN 'Pending'
                 WHEN a.action IN ('GRANT_PERMISSION', 'GRANT_DELETE') THEN 'Approved'
                 ELSE 'Denied'
               END AS status,
               a.description, a.created_at,
               r.description AS request_description
        FROM do_operator_activities a
        LEFT JOIN do_operator_activities r ON r.operator_email = a.operator_email 
          AND r.log_type = a.log_type 
          AND r.permission_req = a.permission_req
          AND r.action IN ('REQUEST_EDIT', 'REQUEST_DELETE')
        WHERE a.id IN (
          SELECT MAX(id)
          FROM do_operator_activities
          WHERE action IN ('REQUEST_EDIT', 'REQUEST_DELETE', 'GRANT_PERMISSION', 'GRANT_DELETE', 'DENY_PERMISSION', 'DENY_DELETE')
          GROUP BY operator_email, log_type, permission_req
        )
        ORDER BY a.id DESC
      `);
    } else {
      [rows] = await db.query(`
        SELECT a.id, a.operator_email, a.log_type AS record_type, a.permission_req AS record_id, a.action AS raw_action,
               CASE 
                 WHEN a.action IN ('REQUEST_EDIT', 'REQUEST_DELETE') THEN 'Pending'
                 WHEN a.action IN ('GRANT_PERMISSION', 'GRANT_DELETE') THEN 'Approved'
                 ELSE 'Denied'
               END AS status,
               a.description, a.created_at,
               r.description AS request_description
        FROM do_operator_activities a
        LEFT JOIN do_operator_activities r ON r.operator_email = a.operator_email 
          AND r.log_type = a.log_type 
          AND r.permission_req = a.permission_req
          AND r.action IN ('REQUEST_EDIT', 'REQUEST_DELETE')
        WHERE a.operator_email = ? 
          AND a.id IN (
            SELECT MAX(id)
            FROM do_operator_activities
            WHERE action IN ('REQUEST_EDIT', 'REQUEST_DELETE', 'GRANT_PERMISSION', 'GRANT_DELETE', 'DENY_PERMISSION', 'DENY_DELETE')
            GROUP BY operator_email, log_type, permission_req
          )
        ORDER BY a.id DESC
      `, [req.user.email]);
    }
    return res.json(rows);
  } catch (err) {
    console.error('Error fetching permission requests:', err);
    return res.status(500).json({ error: 'Failed to fetch permission requests.' });
  }
};

// 2. CREATE A NEW PERMISSION REQUEST (Edit or Delete)
exports.createPermissionRequest = async (req, res) => {
  try {
    const { record_type, record_id, action = 'Edit', description } = req.body;
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

    // Fetch target record's reference_no
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
    const refText = reference_no ? `Ref: ${reference_no}` : `ID: ${record_id}`;

    // Insert new request as an activity log row
    const actionLabel = action === 'Edit' ? 'edit' : 'delete';
    const descText = description || `Requested permission to ${actionLabel} ${record_type} log (${refText})`;
    await logActivity(
      operator_email,
      reqActionType,
      record_type,
      descText,
      record_id
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
    console.error('Error creating permission request:', err);
    return res.status(500).json({ error: 'Failed to create permission request.' });
  }
};

// 3. SUPER ADMIN: APPROVE OR DENY PERMISSION REQUEST
exports.updatePermissionRequestStatus = async (req, res) => {
  try {
    const { id } = req.params; // The ID of the REQUEST log entry
    const { status } = req.body; // 'Approved' or 'Denied'

    if (!['Approved', 'Denied'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be Approved or Denied.' });
    }

    // Fetch the request log details to identify who, what, and which ID was requested
    const [reqRows] = await db.query(`
      SELECT operator_email, action, log_type AS record_type, permission_req AS record_id 
      FROM do_operator_activities 
      WHERE id = ? LIMIT 1
    `, [id]);

    if (reqRows.length === 0) {
      return res.status(404).json({ error: 'Permission request log not found.' });
    }

    const { operator_email, action: requestAction, record_type, record_id } = reqRows[0];
    const isEdit = requestAction === 'REQUEST_EDIT';

    // Determine target status action type
    let targetAction;
    if (status === 'Approved') {
      targetAction = isEdit ? 'GRANT_PERMISSION' : 'GRANT_DELETE';
    } else {
      targetAction = isEdit ? 'DENY_PERMISSION' : 'DENY_DELETE';
    }

    const statusText = status === 'Approved' ? 'Granted' : 'Denied';
    const verb = isEdit ? 'edit' : 'delete';
    
    // Fetch target record's reference_no
    let approvalRefQuery = '';
    if (record_type === 'Chamber') {
      approvalRefQuery = 'SELECT reference_no FROM daily_chamber_temp_logs WHERE id = ? LIMIT 1';
    } else if (record_type === 'Inward') {
      approvalRefQuery = 'SELECT reference_no FROM inward_temp_logs WHERE inward_id = ? LIMIT 1';
    } else if (record_type === 'Outward') {
      approvalRefQuery = 'SELECT reference_no FROM outward_temp_logs WHERE outward_id = ? LIMIT 1';
    }
    
    let approvalRefNo = '';
    if (approvalRefQuery) {
      const [approvalRefRows] = await db.query(approvalRefQuery, [record_id]);
      if (approvalRefRows.length > 0) {
        approvalRefNo = approvalRefRows[0].reference_no;
      }
    }
    const approvalRefText = approvalRefNo ? `Ref: ${approvalRefNo}` : `ID: ${record_id}`;

    await logActivity(
      operator_email,
      targetAction,
      record_type,
      `Admin ${req.user.email} ${statusText.toLowerCase()} ${verb} permission on ${record_type} record (${approvalRefText})`,
      record_id
    );

    return res.json({ message: `Permission request ${status.toLowerCase()} successfully.` });
  } catch (err) {
    console.error('Error updating permission request:', err);
    return res.status(500).json({ error: 'Failed to update permission request.' });
  }
};

// 4. CHECK IF PERMISSION IS GRANTED (supports both Edit and Delete actions)
exports.checkPermission = async (req, res) => {
  try {
    const { record_type, record_id, action = 'Edit' } = req.query;
    const operator_email = req.user.email;

    if (!record_type || !record_id) {
      return res.status(400).json({ error: 'Record type and record ID are required.' });
    }

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
    console.error('Error checking permission:', err);
    return res.status(500).json({ error: 'Failed to check permission.' });
  }
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
      Inward_Edit: 'Require Approval',
      Inward_Delete: 'Require Approval',
      Outward_Edit: 'Require Approval',
      Outward_Delete: 'Require Approval',
    };

    rows.forEach(row => {
      config[row.config_key] = row.config_value;
    });

    return res.json(config);
  } catch (err) {
    console.error('Error fetching system config:', err);
    return res.status(500).json({ error: 'Failed to fetch configuration.' });
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
    console.error('Error updating system config:', err);
    return res.status(500).json({ error: 'Failed to update configuration.' });
  }
};
