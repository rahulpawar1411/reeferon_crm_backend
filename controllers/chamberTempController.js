// ====================================================================
// Daily Chamber Temp Log Controller (backend/controllers/chamberTempController.js)
// Handles temp_sensor_image file uploads stored in uploads/daily_temp_monitor_images/
// ====================================================================

const db = require('../config/db');
const exifr = require('exifr');
const fs = require('fs');
const { logActivity } = require('../utils/logger');

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

  try {
    let query = `SELECT id, entry_date, client_name, chamber_name, inspection_time, chamber_temp, monitor_supervisor_name, temp_sensor_image, photo_capture_time, time_variance_minutes, DATE_FORMAT(entry_date, '%Y-%m-%d') as formatted_date, created_at, updated_at FROM daily_chamber_temp_logs ORDER BY entry_date DESC, id DESC`;
    let params = [];

    if (search) {
      query = `SELECT id, entry_date, client_name, chamber_name, inspection_time, chamber_temp, monitor_supervisor_name, temp_sensor_image, photo_capture_time, time_variance_minutes, DATE_FORMAT(entry_date, '%Y-%m-%d') as formatted_date, created_at, updated_at FROM daily_chamber_temp_logs 
               WHERE client_name LIKE ? OR chamber_name LIKE ? OR monitor_supervisor_name LIKE ? OR inspection_time LIKE ?
               ORDER BY entry_date DESC, id DESC`;
      params = [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`];
    }

    const [rows] = await db.query(query, params);
    return res.json(rows);
  } catch (err) {
    let filtered = [...memoryChamberLogs];
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(l => 
        (l.client_name && l.client_name.toLowerCase().includes(q)) ||
        (l.chamber_name && l.chamber_name.toLowerCase().includes(q)) ||
        (l.inspection_time && l.inspection_time.toLowerCase().includes(q)) ||
        (l.monitor_supervisor_name && l.monitor_supervisor_name.toLowerCase().includes(q))
      );
    }
    return res.json(filtered);
  }
};

// CREATE a new chamber temp log
exports.addChamberLog = async (req, res) => {
  const { 
    entry_date, 
    client_name, 
    chamber_name, 
    inspection_time, 
    chamber_temp, 
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

  if (!entry_date || !client_name || !chamber_name || !chamber_temp || !monitor_supervisor_name) {
    return res.status(400).json({ error: 'Entry Date, Client Name, Chamber Name, Chamber Temp, and Monitor Supervisor Name are required.' });
  }

  try {
    const localTimestamp = formatDateTime(new Date());
    const query = `
      INSERT INTO daily_chamber_temp_logs 
      (entry_date, client_name, chamber_name, inspection_time, chamber_temp, monitor_supervisor_name, temp_sensor_image, photo_capture_time, time_variance_minutes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [
      entry_date, 
      client_name, 
      chamber_name, 
      inspection_time || '11:00',
      chamber_temp,
      monitor_supervisor_name,
      temp_sensor_image,
      photo_capture_time,
      time_variance_minutes,
      localTimestamp,
      localTimestamp
    ];

    const [result] = await db.query(query, values);
    
    // Log Operator Activity
    await logActivity(
      req.user ? req.user.email : 'unknown',
      'CREATE',
      'Chamber Temp Log',
      `Created Chamber Temp record for entry date ${entry_date} and client ${client_name}`
    );

    return res.status(201).json({ id: result.insertId, temp_sensor_image, photo_capture_time, time_variance_minutes, message: 'Chamber temperature record saved.' });
  } catch (err) {
    const newLog = {
      id: Date.now(),
      entry_date,
      formatted_date: entry_date,
      client_name,
      chamber_name,
      inspection_time: inspection_time || '11:00',
      chamber_temp: parseFloat(chamber_temp),
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
  const { chamber_name, inspection_time, chamber_temp, monitor_supervisor_name, entry_date, client_name } = req.body;

  try {
    const [existingRows] = await db.query('SELECT entry_date, inspection_time, temp_sensor_image, photo_capture_time, time_variance_minutes FROM daily_chamber_temp_logs WHERE id = ?', [id]);
    
    let temp_sensor_image = req.body.temp_sensor_image;
    let photo_capture_time = null;
    let time_variance_minutes = 0;

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
    }

    const localTimestamp = formatDateTime(new Date());
    const query = `
      UPDATE daily_chamber_temp_logs 
      SET 
        entry_date = COALESCE(?, entry_date),
        client_name = COALESCE(?, client_name),
        chamber_name = COALESCE(?, chamber_name), 
        inspection_time = COALESCE(?, inspection_time), 
        chamber_temp = COALESCE(?, chamber_temp), 
        monitor_supervisor_name = COALESCE(?, monitor_supervisor_name),
        temp_sensor_image = COALESCE(?, temp_sensor_image),
        photo_capture_time = ?,
        time_variance_minutes = ?,
        updated_at = ?
      WHERE id = ?
    `;
    await db.query(query, [
      entry_date || null,
      client_name || null,
      chamber_name || null,
      inspection_time || null,
      chamber_temp !== undefined ? (chamber_temp !== '' ? chamber_temp : null) : null,
      monitor_supervisor_name || null,
      temp_sensor_image,
      photo_capture_time,
      time_variance_minutes,
      localTimestamp,
      id
    ]);

    // Log Operator Activity
    await logActivity(
      req.user ? req.user.email : 'unknown',
      'UPDATE',
      'Chamber Temp Log',
      `Updated Chamber Temp record ID #${id}`
    );

    return res.json({ message: 'Record updated successfully.', photo_capture_time, time_variance_minutes });
  } catch (err) {
    const item = memoryChamberLogs.find(l => l.id == id);
    if (item) {
      if (entry_date) item.entry_date = entry_date;
      if (client_name) item.client_name = client_name;
      if (chamber_name) item.chamber_name = chamber_name;
      if (inspection_time) item.inspection_time = inspection_time;
      if (chamber_temp !== undefined) item.chamber_temp = chamber_temp !== '' ? parseFloat(chamber_temp) : null;
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

  try {
    await db.query(`DELETE FROM daily_chamber_temp_logs WHERE id = ?`, [id]);
    
    // Log Operator Activity
    await logActivity(
      req.user ? req.user.email : 'unknown',
      'DELETE',
      'Chamber Temp Log',
      `Deleted Chamber Temp record ID #${id}`
    );

    return res.json({ message: 'Record deleted successfully.' });
  } catch (err) {
    memoryChamberLogs = memoryChamberLogs.filter(l => l.id != id);
    return res.json({ message: 'Record deleted from memory.' });
  }
};
