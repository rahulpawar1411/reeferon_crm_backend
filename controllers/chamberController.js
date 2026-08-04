const db = require('../config/db');
const { logErrorCheckpoint } = require('../utils/errorHandler');
const exifr = require('exifr');
const fs = require('fs');
const { logActivity, getActorLabel } = require('../utils/logger');

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
    const [rows] = await db.query('SELECT id, name FROM chambers ORDER BY name ASC');
    
    // Filter chambers for Data Operators based on their assigned chamber limit
    let filteredRows = rows;
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

      filteredRows = rows.filter(row => {
        const numMatch = row.name.match(/\d+/);
        const chamberNum = numMatch ? parseInt(numMatch[0], 10) : null;
        return chamberNum === null || chamberNum <= limit;
      });
    }

    return res.status(200).json({
      success: true,
      data: filteredRows
    });
  } catch (error) {
    console.error('Error fetching chambers:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch chambers.',
      error: error.message
    });
  }
};

// 2. Fetch all active client chamber assignments (Admin managed)
exports.getAssignments = async (req, res) => {
  try {
    const query = `
      SELECT cca.chamber_id, c.name AS chamber_name, cca.client_name
      FROM chamber_client_assignments cca
      JOIN chambers c ON cca.chamber_id = c.id
      ORDER BY c.name ASC, cca.client_name ASC
    `;
    const [rows] = await db.query(query);

    // Filter assignments for Data Operators based on their assigned chamber limit
    let filteredRows = rows;
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

      filteredRows = rows.filter(row => {
        const numMatch = row.chamber_name.match(/\d+/);
        const chamberNum = numMatch ? parseInt(numMatch[0], 10) : null;
        return chamberNum === null || chamberNum <= limit;
      });
    }

    return res.status(200).json({
      success: true,
      data: filteredRows
    });
  } catch (error) {
    console.error('Error fetching assignments:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch chamber client assignments.',
      error: error.message
    });
  }
};

// 3. Log a daily chamber client box temperature inspection (DO Operator Submission)
exports.addInspection = async (req, res) => {
  try {
    const { operator_name, chamber_id, client_name, entry_date, entry_time, box_temp, box_count, chamber_type, overdue_time, photo_capture_time: bodyCaptureTime } = req.body;

    // Validation checks
    if (!operator_name || !chamber_id || !client_name || !entry_date || !entry_time || box_temp === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Operator Name, Chamber ID, Client Name, Date, Time, and Temperature are required.'
      });
    }

    const tempVal = parseFloat(box_temp);
    const boxCountVal = box_count !== undefined && box_count !== null && box_count !== '' ? parseInt(box_count, 10) : null;
    
    // Resolve chamber_name from chamber_id
    const [chamberRows] = await db.query('SELECT name FROM chambers WHERE id = ? LIMIT 1', [chamber_id]);
    const chamber_name = chamberRows[0] ? chamberRows[0].name : `Chamber ${chamber_id}`;

    // Programmatic duplicate check to prevent double submissions on the same shift today
    const [existing] = await db.query(
      `SELECT id FROM daily_chamber_temp_logs 
       WHERE entry_date = ? AND chamber_name = ? AND client_name = ? AND inspection_time = ? LIMIT 1`,
      [entry_date, chamber_name, client_name, entry_time]
    );
    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Duplicate submission: A temperature log for this client in this chamber has already been recorded today.'
      });
    }

    // Resolve upload photo path
    let photoUrl = null;
    let photo_capture_time = bodyCaptureTime || null;
    let time_variance_minutes = 0;

    if (req.file) {
      photoUrl = `uploads/daily_temp_monitor_images/${req.file.filename}`;
      
      // If photo_capture_time is not provided, try to extract it from image EXIF or file stats
      if (!photo_capture_time) {
        try {
          const exif = await exifr.parse(req.file.path);
          if (exif && exif.DateTimeOriginal) {
            const captureDate = exif.DateTimeOriginal;
            photo_capture_time = formatDateTime(captureDate);
          } else {
            const stats = fs.statSync(req.file.path);
            const fileTime = stats.birthtime || stats.mtime;
            photo_capture_time = formatDateTime(fileTime);
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
      (entry_date, client_name, chamber_name, inspection_time, box_temp, monitor_supervisor_name, temp_sensor_image, warehouse_name, operator_email, is_native, box_count, chamber_type, overdue_time, photo_capture_time, time_variance_minutes, shift)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
      entry_date,
      client_name,
      chamber_name,
      entry_time,
      tempVal,
      operator_name,
      photoUrl,
      req.user ? req.user.warehouse_name : null,
      req.user ? req.user.email : null,
      boxCountVal,
      chamber_type || 'Frozen',
      overdue_time || 'same day',
      photo_capture_time,
      time_variance_minutes,
      req.body.shift || (entry_time === '10:00 AM' ? 'Morning' : 'Evening')
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
    console.error('Error logging daily inspection:', error);
    await logErrorCheckpoint(error, {
      checkpoint: 'addInspection',
      statusCode: 500,
      method: req.method,
      url: req.originalUrl,
      email: req.user?.email || 'system'
    });

    return res.status(500).json({
      success: false,
      message: 'Server error while recording temperature log.',
      error: error.message
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
    console.error('Error fetching inspections:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch inspections.',
      error: error.message
    });
  }
};

// 5. Delete daily inspection
exports.deleteInspection = async (req, res) => {
  try {
    const { id } = req.params;
    const remarks = (req.body.remarks || req.query.remarks || '').trim();

    if (!remarks) {
      return res.status(400).json({
        success: false,
        message: 'Remarks are required to delete this log.'
      });
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
    console.error('Error deleting inspection:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete inspection.',
      error: error.message
    });
  }
};
