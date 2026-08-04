// ====================================================================
// Daily Chamber Temp Log Controller (backend/controllers/chamberTempController.js)
// Handles temp_sensor_image file uploads stored in uploads/daily_temp_monitor_images/
// ====================================================================

const db = require('../config/db');
const exifr = require('exifr');
const fs = require('fs');
const { logActivity, getActorLabel } = require('../utils/logger');
const { buildDiffString } = require('../utils/diffBuilder');
const { parsePagination, sendPaginated, appendWarehouseFilter } = require('../utils/pagination');
const { logErrorCheckpoint } = require('../utils/errorHandler');

let memoryChamberLogs = [];

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
    
    const [hours, minutes] = inspectionTimeStr.split(':').map(Number);
    
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

    if (isNaN(parsedCapture.getTime())) return 0;

    const diffMs = Math.abs(parsedCapture.getTime() - inspectionDate.getTime());
    return Math.round(diffMs / (1000 * 60));
  } catch (e) {
    console.error('Error calculating variance:', e);
    return 0;
  }
}

// GET all chamber temp logs
exports.getChamberLogs = async (req, res) => {
  const { search } = req.query;
  const { page, limit, offset } = parsePagination(req.query);

  try {
    let conditions = [];
    let params = [];

    if (req.user && req.user.role === 'do_operator' && req.user.warehouse_name) {
      conditions.push('(warehouse_name = ? OR warehouse_name IS NULL)');
      params.push(req.user.warehouse_name);
    }

    // Sub-Admin scoped filtering by allowed clients & warehouses
    if (req.user && req.user.role === 'sub_admin') {
      if (req.user.allowed_clients) {
        const clients = req.user.allowed_clients.split(',').map(c => c.trim()).filter(Boolean);
        if (clients.length > 0) {
          const placeholders = clients.map(() => '?').join(', ');
          conditions.push(`client_name IN (${placeholders})`);
          params.push(...clients);
        }
      }
      if (req.user.allowed_warehouses) {
        const warehouses = req.user.allowed_warehouses.split(',').map(w => w.trim()).filter(Boolean);
        if (warehouses.length > 0) {
          const placeholders = warehouses.map(() => '?').join(', ');
          conditions.push(`(warehouse_name IN (${placeholders}) OR warehouse_name IS NULL)`);
          params.push(...warehouses);
        }
      }
    }

    if (search) {
      conditions.push('(reference_no LIKE ? OR client_name LIKE ? OR chamber_name LIKE ? OR monitor_supervisor_name LIKE ? OR inspection_time LIKE ? OR operator_email LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const { fromDate, toDate } = req.query;
    if (fromDate) {
      conditions.push('entry_date >= ?');
      params.push(fromDate);
    }
    if (toDate) {
      conditions.push('entry_date <= ?');
      params.push(toDate);
    }

    appendWarehouseFilter(conditions, params, req.query, req.user);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM daily_chamber_temp_logs ${whereClause}`,
      params
    );
    const total = countRows[0]?.total ?? 0;

    const query = `SELECT id, reference_no, entry_date, client_name, chamber_name, inspection_time, box_temp, box_temp AS chamber_temp, box_count, overdue_time, monitor_supervisor_name, temp_sensor_image, photo_capture_time, time_variance_minutes, update_details, update_count, DATE_FORMAT(entry_date, '%Y-%m-%d') as formatted_date, created_at, updated_at, warehouse_name, operator_email, chamber_type FROM daily_chamber_temp_logs ${whereClause} ORDER BY entry_date DESC, id DESC LIMIT ? OFFSET ?`;

    const [rows] = await db.query(query, [...params, limit, offset]);
    return sendPaginated(res, rows, total, page, limit);
  } catch (err) {
    // Soft-fail to in-memory fallback, but keep a structured checkpoint for Super Admin
    await logErrorCheckpoint(err, {
      checkpoint: 'getChamberLogs',
      statusCode: 500,
      method: req.method,
      url: req.originalUrl,
      email: req.user?.email || 'system'
    });
    let filtered = [...memoryChamberLogs];
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(l => 
        (l.reference_no && l.reference_no.toLowerCase().includes(q)) ||
        (l.client_name && l.client_name.toLowerCase().includes(q)) ||
        (l.chamber_name && l.chamber_name.toLowerCase().includes(q)) ||
        (l.inspection_time && l.inspection_time.toLowerCase().includes(q)) ||
        (l.monitor_supervisor_name && l.monitor_supervisor_name.toLowerCase().includes(q))
      );
    }
    return sendPaginated(res, filtered.slice(offset, offset + limit), filtered.length, page, limit);
  }
};

// CREATE a new chamber temp log
exports.addChamberLog = async (req, res) => {
  const { 
    entry_date, 
    client_name, 
    chamber_name, 
    inspection_time, 
    box_temp, 
    monitor_supervisor_name 
  } = req.body;

  let temp_sensor_image = null;
  let photo_capture_time = req.body.photo_capture_time || null;
  let time_variance_minutes = req.body.time_variance_minutes !== undefined ? parseInt(req.body.time_variance_minutes) : 0;

  if (req.file) {
    temp_sensor_image = `uploads/daily_temp_monitor_images/${req.file.filename}`;
    if (!photo_capture_time) {
      try {
        const exif = await exifr.parse(req.file.path);
        if (exif && exif.DateTimeOriginal) {
          const captureDate = exif.DateTimeOriginal;
          photo_capture_time = formatDateTime(captureDate);
          time_variance_minutes = calculateVariance(entry_date, inspection_time || '11:00', captureDate);
        } else {
          const stats = fs.statSync(req.file.path);
          const fileTime = stats.birthtime || stats.mtime;
          photo_capture_time = formatDateTime(fileTime);
          time_variance_minutes = calculateVariance(entry_date, inspection_time || '11:00', fileTime);
        }
      } catch (e) {
        console.warn('Warning: Failed to parse EXIF metadata. Defaulting to file stats or current time.', e.message);
        const now = new Date();
        photo_capture_time = formatDateTime(now);
        time_variance_minutes = calculateVariance(entry_date, inspection_time || '11:00', now);
      }
    }
  } else if (req.body.temp_sensor_image_base64) {
    temp_sensor_image = req.body.temp_sensor_image_base64;
    if (!photo_capture_time) {
      const now = new Date();
      photo_capture_time = formatDateTime(now);
      time_variance_minutes = calculateVariance(entry_date, inspection_time || '11:00', now);
    }
  }

  if (!entry_date || !client_name || !chamber_name || box_temp === undefined || !monitor_supervisor_name) {
    return res.status(400).json({ error: 'Entry Date, Client Name, Chamber Name, Box Temp, and Monitor Supervisor Name are required.' });
  }

  try {
    const localTimestamp = formatDateTime(new Date());
    const query = `
      INSERT INTO daily_chamber_temp_logs 
      (entry_date, client_name, chamber_name, inspection_time, box_temp, monitor_supervisor_name, temp_sensor_image, photo_capture_time, time_variance_minutes, created_at, updated_at, warehouse_name, operator_email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [
      entry_date, 
      client_name, 
      chamber_name, 
      inspection_time || '11:00',
      box_temp,
      monitor_supervisor_name,
      temp_sensor_image,
      photo_capture_time,
      time_variance_minutes,
      localTimestamp,
      localTimestamp,
      req.user ? req.user.warehouse_name : null,
      req.user ? req.user.email : null
    ];

    const [result] = await db.query(query, values);
    const insertId = result.insertId;
    const reference_no = `RF-CH-26-${String(insertId).padStart(4, '0')}`;
    try {
      await db.query('UPDATE daily_chamber_temp_logs SET reference_no = ? WHERE id = ?', [reference_no, insertId]);
    } catch (refErr) {
      console.warn('⚠️ Failed to update reference_no for new chamber log:', refErr.message);
    }
    
    // Log Operator Activity
    await logActivity(
      req.user ? req.user.email : 'unknown',
      'CREATE',
      'Chamber Temp Log',
      `${await getActorLabel(req.user)} created Chamber Temp record (Ref: ${reference_no}) — chamber ${chamber_name || '-'}, client ${client_name || '-'}, date ${entry_date || '-'}`
    );

    return res.status(201).json({ id: insertId, reference_no, temp_sensor_image, photo_capture_time, time_variance_minutes, message: 'Chamber temperature record saved.' });
  } catch (err) {
    await logErrorCheckpoint(err, {
      checkpoint: 'addChamberLog',
      statusCode: 500,
      method: req.method,
      url: req.originalUrl,
      email: req.user?.email || 'system'
    });
    const newLog = {
      id: Date.now(),
      entry_date,
      formatted_date: entry_date,
      client_name,
      chamber_name,
      inspection_time: inspection_time || '11:00',
      box_temp: parseFloat(box_temp),
      monitor_supervisor_name,
      temp_sensor_image,
      photo_capture_time,
      time_variance_minutes,
      created_at: new Date().toISOString()
    };
    memoryChamberLogs.unshift(newLog);
    return res.status(201).json({ id: newLog.id, temp_sensor_image, photo_capture_time, time_variance_minutes, message: 'Chamber temperature record saved (memory).' });
  }
};

// UPDATE temperature fields inline
exports.updateChamberLog = async (req, res) => {
  const { id } = req.params;
  const { chamber_name, inspection_time, box_temp, monitor_supervisor_name, entry_date, client_name, remarks } = req.body;

  if (!remarks || !remarks.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Remarks are required to update this log.'
    });
  }

  try {
    const [existingRows] = await db.query('SELECT reference_no, entry_date, client_name, chamber_name, inspection_time, box_temp, monitor_supervisor_name, temp_sensor_image, photo_capture_time, time_variance_minutes, update_details, update_count, chamber_type FROM daily_chamber_temp_logs WHERE id = ?', [id]);
    
    let temp_sensor_image = req.body.temp_sensor_image;
    let photo_capture_time = null;
    let time_variance_minutes = 0;
    let update_details = null;
    let update_count = 0;

    if (existingRows.length > 0) {
      const current = existingRows[0];
      if (!temp_sensor_image) {
        temp_sensor_image = current.temp_sensor_image;
      }
      photo_capture_time = current.photo_capture_time;
      time_variance_minutes = current.time_variance_minutes;
      
      const mergedEntryDate = entry_date || current.entry_date;
      const mergedInspectionTime = inspection_time || current.inspection_time;

      if (req.file) {
        temp_sensor_image = `uploads/daily_temp_monitor_images/${req.file.filename}`;
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
          const now = new Date();
          photo_capture_time = formatDateTime(now);
        }
      }

      if (photo_capture_time) {
        time_variance_minutes = calculateVariance(mergedEntryDate, mergedInspectionTime, photo_capture_time);
      }

      const updatedValues = {
        entry_date: entry_date || current.entry_date,
        client_name: client_name || current.client_name,
        chamber_name: chamber_name || current.chamber_name,
        inspection_time: inspection_time || current.inspection_time,
        box_temp: box_temp !== undefined ? (box_temp !== '' ? parseFloat(box_temp) : null) : current.box_temp,
        monitor_supervisor_name: monitor_supervisor_name || current.monitor_supervisor_name,
        temp_sensor_image: temp_sensor_image,
        box_count: req.body.box_count !== undefined ? (req.body.box_count !== '' ? parseInt(req.body.box_count, 10) : null) : current.box_count
      };

      const chamberFieldMapping = {
        entry_date: 'Date',
        client_name: 'Client Name',
        chamber_name: 'Chamber',
        inspection_time: 'Inspection Time',
        box_temp: 'Box Temp',
        monitor_supervisor_name: 'Supervisor',
        temp_sensor_image: 'Sensor Image',
        box_count: 'Box Count'
      };

      update_details = buildDiffString(current, updatedValues, chamberFieldMapping);
      update_count = (parseInt(current.update_count, 10) || 0) + 1;
    }

    const localTimestamp = formatDateTime(new Date());
    const query = `
      UPDATE daily_chamber_temp_logs 
      SET 
        entry_date = COALESCE(?, entry_date),
        client_name = COALESCE(?, client_name),
        chamber_name = COALESCE(?, chamber_name), 
        inspection_time = COALESCE(?, inspection_time), 
        box_temp = COALESCE(?, box_temp), 
        monitor_supervisor_name = COALESCE(?, monitor_supervisor_name),
        temp_sensor_image = COALESCE(?, temp_sensor_image),
        photo_capture_time = ?,
        time_variance_minutes = ?,
        update_details = ?,
        update_count = ?,
        remarks = ?,
        updated_at = ?
      WHERE id = ?
    `;
    await db.query(query, [
      entry_date || null,
      client_name || null,
      chamber_name || null,
      inspection_time || null,
      box_temp !== undefined ? (box_temp !== '' ? box_temp : null) : null,
      monitor_supervisor_name || null,
      temp_sensor_image,
      photo_capture_time,
      time_variance_minutes,
      update_details || null,
      update_count,
      remarks || null,
      localTimestamp,
      id
    ]);

    // Log Operator Activity (includes Super Admin / Sub Admin / DO updates)
    const refNo = (existingRows[0] && existingRows[0].reference_no) || `RF-CH-26-${String(id).padStart(4, '0')}`;
    await logActivity(
      req.user ? req.user.email : 'unknown',
      'UPDATE',
      'Chamber Temp Log',
      `${await getActorLabel(req.user)} updated Chamber Temp record (Ref: ${refNo})${update_details ? `. Changes: ${update_details}` : ''}. Remarks: ${remarks}`
    );

    return res.json({ message: 'Record updated successfully.', photo_capture_time, time_variance_minutes });
  } catch (err) {
    await logErrorCheckpoint(err, {
      checkpoint: 'updateChamberLog',
      statusCode: 500,
      method: req.method,
      url: req.originalUrl,
      email: req.user?.email || 'system'
    });
    const item = memoryChamberLogs.find(l => l.id == id);
    if (item) {
      if (entry_date) item.entry_date = entry_date;
      if (client_name) item.client_name = client_name;
      if (chamber_name) item.chamber_name = chamber_name;
      if (inspection_time) item.inspection_time = inspection_time;
      if (box_temp !== undefined) item.box_temp = box_temp !== '' ? parseFloat(box_temp) : null;
      if (monitor_supervisor_name) item.monitor_supervisor_name = monitor_supervisor_name;
      if (req.file) {
        item.temp_sensor_image = `uploads/daily_temp_monitor_images/${req.file.filename}`;
        const now = new Date();
        item.photo_capture_time = formatDateTime(now);
      }
      if (item.photo_capture_time) {
        const mergedDate = entry_date || item.entry_date;
        const mergedTime = inspection_time || item.inspection_time;
        item.time_variance_minutes = calculateVariance(mergedDate, mergedTime, item.photo_capture_time);
      }
    }
    return res.json({ message: 'Record updated in memory.' });
  }
};

// DELETE record
exports.deleteChamberLog = async (req, res) => {
  const { id } = req.params;
  const remarks = (req.body.remarks || req.query.remarks || '').trim();

  if (!remarks) {
    return res.status(400).json({
      success: false,
      message: 'Remarks are required to delete this log.'
    });
  }

  try {
    const [rows] = await db.query(
      'SELECT reference_no, chamber_name, client_name FROM daily_chamber_temp_logs WHERE id = ?',
      [id]
    );
    const record = rows[0] || {};
    const refNo = record.reference_no || `RF-CH-26-${String(id).padStart(4, '0')}`;
    const chamberName = record.chamber_name || '-';
    const clientName = record.client_name || '-';

    await db.query(`DELETE FROM daily_chamber_temp_logs WHERE id = ?`, [id]);
    
    // Log Operator Activity
    await logActivity(
      req.user ? req.user.email : 'unknown',
      'DELETE',
      'Chamber Temp Log',
      `${await getActorLabel(req.user)} deleted Chamber Temp record (Ref: ${refNo}) — chamber ${chamberName}, client ${clientName}. Remarks: ${remarks}`
    );

    return res.json({ message: 'Record deleted successfully.' });
  } catch (err) {
    await logErrorCheckpoint(err, {
      checkpoint: 'deleteChamberLog',
      statusCode: 500,
      method: req.method,
      url: req.originalUrl,
      email: req.user?.email || 'system'
    });
    memoryChamberLogs = memoryChamberLogs.filter(l => l.id != id);
    return res.json({ message: 'Record deleted from memory.' });
  }
};
