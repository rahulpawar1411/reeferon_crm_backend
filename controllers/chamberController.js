// ====================================================================
// Chamber Controller (controllers/chamberController.js)
// --------------------------------------------------------------------
// Chambers list, client assignments, DO inspections (multipart + photo).
// Catch blocks → handleControllerError (no raw error.message to clients).
// ====================================================================

const db = require('../config/db');
const { logErrorCheckpoint, handleControllerError } = require('../utils/errorHandler');
const exifr = require('exifr');
const fs = require('fs');
const { getSavedFilePath } = require('../config/multer');
const { logActivity, getActorLabel } = require('../utils/logger');
const { resolveLogAttribution } = require('../utils/logAttribution');
const { parseOptionalFloat } = require('../utils/photoCaptureMeta');

/**
 * Ensure global master has Chamber 1 .. Chamber N (shared numbered list).
 * Used when Super Admin assigns chamber_limit to a DO.
 */
async function ensureNumberedChambers(limit) {
  const n = Math.max(1, Math.min(parseInt(limit, 10) || 4, 50));
  for (let i = 1; i <= n; i++) {
    const name = `Chamber ${i}`;
    const [existing] = await db.query('SELECT id FROM chambers WHERE name = ? LIMIT 1', [name]);
    if (existing.length === 0) {
      await db.query('INSERT INTO chambers (name) VALUES (?)', [name]);
    }
  }
  return n;
}

exports.ensureNumberedChambers = ensureNumberedChambers;

function chamberNumberFromName(name) {
  const m = String(name || '').match(/^Chamber\s+(\d+)$/i);
  if (m) return parseInt(m[1], 10);
  const any = String(name || '').match(/(\d+)/);
  return any ? parseInt(any[1], 10) : null;
}

/** DO chamber list: numbered Chamber 1..limit first, then custom names, max `limit`. */
function pickDoChambers(allRows, limit) {
  const byNum = new Map();
  const custom = [];
  (allRows || []).forEach((r) => {
    const num = chamberNumberFromName(r.name);
    if (num != null && num >= 1 && num <= limit) {
      if (!byNum.has(num)) byNum.set(num, r);
    } else if (num == null) {
      custom.push(r);
    }
  });
  const result = [];
  for (let i = 1; i <= limit; i++) {
    if (byNum.has(i)) result.push(byNum.get(i));
  }
  for (const c of custom) {
    if (result.length >= limit) break;
    result.push(c);
  }
  return result;
}
exports.pickDoChambers = pickDoChambers;

async function resolveChamberForAssignment(chamberId) {
  const raw = chamberId;
  const [byId] = await db.query(
    'SELECT id, name, chamber_type FROM chambers WHERE id = ? LIMIT 1',
    [raw]
  );
  if (byId.length) return byId[0];
  const [byName] = await db.query(
    `SELECT id, name, chamber_type FROM chambers
     WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
        OR LOWER(TRIM(name)) = LOWER(TRIM(?))
     LIMIT 1`,
    [`Chamber ${raw}`, String(raw)]
  );
  return byName[0] || null;
}

/** Stable INT for ChamberMaster ADD permission (by proposed name). */
function chamberAddPermissionId(name) {
  const s = `add|${String(name || '').trim().toLowerCase()}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2000000000 || 1;
}
exports.chamberAddPermissionId = chamberAddPermissionId;

// Helper to format Date into standard YYYY-MM-DD HH:mm:ss string
function formatDateTime(date) {
  if (!date || isNaN(date.getTime())) return null;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

// Helper to calculate time variance in minutes between inspection date/time and capture date
function calculateVariance(entryDateStr, inspectionTimeStr, captureDate) {
  try {
    if (!entryDateStr || !inspectionTimeStr || !captureDate) return 0;
    
    // Normalize time string: if "11:00 AM", parse or extract HH:mm
    let timePart = inspectionTimeStr;
    if (inspectionTimeStr.includes('AM') || inspectionTimeStr.includes('PM')) {
      const match = inspectionTimeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (match) {
        let h = parseInt(match[1], 10);
        const m = match[2];
        const ampm = match[3].toUpperCase();
        if (ampm === 'PM' && h < 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        timePart = `${String(h).padStart(2, '0')}:${m}`;
      }
    }
    const [hours, minutes] = timePart.split(':').map(Number);
    
    let year, month, day;
    if (entryDateStr instanceof Date) {
      year = entryDateStr.getFullYear();
      month = entryDateStr.getMonth() + 1;
      day = entryDateStr.getDate();
    } else {
      const parts = String(entryDateStr).split('T')[0].split('-');
      year = Number(parts[0]);
      month = Number(parts[1]);
      day = Number(parts[2]);
    }
    
    const inspectionDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
    
    let parsedCapture = captureDate;
    if (typeof captureDate === 'string') {
      parsedCapture = new Date(captureDate.replace(' ', 'T'));
    } else if (captureDate instanceof Date) {
      parsedCapture = captureDate;
    } else {
      parsedCapture = new Date(captureDate);
    }

    if (isNaN(parsedCapture.getTime()) || isNaN(inspectionDate.getTime())) return 0;

    const diffMs = Math.abs(parsedCapture.getTime() - inspectionDate.getTime());
    return Math.round(diffMs / (1000 * 60));
  } catch (e) {
    console.error('Error calculating variance:', e);
    return 0;
  }
}

/**
 * ====================================================================
 * ChamberController (backend/controllers/chamberController.js)
 * ====================================================================
 * Manages cold storage chamber definitions, client assignments,
 * and handles DO daily inspections with image uploads.
 * ====================================================================
 */

// 1. Fetch all chambers
exports.getChambers = async (req, res) => {
  try {
    // DO: ensure Chamber 1..chamber_limit exist, then return exactly those
    let filteredRows;
    let appliedLimit = null;
    if (req.user && req.user.role === 'do_operator') {
      let limit = 4;
      try {
        const [userRows] = await db.query('SELECT chamber_limit FROM do_operators WHERE email = ? LIMIT 1', [req.user.email]);
        if (userRows.length > 0) {
          limit = parseInt(userRows[0].chamber_limit || 4, 10);
        }
      } catch (dbErr) {
        limit = parseInt(req.user.chamber_limit || 4, 10);
      }
      if (!Number.isFinite(limit) || limit < 1) limit = 4;
      appliedLimit = limit;

      // Only bootstrap Chamber 1..N when none exist yet (so DO delete can stick)
      const [existingAll] = await db.query('SELECT id, name, chamber_type FROM chambers ORDER BY id ASC');
      const picked = pickDoChambers(existingAll, limit);
      if (picked.length === 0) {
        await ensureNumberedChambers(limit);
        const [rows] = await db.query('SELECT id, name, chamber_type FROM chambers ORDER BY id ASC');
        filteredRows = pickDoChambers(rows, limit);
      } else {
        filteredRows = picked;
      }
    } else {
      const [rows] = await db.query('SELECT id, name, chamber_type FROM chambers ORDER BY name ASC');
      filteredRows = rows;
    }

    return res.status(200).json({
      success: true,
      data: filteredRows,
      chamber_limit: appliedLimit
    });
  } catch (error) {
    return handleControllerError(res, error, {
      checkpoint: 'Error_fetching_chambers_error_',
      req,
      clientMessage: 'Failed to fetch chambers.'
    });
  }
};

// 2. Fetch all active client chamber assignments (Admin managed)
exports.getAssignments = async (req, res) => {
  try {
    const isSpecialUser = req.user && (req.user.role === 'super_admin' || req.user.role === 'sub_admin');
    const warehouse_name = isSpecialUser
      ? (req.query.warehouse_name || null)
      : (req.user ? req.user.warehouse_name : null);
    const includeInactive = isSpecialUser;
    const query = `
      SELECT cca.chamber_id, c.name AS chamber_name, cca.client_name, cca.warehouse_name,
             COALESCE(NULLIF(TRIM(c.chamber_type), ''), NULLIF(TRIM(cca.chamber_type), ''), 'Frozen') AS chamber_type,
             COALESCE(NULLIF(TRIM(cca.status), ''), 'active') AS status
      FROM chamber_client_assignments cca
      JOIN chambers c ON cca.chamber_id = c.id
      WHERE (
        (? IS NULL AND (cca.warehouse_name IS NULL OR cca.warehouse_name = ''))
        OR LOWER(TRIM(cca.warehouse_name)) = LOWER(TRIM(?))
        OR (
          (cca.warehouse_name IS NULL OR cca.warehouse_name = '')
          AND NOT EXISTS (
            SELECT 1 FROM chamber_client_assignments x
            WHERE x.chamber_id = cca.chamber_id
              AND LOWER(TRIM(x.client_name)) = LOWER(TRIM(cca.client_name))
              AND LOWER(TRIM(x.warehouse_name)) = LOWER(TRIM(?))
          )
        )
      )
        ${includeInactive ? '' : "AND cca.status = 'active'"}
      ORDER BY c.name ASC,
               CASE WHEN LOWER(COALESCE(cca.status, 'active')) = 'inactive' THEN 1 ELSE 0 END,
               cca.client_name ASC
    `;
    const [rows] = await db.query(query, [warehouse_name, warehouse_name, warehouse_name]);

    const deduped = [];
    const seen = new Map();
    for (const row of rows || []) {
      const key = `${row.chamber_id}|${String(row.client_name || '').trim().toLowerCase()}`;
      if (!String(row.client_name || '').trim()) continue;
      const status = String(row.status || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active';
      const prev = seen.get(key);
      if (!prev) {
        seen.set(key, { ...row, status });
        continue;
      }
      const prevInactive = String(prev.status || 'active').toLowerCase() === 'inactive';
      if (prevInactive && status === 'active') {
        seen.set(key, { ...row, status: 'active' });
      }
    }
    seen.forEach((v) => deduped.push(v));

    // Filter assignments for Data Operators based on their assigned chamber limit
    let filteredRows = deduped;
    if (req.user && req.user.role === 'do_operator') {
      let limit = 4;
      try {
        const [userRows] = await db.query('SELECT chamber_limit FROM do_operators WHERE email = ? LIMIT 1', [req.user.email]);
        if (userRows.length > 0) {
          limit = parseInt(userRows[0].chamber_limit || 4, 10);
        }
      } catch (dbErr) {
        limit = parseInt(req.user.chamber_limit || 4, 10);
      }

      filteredRows = deduped.filter(row => {
        const chamberNum = chamberNumberFromName(row.chamber_name);
        return chamberNum === null || chamberNum <= limit;
      });
    }

    return res.status(200).json({
      success: true,
      data: filteredRows
    });
  } catch (error) {
    return handleControllerError(res, error, {
      checkpoint: 'Error_fetching_assignments_error_',
      req,
      clientMessage: 'Failed to fetch chamber client assignments.'
    });
  }
};

// 3. Log a daily chamber client box temperature inspection (DO Operator Submission)
exports.addInspection = async (req, res) => {
  try {
    const { operator_name, chamber_id, client_name, entry_date, entry_time, box_temp, box_count, chamber_type, overdue_time, photo_capture_time: bodyCaptureTime, created_at } = req.body;
    const { warehouse_name: logWarehouse, operator_email: logOperatorEmail } = resolveLogAttribution(req, req.body);
    const localTimestamp = formatDateTime(new Date());

    // Validation checks
    if (!operator_name || !chamber_id || !client_name || !entry_date || !entry_time || box_temp === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Operator Name, Chamber ID, Client Name, Date, Time, and Temperature are required.'
      });
    }

    const tempVal = parseFloat(box_temp);
    let boxCountVal = box_count !== undefined && box_count !== null && box_count !== '' ? parseInt(box_count, 10) : null;
    if (boxCountVal !== null && (Number.isNaN(boxCountVal) || boxCountVal < 0)) {
      return res.status(400).json({
        success: false,
        message: 'Box quantity cannot be negative. Enter 0 or a positive count.'
      });
    }
    
    // Resolve chamber_name from chamber_id
    const [chamberRows] = await db.query('SELECT name FROM chambers WHERE id = ? LIMIT 1', [chamber_id]);
    const chamber_name = chamberRows[0] ? chamberRows[0].name : `Chamber ${chamber_id}`;

    // Programmatic duplicate check to prevent double submissions on the same shift today
    const [existing] = await db.query(
      `SELECT id, reference_no FROM daily_chamber_temp_logs 
       WHERE entry_date = ? AND chamber_name = ? AND client_name = ? AND inspection_time = ? LIMIT 1`,
      [entry_date, chamber_name, client_name, entry_time]
    );
    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Duplicate submission: A temperature log for this client in this chamber has already been recorded today.',
        logId: existing[0].id,
        reference_no: existing[0].reference_no || null
      });
    }

    // Resolve upload photo path
    let photoUrl = null;
    let photo_capture_time = bodyCaptureTime || null;
    let time_variance_minutes = 0;

    if (req.file) {
      photoUrl = getSavedFilePath(req.file, 'daily_temp_monitor_images');
      
      // If photo_capture_time is not provided, try to extract it from image EXIF or file stats
      if (!photo_capture_time) {
        try {
          if (req.file.path && /^https?:\/\//i.test(req.file.path)) {
            photo_capture_time = formatDateTime(new Date());
          } else {
            const exif = await exifr.parse(req.file.path);
            if (exif && exif.DateTimeOriginal) {
              const captureDate = exif.DateTimeOriginal;
              photo_capture_time = formatDateTime(captureDate);
            } else {
              const stats = fs.statSync(req.file.path);
              const fileTime = stats.birthtime || stats.mtime;
              photo_capture_time = formatDateTime(fileTime);
            }
          }
        } catch (e) {
          console.warn('Warning: Failed to parse EXIF metadata for native upload. Defaulting to current time.', e.message);
          photo_capture_time = formatDateTime(new Date());
        }
      }
    }

    if (photo_capture_time) {
      time_variance_minutes = calculateVariance(entry_date, entry_time || '11:00 AM', photo_capture_time);
    }

    if (isNaN(time_variance_minutes) || time_variance_minutes === null || time_variance_minutes === undefined) {
      time_variance_minutes = 0;
    }

    const sql = `
      INSERT INTO daily_chamber_temp_logs 
      (entry_date, client_name, chamber_name, inspection_time, box_temp, monitor_supervisor_name, temp_sensor_image, warehouse_name, operator_email, is_native, box_count, chamber_type, overdue_time, photo_capture_time, time_variance_minutes, photo_capture_latitude, photo_capture_longitude, photo_capture_accuracy, shift, chamber_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const resolveNativeShift = (shift, entryTime) => {
      const s = String(shift || '').trim();
      if (/^morning$/i.test(s)) return 'Morning';
      if (/^evening$/i.test(s)) return 'Evening';
      const t = String(entryTime || '').trim().toUpperCase();
      if (t.startsWith('10:00') || t === '10:00 AM') return 'Morning';
      if (t.startsWith('16:00') || t.startsWith('18:00')) return 'Evening';
      const hm = t.match(/^(\d{1,2}):(\d{2})/);
      if (hm) {
        let h = parseInt(hm[1], 10);
        if (t.includes('PM') && h < 12) h += 12;
        if (t.includes('AM') && h === 12) h = 0;
        return h < 14 ? 'Morning' : 'Evening';
      }
      return 'Morning';
    };

    const params = [
      entry_date,
      client_name,
      chamber_name,
      entry_time,
      tempVal,
      operator_name,
      photoUrl,
      logWarehouse,
      logOperatorEmail,
      boxCountVal,
      chamber_type || 'Frozen',
      overdue_time || 'same day',
      photo_capture_time,
      time_variance_minutes,
      parseOptionalFloat(req.body.photo_capture_latitude),
      parseOptionalFloat(req.body.photo_capture_longitude),
      parseOptionalFloat(req.body.photo_capture_accuracy),
      resolveNativeShift(req.body.shift, entry_time),
      chamber_id ? parseInt(chamber_id, 10) : null,
      created_at || localTimestamp,
      localTimestamp
    ];

    const [result] = await db.query(sql, params);
    const insertId = result.insertId;

    // Generate unique reference_no
    const reference_no = `RF-CH-26-${String(insertId).padStart(4, '0')}`;
    try {
      await db.query('UPDATE daily_chamber_temp_logs SET reference_no = ? WHERE id = ?', [reference_no, insertId]);
    } catch (refErr) {
      console.warn('⚠️ Failed to update reference_no for native chamber log:', refErr.message);
    }

    // Log Operator Activity
    try {
      await logActivity(
        req.user ? req.user.email : 'unknown',
        'CREATE',
        'Chamber Temp Log',
        `${await getActorLabel(req.user)} created Native Chamber Temp record (Ref: ${reference_no}) — chamber ${chamber_name || '-'}, client ${client_name || '-'}, date ${entry_date || '-'}`
      );
    } catch (actErr) {
      console.warn('⚠️ Failed to log operator activity for native chamber inspection:', actErr.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Daily inspection log saved successfully.',
      logId: insertId,
      reference_no
    });
  } catch (error) {
    return handleControllerError(res, error, {
      checkpoint: 'addInspection',
      req,
      clientMessage: 'Server error while recording temperature log.'
    });
  }
};

// 4. Fetch all daily inspections (for Super Admin watch & operate)
exports.getInspections = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        id, 
        entry_date, 
        client_name, 
        chamber_name, 
        inspection_time, 
        box_temp AS temperature, 
        box_temp AS chamber_temp,
        monitor_supervisor_name AS operator_name, 
        monitor_supervisor_name,
        temp_sensor_image AS photo_url, 
        temp_sensor_image,
        warehouse_name, 
        operator_email, 
        reference_no, 
        box_count,
        chamber_type,
        overdue_time,
        photo_capture_time,
        time_variance_minutes,
        created_at, 
        updated_at
      FROM daily_chamber_temp_logs
      WHERE is_native = 1
      ORDER BY entry_date DESC, id DESC
    `);
    return res.status(200).json({
      success: true,
      data: rows
    });
  } catch (error) {
    return handleControllerError(res, error, {
      checkpoint: 'Error_fetching_inspections_error_',
      req,
      clientMessage: 'Failed to fetch inspections.'
    });
  }
};

// 5. Delete daily inspection
exports.deleteInspection = async (req, res) => {
  try {
    const { id } = req.params;
    let remarks = (req.body.remarks || req.query.remarks || '').trim();

    if (!remarks) {
      remarks = 'Deleted by Super Admin';
    }
    
    // Fetch log details before deleting for audit activity log
    const [logRows] = await db.query('SELECT reference_no, chamber_name, client_name FROM daily_chamber_temp_logs WHERE id = ? LIMIT 1', [id]);
    const logItem = logRows[0];

    await db.query('DELETE FROM daily_chamber_temp_logs WHERE id = ?', [id]);

    if (logItem) {
      try {
        await logActivity(
          req.user ? req.user.email : 'unknown',
          'DELETE',
          'Chamber Temp Log',
          `${await getActorLabel(req.user)} deleted Native Chamber Temp record (Ref: ${logItem.reference_no || '-'}) — chamber ${logItem.chamber_name || '-'}, client ${logItem.client_name || '-'}. Remarks: ${remarks}`
        );
      } catch (actErr) {
        console.warn('⚠️ Failed to write operator activity log for inspection deletion:', actErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Inspection log deleted successfully.'
    });
  } catch (error) {
    return handleControllerError(res, error, {
      checkpoint: 'Error_deleting_inspection_error_',
      req,
      clientMessage: 'Failed to delete inspection.'
    });
  }
};

// 5. Add a new chamber-client assignment locally synced from DO Operator
exports.addAssignment = async (req, res) => {
  try {
    const { chamber_id, client_name, remark, chamber_type, warehouse_name: bodyWarehouse } = req.body;
    const isSpecialUser = req.user && (req.user.role === 'super_admin' || req.user.role === 'sub_admin');
    const warehouse_name = isSpecialUser
      ? (bodyWarehouse || null)
      : (req.user ? req.user.warehouse_name : null);

    if (!chamber_id || !client_name) {
      return res.status(400).json({
        success: false,
        message: 'Chamber ID and Client Name are required.'
      });
    }

    let resolvedChamberId = chamber_id;
    const chamberRow = await resolveChamberForAssignment(chamber_id);
    let chamberRows = chamberRow ? [chamberRow] : [];
    if (chamberRow) {
      resolvedChamberId = chamberRow.id;
    }
    const chamber_name = chamberRows[0] ? chamberRows[0].name : `Chamber ${chamber_id}`;
    const requestedType = String(chamber_type || '').trim();
    const existingType = String(chamberRows[0]?.chamber_type || '').trim();
    const resolvedType = existingType || requestedType || 'Frozen';

    // Insert or update to active status
    await db.query(
      "INSERT INTO chamber_client_assignments (chamber_id, client_name, warehouse_name, remark, chamber_type, status) VALUES (?, ?, ?, ?, ?, 'active') ON DUPLICATE KEY UPDATE remark = VALUES(remark), chamber_type = VALUES(chamber_type), status = 'active'",
      [resolvedChamberId, client_name, warehouse_name, remark || null, resolvedType]
    );

    const skipActivity = req.body && (req.body.skip_activity === true || req.body.skip_activity === 1 || req.body.skip_activity === 'true');

    // Write Activity Log
    if (!skipActivity) {
      try {
        const actorLabel = await getActorLabel(req.user);
        const activityEmail = isSpecialUser && req.body.operator_email
          ? String(req.body.operator_email).trim().toLowerCase()
          : (req.user ? req.user.email : 'system');
        const whLabel = warehouse_name ? ` (Warehouse: ${warehouse_name})` : '';
        const resolvedRemark = String(remark || '').trim() || null;
        await logActivity(
          activityEmail,
          'ADD_CLIENT',
          'DO_CHANGE',
          `${actorLabel}${whLabel} Added client "${client_name}" to ${chamber_name}. Remark: ${resolvedRemark || 'None'}`,
          resolvedChamberId,
          resolvedRemark
        );
      } catch (actErr) {
        console.warn('⚠️ Failed to write operator activity log for assignment creation:', actErr.message);
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Assignment added successfully.',
      chamber_type: resolvedType,
      chamber_name
    });
  } catch (error) {
    return handleControllerError(res, error, {
      checkpoint: 'Error_adding_assignment_error_',
      req,
      clientMessage: 'Failed to add assignment.'
    });
  }
};

// 6. Delete/remove a chamber-client assignment locally synced from DO Operator
exports.deleteAssignment = async (req, res) => {
  try {
    const chamber_id = (req.body && req.body.chamber_id) || (req.query && req.query.chamber_id);
    const client_name = (req.body && req.body.client_name) || (req.query && req.query.client_name);
    const remark = (req.body && req.body.remark) || (req.query && req.query.remark);
    const bodyWarehouse = (req.body && req.body.warehouse_name) || (req.query && req.query.warehouse_name);
    const isSpecialUser = req.user && (req.user.role === 'super_admin' || req.user.role === 'sub_admin');
    const warehouse_name = isSpecialUser
      ? (bodyWarehouse || null)
      : (req.user ? req.user.warehouse_name : null);

    if (!chamber_id || !client_name) {
      return res.status(400).json({
        success: false,
        message: 'Chamber ID and Client Name are required.'
      });
    }

    const chamberRow = await resolveChamberForAssignment(chamber_id);
    const resolvedChamberId = chamberRow ? chamberRow.id : chamber_id;
    const chamber_name = chamberRow ? chamberRow.name : `Chamber ${chamber_id}`;

    // Soft delete mapping in MySQL
    await db.query(
      "UPDATE chamber_client_assignments SET status = 'inactive', remark = ? WHERE chamber_id = ? AND LOWER(TRIM(client_name)) = LOWER(TRIM(?)) AND (LOWER(TRIM(COALESCE(warehouse_name, ''))) = LOWER(TRIM(COALESCE(?, ''))) OR warehouse_name IS NULL OR warehouse_name = '')",
      [remark || '', resolvedChamberId, client_name, warehouse_name]
    );

    const skipActivity = (req.body && (req.body.skip_activity === true || req.body.skip_activity === 1 || req.body.skip_activity === 'true'))
      || (req.query && (req.query.skip_activity === 'true' || req.query.skip_activity === '1'));

    // Write Activity Log
    if (!skipActivity) {
      try {
        const actorLabel = await getActorLabel(req.user);
        const activityEmail = isSpecialUser && ((req.body && req.body.operator_email) || (req.query && req.query.operator_email))
          ? String((req.body && req.body.operator_email) || (req.query && req.query.operator_email)).trim().toLowerCase()
          : (req.user ? req.user.email : 'system');
        const whLabel = warehouse_name ? ` (Warehouse: ${warehouse_name})` : '';
        const resolvedRemark = String(remark || '').trim() || null;
        await logActivity(
          activityEmail,
          'DELETE_CLIENT',
          'DO_CHANGE',
          `${actorLabel}${whLabel} Deleted client "${client_name}" from ${chamber_name}. Remark: ${resolvedRemark || 'None'}`,
          resolvedChamberId,
          resolvedRemark
        );
      } catch (actErr) {
        console.warn('⚠️ Failed to write operator activity log for assignment deletion:', actErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Assignment removed successfully.'
    });
  } catch (error) {
    return handleControllerError(res, error, {
      checkpoint: 'Error_deleting_assignment_error_',
      req,
      clientMessage: 'Failed to delete assignment.'
    });
  }
};

// 7. Create a chamber (DO within chamber_limit, or Super Admin)
exports.createChamber = async (req, res) => {
  try {
    let { name, remark, chamber_type } = req.body;
    name = (name || '').trim();
    remark = (remark || '').trim();
    chamber_type = (chamber_type || 'Frozen').trim();

    if (req.user && req.user.role === 'do_operator') {
      let limit = 4;
      try {
        const [userRows] = await db.query(
          'SELECT chamber_limit FROM do_operators WHERE email = ? LIMIT 1',
          [req.user.email]
        );
        if (userRows.length > 0) limit = parseInt(userRows[0].chamber_limit || 4, 10);
      } catch (_) {
        limit = parseInt(req.user.chamber_limit || 4, 10);
      }
      if (!Number.isFinite(limit) || limit < 1) limit = 4;

      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'Chamber name is required.'
        });
      }

      // Super Admin must have allowed this chamber add (ChamberMaster Edit by name hash)
      const { hasActivePermission, consumeGrantedPermission } = require('./permissionController');
      const permId = chamberAddPermissionId(name);
      const allowed = await hasActivePermission(req.user.email, 'ChamberMaster', permId, 'Edit');
      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: 'Super Admin approval is required to add this chamber. Request permission from the app first.'
        });
      }

      let [existing] = await db.query('SELECT id, name, chamber_type FROM chambers ORDER BY id ASC');
      const existingByName = existing.find(
        (c) => String(c.name || '').toLowerCase() === name.toLowerCase()
      );

      const ensureIncluded = async (chamberId) => {
        let picked = pickDoChambers(existing, limit);
        if (picked.some((c) => Number(c.id) === Number(chamberId))) return limit;
        let newLimit = Math.min(50, limit + 1);
        while (
          newLimit <= 50 &&
          !pickDoChambers(existing, newLimit).some((c) => Number(c.id) === Number(chamberId))
        ) {
          newLimit += 1;
        }
        await db.query(
          'UPDATE do_operators SET chamber_limit = ? WHERE email = ?',
          [newLimit, req.user.email]
        );
        limit = newLimit;
        return limit;
      };

      if (existingByName) {
        await ensureIncluded(existingByName.id);
        try {
          await consumeGrantedPermission(req.user.email, 'ChamberMaster', permId, 'Edit');
        } catch (_) {}
        return res.status(200).json({
          success: true,
          message: 'Chamber already assigned.',
          data: {
            id: existingByName.id,
            name: existingByName.name,
            chamber_type: existingByName.chamber_type
          },
          chamber_limit: limit
        });
      }

      // New name — bump limit first so pickDoChambers can include custom after insert
      const current = pickDoChambers(existing, limit);
      if (current.length >= limit) {
        const newLimit = current.length + 1;
        try {
          await db.query(
            'UPDATE do_operators SET chamber_limit = ? WHERE email = ?',
            [newLimit, req.user.email]
          );
          limit = newLimit;
        } catch (_) {}
      }

      const [result] = await db.query('INSERT INTO chambers (name, chamber_type) VALUES (?, ?)', [name, chamber_type]);
      existing = [...existing, { id: result.insertId, name, chamber_type }];
      await ensureIncluded(result.insertId);

      try {
        await consumeGrantedPermission(req.user.email, 'ChamberMaster', permId, 'Edit');
      } catch (_) {}

      try {
        const email = req.user ? req.user.email : 'system';
        const actorLabel = req.user ? (req.user.full_name || email) : 'System';
        await logActivity(
          email,
          'ADD_CHAMBER',
          'DO_CHANGE',
          `${actorLabel} created chamber "${name}" (id: ${result.insertId})${remark ? `. Remark: ${remark}` : ''}.`,
          result.insertId,
          remark || null
        );
      } catch (_) {}

      return res.status(201).json({
        success: true,
        message: 'Chamber created successfully.',
        data: { id: result.insertId, name, chamber_type },
        chamber_limit: limit
      });
    }

    const [existing] = await db.query('SELECT id, name, chamber_type FROM chambers ORDER BY id ASC');
    if (!name) {
      name = `Chamber ${existing.length + 1}`;
    }

    const [dup] = await db.query('SELECT id FROM chambers WHERE name = ? LIMIT 1', [name]);
    if (dup.length > 0) {
      return res.status(400).json({ success: false, message: 'Chamber name already exists.' });
    }

    const [result] = await db.query('INSERT INTO chambers (name, chamber_type) VALUES (?, ?)', [name, chamber_type]);

    try {
      const email = req.user ? req.user.email : 'system';
      const actorLabel = req.user ? (req.user.full_name || email) : 'System';
      await logActivity(
        email,
        'ADD_CHAMBER',
        'DO_CHANGE',
        `${actorLabel} created chamber "${name}" (id: ${result.insertId})${remark ? `. Remark: ${remark}` : ''}.`,
        result.insertId,
        remark || null
      );
    } catch (_) {}

    return res.status(201).json({
      success: true,
      message: 'Chamber created successfully.',
      data: { id: result.insertId, name, chamber_type }
    });
  } catch (error) {
    return handleControllerError(res, error, {
      checkpoint: 'Error_creating_chamber_error_',
      req,
      clientMessage: 'Failed to create chamber.'
    });
  }
};

// 8. Update chamber name
exports.updateChamber = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ success: false, message: 'Chamber ID is required.' });
    }

    const [rows] = await db.query(
      'SELECT id, name, chamber_type FROM chambers WHERE id = ? LIMIT 1',
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Chamber not found.' });
    }

    let { name, chamber_type, remark, operator_email: bodyOperatorEmail, warehouse_name: bodyWarehouse } = req.body;
    if (name === undefined && chamber_type === undefined) {
      return res.status(400).json({ success: false, message: 'No fields to update.' });
    }
    remark = String(remark || '').trim();

    const currentType = String(rows[0].chamber_type || 'Frozen').trim() || 'Frozen';
    const nextType =
      chamber_type !== undefined
        ? String(chamber_type || 'Frozen').trim() || 'Frozen'
        : currentType;
    const typeChanging = chamber_type !== undefined && currentType !== nextType;

    if (req.user && req.user.role === 'do_operator' && typeChanging) {
      const { hasActivePermission } = require('./permissionController');
      const allowed = await hasActivePermission(req.user.email, 'ChamberType', id, 'Edit');
      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: 'Super Admin approval is required to change chamber type. Request permission from the app first.'
        });
      }
    }

    let queryParts = [];
    let queryParams = [];

    if (name !== undefined) {
      name = String(name || '').trim();
      if (!name) {
        return res.status(400).json({ success: false, message: 'Chamber name cannot be empty.' });
      }
      const [dup] = await db.query(
        'SELECT id FROM chambers WHERE name = ? AND id != ? LIMIT 1',
        [name, id]
      );
      if (dup.length > 0) {
        return res.status(400).json({ success: false, message: 'Chamber name already exists.' });
      }
      queryParts.push('name = ?');
      queryParams.push(name);
    }

    if (chamber_type !== undefined) {
      chamber_type = String(chamber_type || 'Frozen').trim();
      queryParts.push('chamber_type = ?');
      queryParams.push(chamber_type);
    }

    if (queryParts.length > 0) {
      queryParams.push(id);
      await db.query(`UPDATE chambers SET ${queryParts.join(', ')} WHERE id = ?`, queryParams);
    }

    if (chamber_type !== undefined) {
      try {
        await db.query(
          "UPDATE chamber_client_assignments SET chamber_type = ? WHERE chamber_id = ? AND status = 'active'",
          [chamber_type, id]
        );
      } catch (_) {}
    }

    const [updated] = await db.query(
      'SELECT id, name, chamber_type FROM chambers WHERE id = ? LIMIT 1',
      [id]
    );

    try {
      if (req.user && req.user.role === 'do_operator' && typeChanging) {
        const { consumeGrantedPermission } = require('./permissionController');
        await consumeGrantedPermission(req.user.email, 'ChamberType', id, 'Edit');
      }
    } catch (_) {}

    try {
      const isSpecialUser = req.user && (req.user.role === 'super_admin' || req.user.role === 'sub_admin');
      const activityEmail = isSpecialUser && bodyOperatorEmail
        ? String(bodyOperatorEmail).trim().toLowerCase()
        : (req.user ? req.user.email : 'system');
      const actorLabel = await getActorLabel(req.user);
      const whLabel = bodyWarehouse ? ` (Warehouse: ${bodyWarehouse})` : '';
      if (typeChanging) {
        await logActivity(
          activityEmail,
          'UPDATE_CHAMBER_ZONE',
          'DO_CHANGE',
          `${actorLabel}${whLabel} updated chamber "${updated[0].name}". Chamber type: ${currentType} → ${nextType}${remark ? `. Remark: ${remark}` : ''}.`,
          id,
          remark || null
        );
      } else {
        await logActivity(
          activityEmail,
          'UPDATE_CHAMBER',
          'DO_CHANGE',
          `${actorLabel}${whLabel} updated chamber "${updated[0].name}" (type: ${updated[0].chamber_type})${remark ? `. Remark: ${remark}` : ''}.`,
          id,
          remark || null
        );
      }
    } catch (_) {}

    return res.status(200).json({
      success: true,
      message: 'Chamber updated successfully.',
      data: updated[0]
    });
  } catch (error) {
    return handleControllerError(res, error, {
      checkpoint: 'Error_updating_chamber_error_',
      req,
      clientMessage: 'Failed to update chamber.'
    });
  }
};

// 9. Delete a chamber (and soft-deactivate its assignments)
exports.deleteChamber = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ success: false, message: 'Chamber ID is required.' });
    }

    // DO must have Super Admin allow (ChamberMaster Delete) before deleting
    if (req.user && req.user.role === 'do_operator') {
      const { hasActivePermission, consumeGrantedPermission } = require('./permissionController');
      const allowed = await hasActivePermission(req.user.email, 'ChamberMaster', id, 'Delete');
      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: 'Super Admin approval is required to delete this chamber. Request permission from the app first.'
        });
      }
    }

    const [rows] = await db.query('SELECT id, name FROM chambers WHERE id = ? LIMIT 1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Chamber not found.' });
    }
    const chamberName = rows[0].name;

    await db.query(
      "UPDATE chamber_client_assignments SET status = 'inactive' WHERE chamber_id = ?",
      [id]
    );
    await db.query('DELETE FROM chambers WHERE id = ?', [id]);

    try {
      if (req.user && req.user.role === 'do_operator') {
        const { consumeGrantedPermission } = require('./permissionController');
        await consumeGrantedPermission(req.user.email, 'ChamberMaster', id, 'Delete');
      }
    } catch (_) {}

    try {
      const email = req.user ? req.user.email : 'system';
      const actorLabel = req.user ? (req.user.full_name || email) : 'System';
      await logActivity(
        email,
        'DELETE_CHAMBER',
        'DO_CHANGE',
        `${actorLabel} deleted chamber "${chamberName}" (id: ${id}).`,
        id,
        (req.body && req.body.remark) || null
      );
    } catch (_) {}

    return res.status(200).json({
      success: true,
      message: 'Chamber deleted successfully.'
    });
  } catch (error) {
    return handleControllerError(res, error, {
      checkpoint: 'Error_deleting_chamber_error_',
      req,
      clientMessage: 'Failed to delete chamber.'
    });
  }
};
