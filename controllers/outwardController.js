// ====================================================================
// Outward Controller (controllers/outwardController.js)
// Implements CRUD APIs and file saving for the DO Outward Temp Monitor.
// ====================================================================

const db = require('../config/db');
const fs = require('fs');
const path = require('path');
const { logActivity } = require('../utils/logger');

// Helper to format date
function formatDateTime(date) {
  if (!date || isNaN(date.getTime())) return '';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

// 1. GET ALL OUTWARD LOGS (With optional search query)
exports.getOutwardLogs = async (req, res) => {
  try {
    const { search } = req.query;
    let conditions = [];
    let params = [];

    if (req.user && req.user.role === 'do_operator' && req.user.warehouse_name) {
      conditions.push('(warehouse_name = ? OR warehouse_name IS NULL)');
      params.push(req.user.warehouse_name);
    }

    if (search) {
      conditions.push('(outward_vehicle_no LIKE ? OR outward_client_name LIKE ? OR outward_transporter_name LIKE ? OR outward_driver_name LIKE ?)');
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern, pattern);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
      SELECT outward_id, DATE_FORMAT(outward_entry_date, '%Y-%m-%d') as outward_entry_date, outward_vehicle_no, outward_seal_no, 
             outward_vehicle_temp, outward_material_temp, outward_transporter_name, outward_driver_name, outward_driver_no, 
             outward_client_name, outward_dock_no, outward_vehicle_reporting_time, outward_loading_start_time,
             outward_loading_duration_hours, outward_loading_duration_mins, outward_loading_end_time, 
             outward_pallets_in_qty, outward_invoice_qty, outward_received_qty, outward_received_boxes_qty, 
             outward_short_received_boxes_qty, outward_excess_received_boxes_qty, outward_damage_received_boxes_qty, 
             outward_material_type, outward_loading_supervisor_name, outward_remarks, outward_invoice_photos, outward_pod_photo, 
             outward_vehicle_seal_photo, outward_vehicle_temp_photo, outward_material_temp_photo, outward_vehicle_back_side_photo, 
             outward_vehicle_back_side_photo_with_material, outward_count_sheet_photo, outward_damage_boxes_photo, outward_created_at, outward_updated_at, warehouse_name, operator_email
      FROM outward_temp_logs 
      ${whereClause}
      ORDER BY outward_entry_date DESC, outward_id DESC
    `;

    const [rows] = await db.query(query, params);
    return res.json(rows);
  } catch (err) {
    console.error('Error fetching outward logs:', err);
    return res.status(500).json({ error: 'Failed to fetch outward logs.' });
  }
};

// 2. CREATE A NEW OUTWARD LOG
exports.addOutwardLog = async (req, res) => {
  try {
    const data = req.body;
    const files = req.files || {};

    let damage_photos_list = [];
    if (files.outward_damage_boxes_photo) {
      damage_photos_list = files.outward_damage_boxes_photo.map(f => `uploads/outward_images/${f.filename}`);
    }
    const outward_damage_boxes_photo = damage_photos_list.length > 0 ? damage_photos_list.join(',') : null;

    // Single photos mapping
    const getPhotoPath = (fieldName) => {
      return files[fieldName] ? `uploads/outward_images/${files[fieldName][0].filename}` : null;
    };

    const outward_invoice_photos = getPhotoPath('outward_invoice_photos');
    const outward_pod_photo = getPhotoPath('outward_pod_photo');
    const outward_vehicle_seal_photo = getPhotoPath('outward_vehicle_seal_photo');
    const outward_vehicle_temp_photo = getPhotoPath('outward_vehicle_temp_photo');
    const outward_material_temp_photo = getPhotoPath('outward_material_temp_photo');
    const outward_vehicle_back_side_photo = getPhotoPath('outward_vehicle_back_side_photo');
    const outward_vehicle_back_side_photo_with_material = getPhotoPath('outward_vehicle_back_side_photo_with_material');
    const outward_count_sheet_photo = getPhotoPath('outward_count_sheet_photo');

    // Required fields check
    if (!data.outward_entry_date || !data.outward_vehicle_no || !data.outward_client_name) {
      return res.status(400).json({ error: 'Date, Vehicle No, and Client Name are required.' });
    }

    const localTimestamp = formatDateTime(new Date());

    let startWithDate = data.outward_loading_start_time || null;
    if (data.outward_entry_date && data.outward_loading_start_time) {
      const dateParts = data.outward_entry_date.split('-');
      if (dateParts.length === 3) {
        const [yyyy, mm, dd] = dateParts;
        if (!data.outward_loading_start_time.includes('-')) {
          startWithDate = `${dd}-${mm}-${yyyy} ${data.outward_loading_start_time}`;
        }
      }
    }

    const query = `
      INSERT INTO outward_temp_logs (
        outward_entry_date, outward_vehicle_no, outward_seal_no, outward_vehicle_temp, outward_material_temp, outward_transporter_name, 
        outward_driver_name, outward_driver_no, outward_client_name, outward_dock_no, outward_vehicle_reporting_time, 
        outward_loading_start_time, outward_loading_duration_hours, outward_loading_duration_mins, outward_loading_end_time, outward_pallets_in_qty, outward_invoice_qty, 
        outward_received_qty, outward_received_boxes_qty, outward_short_received_boxes_qty, outward_excess_received_boxes_qty, 
        outward_damage_received_boxes_qty, outward_material_type, outward_loading_supervisor_name, outward_remarks, 
        outward_invoice_photos, outward_pod_photo, outward_vehicle_seal_photo, outward_vehicle_temp_photo, 
        outward_material_temp_photo, outward_vehicle_back_side_photo, outward_vehicle_back_side_photo_with_material, outward_count_sheet_photo, outward_damage_boxes_photo,
        outward_created_at, outward_updated_at, warehouse_name, operator_email
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      data.outward_entry_date,
      data.outward_vehicle_no,
      data.outward_seal_no || null,
      data.outward_vehicle_temp !== undefined && data.outward_vehicle_temp !== '' ? parseFloat(data.outward_vehicle_temp) : null,
      data.outward_material_temp !== undefined && data.outward_material_temp !== '' ? parseFloat(data.outward_material_temp) : null,
      data.outward_transporter_name || null,
      data.outward_driver_name || null,
      data.outward_driver_no || null,
      data.outward_client_name,
      data.outward_dock_no || null,
      data.outward_vehicle_reporting_time || null,
      startWithDate,
      data.outward_loading_duration_hours || null,
      data.outward_loading_duration_mins || null,
      data.outward_loading_end_time || null,
      data.outward_pallets_in_qty !== undefined && data.outward_pallets_in_qty !== '' ? parseInt(data.outward_pallets_in_qty) : 0,
      data.outward_invoice_qty !== undefined && data.outward_invoice_qty !== '' ? parseInt(data.outward_invoice_qty) : 0,
      data.outward_received_qty !== undefined && data.outward_received_qty !== '' ? parseInt(data.outward_received_qty) : 0,
      data.outward_received_boxes_qty !== undefined && data.outward_received_boxes_qty !== '' ? parseInt(data.outward_received_boxes_qty) : 0,
      data.outward_short_received_boxes_qty !== undefined && data.outward_short_received_boxes_qty !== '' ? parseInt(data.outward_short_received_boxes_qty) : 0,
      data.outward_excess_received_boxes_qty !== undefined && data.outward_excess_received_boxes_qty !== '' ? parseInt(data.outward_excess_received_boxes_qty) : 0,
      data.outward_damage_received_boxes_qty !== undefined && data.outward_damage_received_boxes_qty !== '' ? parseInt(data.outward_damage_received_boxes_qty) : 0,
      data.outward_material_type || null,
      data.outward_loading_supervisor_name || null,
      data.outward_remarks || null,
      outward_invoice_photos,
      outward_pod_photo,
      outward_vehicle_seal_photo,
      outward_vehicle_temp_photo,
      outward_material_temp_photo,
      outward_vehicle_back_side_photo,
      outward_vehicle_back_side_photo_with_material,
      outward_count_sheet_photo,
      outward_damage_boxes_photo,
      localTimestamp,
      localTimestamp,
      req.user ? req.user.warehouse_name : null,
      req.user ? req.user.email : null
    ];

    const [result] = await db.query(query, values);
    
    // Log Operator Activity
    await logActivity(
      req.user ? req.user.email : 'unknown',
      'CREATE',
      'Outward Log',
      `Created Outward record for vehicle ${data.outward_vehicle_no} and client ${data.outward_client_name}`
    );

    return res.status(201).json({ id: result.insertId, message: 'Outward temperature record saved successfully.' });
  } catch (err) {
    console.error('Error creating outward log:', err);
    return res.status(500).json({ error: 'Failed to save outward log.' });
  }
};

// 3. DELETE AN OUTWARD LOG
exports.deleteOutwardLog = async (req, res) => {
  try {
    const { id } = req.params;
    
    // First retrieve file paths to clean up disk storage
    const [rows] = await db.query(`
      SELECT outward_invoice_photos, outward_pod_photo, outward_vehicle_seal_photo, outward_vehicle_temp_photo, 
             outward_material_temp_photo, outward_vehicle_back_side_photo, outward_vehicle_back_side_photo_with_material, outward_count_sheet_photo, outward_damage_boxes_photo 
      FROM outward_temp_logs WHERE outward_id = ?
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Record not found.' });
    }

    const record = rows[0];

    // Delete record from database
    await db.query('DELETE FROM outward_temp_logs WHERE outward_id = ?', [id]);

    // Async clean up files from disk
    const cleanupFile = (relPath) => {
      if (!relPath) return;
      const fullPath = path.join(__dirname, '../', relPath);
      if (fs.existsSync(fullPath)) {
        fs.unlink(fullPath, (err) => {
          if (err) console.error('Error removing file:', relPath, err.message);
        });
      }
    };

    // Clean up multiple damage photos
    if (record.outward_damage_boxes_photo) {
      record.outward_damage_boxes_photo.split(',').forEach(cleanupFile);
    }
    
    // Clean up single photos
    cleanupFile(record.outward_invoice_photos);
    cleanupFile(record.outward_pod_photo);
    cleanupFile(record.outward_vehicle_seal_photo);
    cleanupFile(record.outward_vehicle_temp_photo);
    cleanupFile(record.outward_material_temp_photo);
    cleanupFile(record.outward_vehicle_back_side_photo);
    cleanupFile(record.outward_vehicle_back_side_photo_with_material);
    cleanupFile(record.outward_count_sheet_photo);

    // Log Operator Activity
    await logActivity(
      req.user ? req.user.email : 'unknown',
      'DELETE',
      'Outward Log',
      `Deleted Outward record ID #${id} for vehicle ${record.outward_vehicle_no} and client ${record.outward_client_name}`
    );

    return res.json({ message: 'Record deleted and related files cleaned up.' });
  } catch (err) {
    console.error('Error deleting outward log:', err);
    return res.status(500).json({ error: 'Failed to delete record.' });
  }
};

// 4. UPDATE AN EXISTING OUTWARD LOG
exports.updateOutwardLog = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const files = req.files || {};

    // Get existing record to handle files merging
    const [existing] = await db.query('SELECT * FROM outward_temp_logs WHERE outward_id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Record not found.' });
    }
    const current = existing[0];

    // Single photos merging
    const getPhotoPath = (fieldName, fallbackValue) => {
      return files[fieldName] ? `uploads/outward_images/${files[fieldName][0].filename}` : fallbackValue;
    };

    const outward_invoice_photos = getPhotoPath('outward_invoice_photos', current.outward_invoice_photos);
    const outward_pod_photo = getPhotoPath('outward_pod_photo', current.outward_pod_photo);
    const outward_vehicle_seal_photo = getPhotoPath('outward_vehicle_seal_photo', current.outward_vehicle_seal_photo);
    const outward_vehicle_temp_photo = getPhotoPath('outward_vehicle_temp_photo', current.outward_vehicle_temp_photo);
    const outward_material_temp_photo = getPhotoPath('outward_material_temp_photo', current.outward_material_temp_photo);
    const outward_vehicle_back_side_photo = getPhotoPath('outward_vehicle_back_side_photo', current.outward_vehicle_back_side_photo);
    const outward_vehicle_back_side_photo_with_material = getPhotoPath('outward_vehicle_back_side_photo_with_material', current.outward_vehicle_back_side_photo_with_material);
    const outward_count_sheet_photo = getPhotoPath('outward_count_sheet_photo', current.outward_count_sheet_photo);

    let outward_damage_boxes_photo = current.outward_damage_boxes_photo;
    if (files.outward_damage_boxes_photo) {
      const damage_photos_list = files.outward_damage_boxes_photo.map(f => `uploads/outward_images/${f.filename}`);
      outward_damage_boxes_photo = damage_photos_list.join(',');
    }

    const localTimestamp = formatDateTime(new Date());
    const query = `
      UPDATE outward_temp_logs SET
        outward_entry_date = COALESCE(?, outward_entry_date),
        outward_vehicle_no = COALESCE(?, outward_vehicle_no),
        outward_seal_no = ?,
        outward_vehicle_temp = ?,
        outward_material_temp = ?,
        outward_transporter_name = ?,
        outward_driver_name = ?,
        outward_driver_no = ?,
        outward_client_name = COALESCE(?, outward_client_name),
        outward_dock_no = ?,
        outward_vehicle_reporting_time = ?,
        outward_loading_start_time = ?,
        outward_loading_duration_hours = ?,
        outward_loading_duration_mins = ?,
        outward_loading_end_time = ?,
        outward_pallets_in_qty = ?,
        outward_invoice_qty = ?,
        outward_received_qty = ?,
        outward_received_boxes_qty = ?,
        outward_short_received_boxes_qty = ?,
        outward_excess_received_boxes_qty = ?,
        outward_damage_received_boxes_qty = ?,
        outward_material_type = ?,
        outward_loading_supervisor_name = ?,
        outward_remarks = ?,
        outward_invoice_photos = ?,
        outward_pod_photo = ?,
        outward_vehicle_seal_photo = ?,
        outward_vehicle_temp_photo = ?,
        outward_material_temp_photo = ?,
        outward_vehicle_back_side_photo = ?,
        outward_vehicle_back_side_photo_with_material = ?,
        outward_count_sheet_photo = ?,
        outward_damage_boxes_photo = ?,
        outward_updated_at = ?
      WHERE outward_id = ?
    `;

    let startWithDate = data.outward_loading_start_time !== undefined ? data.outward_loading_start_time : current.outward_loading_start_time;
    if (startWithDate && !startWithDate.includes('-')) {
      const entryDate = data.outward_entry_date || current.outward_entry_date;
      if (entryDate) {
        const dateParts = entryDate.split('-');
        if (dateParts.length === 3) {
          const [yyyy, mm, dd] = dateParts;
          startWithDate = `${dd}-${mm}-${yyyy} ${startWithDate}`;
        }
      }
    }

    const values = [
      data.outward_entry_date,
      data.outward_vehicle_no,
      data.outward_seal_no !== undefined ? data.outward_seal_no : current.outward_seal_no,
      data.outward_vehicle_temp !== undefined && data.outward_vehicle_temp !== '' ? parseFloat(data.outward_vehicle_temp) : current.outward_vehicle_temp,
      data.outward_material_temp !== undefined && data.outward_material_temp !== '' ? parseFloat(data.outward_material_temp) : current.outward_material_temp,
      data.outward_transporter_name !== undefined ? data.outward_transporter_name : current.outward_transporter_name,
      data.outward_driver_name !== undefined ? data.outward_driver_name : current.outward_driver_name,
      data.outward_driver_no !== undefined ? data.outward_driver_no : current.outward_driver_no,
      data.outward_client_name,
      data.outward_dock_no !== undefined ? data.outward_dock_no : current.outward_dock_no,
      data.outward_vehicle_reporting_time !== undefined ? data.outward_vehicle_reporting_time : current.outward_vehicle_reporting_time,
      startWithDate,
      data.outward_loading_duration_hours !== undefined ? data.outward_loading_duration_hours : current.outward_loading_duration_hours,
      data.outward_loading_duration_mins !== undefined ? data.outward_loading_duration_mins : current.outward_loading_duration_mins,
      data.outward_loading_end_time !== undefined ? data.outward_loading_end_time : current.outward_loading_end_time,
      data.outward_pallets_in_qty !== undefined && data.outward_pallets_in_qty !== '' ? parseInt(data.outward_pallets_in_qty) : current.outward_pallets_in_qty,
      data.outward_invoice_qty !== undefined && data.outward_invoice_qty !== '' ? parseInt(data.outward_invoice_qty) : current.outward_invoice_qty,
      data.outward_received_qty !== undefined && data.outward_received_qty !== '' ? parseInt(data.outward_received_qty) : current.outward_received_qty,
      data.outward_received_boxes_qty !== undefined && data.outward_received_boxes_qty !== '' ? parseInt(data.outward_received_boxes_qty) : current.outward_received_boxes_qty,
      data.outward_short_received_boxes_qty !== undefined && data.outward_short_received_boxes_qty !== '' ? parseInt(data.outward_short_received_boxes_qty) : current.outward_short_received_boxes_qty,
      data.outward_excess_received_boxes_qty !== undefined && data.outward_excess_received_boxes_qty !== '' ? parseInt(data.outward_excess_received_boxes_qty) : current.outward_excess_received_boxes_qty,
      data.outward_damage_received_boxes_qty !== undefined && data.outward_damage_received_boxes_qty !== '' ? parseInt(data.outward_damage_received_boxes_qty) : current.outward_damage_received_boxes_qty,
      data.outward_material_type !== undefined ? data.outward_material_type : current.outward_material_type,
      data.outward_loading_supervisor_name !== undefined ? data.outward_loading_supervisor_name : current.outward_loading_supervisor_name,
      data.outward_remarks !== undefined ? data.outward_remarks : current.outward_remarks,
      outward_invoice_photos,
      outward_pod_photo,
      outward_vehicle_seal_photo,
      outward_vehicle_temp_photo,
      outward_material_temp_photo,
      outward_vehicle_back_side_photo,
      outward_vehicle_back_side_photo_with_material,
      outward_count_sheet_photo,
      outward_damage_boxes_photo,
      localTimestamp,
      id
    ];

    await db.query(query, values);
    
    // Log Operator Activity
    await logActivity(
      req.user ? req.user.email : 'unknown',
      'UPDATE',
      'Outward Log',
      `Updated Outward record ID #${id} for vehicle ${data.outward_vehicle_no || current.outward_vehicle_no}`
    );

    return res.json({ message: 'Outward temperature record updated successfully.' });
  } catch (err) {
    console.error('Error updating outward log:', err);
    return res.status(500).json({ error: 'Failed to update outward log.' });
  }
};
