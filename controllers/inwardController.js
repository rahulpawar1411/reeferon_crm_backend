// ====================================================================
// Inward Controller (controllers/inwardController.js)
// Implements CRUD APIs and file saving for the DO Inward Temp Monitor.
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

// 1. GET ALL INWARD LOGS (With optional search query)
exports.getInwardLogs = async (req, res) => {
  try {
    const { search } = req.query;
    let conditions = [];
    let params = [];

    if (req.user && req.user.role === 'do_operator' && req.user.warehouse_name) {
      conditions.push('(warehouse_name = ? OR warehouse_name IS NULL)');
      params.push(req.user.warehouse_name);
    }

    if (search) {
      conditions.push('(inward_vehicle_no LIKE ? OR inward_client_name LIKE ? OR inward_transporter_name LIKE ? OR inward_driver_name LIKE ?)');
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern, pattern);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
      SELECT inward_id, DATE_FORMAT(inward_entry_date, '%Y-%m-%d') as inward_entry_date, inward_vehicle_no, inward_seal_no, 
             inward_vehicle_temp, inward_material_temp, inward_transporter_name, inward_driver_name, inward_driver_no, 
             inward_client_name, inward_dock_no, inward_vehicle_reporting_time, inward_unloading_start_time,
             inward_unloading_duration_hours, inward_unloading_duration_mins, inward_unloading_end_time, 
             inward_pallets_in_qty, inward_invoice_qty, inward_received_qty, inward_received_boxes_qty, 
             inward_short_received_boxes_qty, inward_excess_received_boxes_qty, inward_damage_received_boxes_qty, 
             inward_material_type, inward_unloading_supervisor_name, inward_remarks, inward_invoice_photos, inward_pod_photo, 
             inward_vehicle_seal_photo, inward_vehicle_temp_photo, inward_material_temp_photo, inward_vehicle_back_side_photo, 
             inward_vehicle_back_side_photo_with_material, inward_count_sheet_photo, inward_damage_boxes_photo, inward_created_at, inward_updated_at, warehouse_name, operator_email
      FROM inward_temp_logs 
      ${whereClause}
      ORDER BY inward_entry_date DESC, inward_id DESC
    `;

    const [rows] = await db.query(query, params);
    return res.json(rows);
  } catch (err) {
    console.error('Error fetching inward logs:', err);
    return res.status(500).json({ error: 'Failed to fetch inward logs.' });
  }
};

// 2. CREATE A NEW INWARD LOG
exports.addInwardLog = async (req, res) => {
  try {
    const data = req.body;
    const files = req.files || {};

    let damage_photos_list = [];
    if (files.inward_damage_boxes_photo) {
      damage_photos_list = files.inward_damage_boxes_photo.map(f => `uploads/inward_images/${f.filename}`);
    }
    const inward_damage_boxes_photo = damage_photos_list.length > 0 ? damage_photos_list.join(',') : null;

    // Single photos mapping
    const getPhotoPath = (fieldName) => {
      return files[fieldName] ? `uploads/inward_images/${files[fieldName][0].filename}` : null;
    };

    const inward_invoice_photos = getPhotoPath('inward_invoice_photos');
    const inward_pod_photo = getPhotoPath('inward_pod_photo');
    const inward_vehicle_seal_photo = getPhotoPath('inward_vehicle_seal_photo');
    const inward_vehicle_temp_photo = getPhotoPath('inward_vehicle_temp_photo');
    const inward_material_temp_photo = getPhotoPath('inward_material_temp_photo');
    const inward_vehicle_back_side_photo = getPhotoPath('inward_vehicle_back_side_photo');
    const inward_vehicle_back_side_photo_with_material = getPhotoPath('inward_vehicle_back_side_photo_with_material');
    const inward_count_sheet_photo = getPhotoPath('inward_count_sheet_photo');

    // Required fields check
    if (!data.inward_entry_date || !data.inward_vehicle_no || !data.inward_client_name) {
      return res.status(400).json({ error: 'Date, Vehicle No, and Client Name are required.' });
    }

    const localTimestamp = formatDateTime(new Date());

    let startWithDate = data.inward_unloading_start_time || null;
    if (data.inward_entry_date && data.inward_unloading_start_time) {
      const dateParts = data.inward_entry_date.split('-');
      if (dateParts.length === 3) {
        const [yyyy, mm, dd] = dateParts;
        if (!data.inward_unloading_start_time.includes('-')) {
          startWithDate = `${dd}-${mm}-${yyyy} ${data.inward_unloading_start_time}`;
        }
      }
    }

    const query = `
      INSERT INTO inward_temp_logs (
        inward_entry_date, inward_vehicle_no, inward_seal_no, inward_vehicle_temp, inward_material_temp, inward_transporter_name, 
        inward_driver_name, inward_driver_no, inward_client_name, inward_dock_no, inward_vehicle_reporting_time, 
        inward_unloading_start_time, inward_unloading_duration_hours, inward_unloading_duration_mins, inward_unloading_end_time, inward_pallets_in_qty, inward_invoice_qty, 
        inward_received_qty, inward_received_boxes_qty, inward_short_received_boxes_qty, inward_excess_received_boxes_qty, 
        inward_damage_received_boxes_qty, inward_material_type, inward_unloading_supervisor_name, inward_remarks, 
        inward_invoice_photos, inward_pod_photo, inward_vehicle_seal_photo, inward_vehicle_temp_photo, 
        inward_material_temp_photo, inward_vehicle_back_side_photo, inward_vehicle_back_side_photo_with_material, inward_count_sheet_photo, inward_damage_boxes_photo,
        inward_created_at, inward_updated_at, warehouse_name, operator_email
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      data.inward_entry_date,
      data.inward_vehicle_no,
      data.inward_seal_no || null,
      data.inward_vehicle_temp !== undefined && data.inward_vehicle_temp !== '' ? parseFloat(data.inward_vehicle_temp) : null,
      data.inward_material_temp !== undefined && data.inward_material_temp !== '' ? parseFloat(data.inward_material_temp) : null,
      data.inward_transporter_name || null,
      data.inward_driver_name || null,
      data.inward_driver_no || null,
      data.inward_client_name,
      data.inward_dock_no || null,
      data.inward_vehicle_reporting_time || null,
      startWithDate,
      data.inward_unloading_duration_hours || null,
      data.inward_unloading_duration_mins || null,
      data.inward_unloading_end_time || null,
      data.inward_pallets_in_qty !== undefined && data.inward_pallets_in_qty !== '' ? parseInt(data.inward_pallets_in_qty) : 0,
      data.inward_invoice_qty !== undefined && data.inward_invoice_qty !== '' ? parseInt(data.inward_invoice_qty) : 0,
      data.inward_received_qty !== undefined && data.inward_received_qty !== '' ? parseInt(data.inward_received_qty) : 0,
      data.inward_received_boxes_qty !== undefined && data.inward_received_boxes_qty !== '' ? parseInt(data.inward_received_boxes_qty) : 0,
      data.inward_short_received_boxes_qty !== undefined && data.inward_short_received_boxes_qty !== '' ? parseInt(data.inward_short_received_boxes_qty) : 0,
      data.inward_excess_received_boxes_qty !== undefined && data.inward_excess_received_boxes_qty !== '' ? parseInt(data.inward_excess_received_boxes_qty) : 0,
      data.inward_damage_received_boxes_qty !== undefined && data.inward_damage_received_boxes_qty !== '' ? parseInt(data.inward_damage_received_boxes_qty) : 0,
      data.inward_material_type || null,
      data.inward_unloading_supervisor_name || null,
      data.inward_remarks || null,
      inward_invoice_photos,
      inward_pod_photo,
      inward_vehicle_seal_photo,
      inward_vehicle_temp_photo,
      inward_material_temp_photo,
      inward_vehicle_back_side_photo,
      inward_vehicle_back_side_photo_with_material,
      inward_count_sheet_photo,
      inward_damage_boxes_photo,
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
      'Inward Log',
      `Created Inward record for vehicle ${data.inward_vehicle_no} and client ${data.inward_client_name}`
    );

    return res.status(201).json({ id: result.insertId, message: 'Inward temperature record saved successfully.' });
  } catch (err) {
    console.error('Error creating inward log:', err);
    return res.status(500).json({ error: 'Failed to save inward log.' });
  }
};

// 3. DELETE AN INWARD LOG
exports.deleteInwardLog = async (req, res) => {
  try {
    const { id } = req.params;
    
    // First retrieve file paths to clean up disk storage
    const [rows] = await db.query(`
      SELECT inward_invoice_photos, inward_pod_photo, inward_vehicle_seal_photo, inward_vehicle_temp_photo, 
             inward_material_temp_photo, inward_vehicle_back_side_photo, inward_vehicle_back_side_photo_with_material, inward_count_sheet_photo, inward_damage_boxes_photo 
      FROM inward_temp_logs WHERE inward_id = ?
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Record not found.' });
    }

    const record = rows[0];

    // Delete record from database
    await db.query('DELETE FROM inward_temp_logs WHERE inward_id = ?', [id]);

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
    if (record.inward_damage_boxes_photo) {
      record.inward_damage_boxes_photo.split(',').forEach(cleanupFile);
    }
    
    // Clean up single photos
    cleanupFile(record.inward_invoice_photos);
    cleanupFile(record.inward_pod_photo);
    cleanupFile(record.inward_vehicle_seal_photo);
    cleanupFile(record.inward_vehicle_temp_photo);
    cleanupFile(record.inward_material_temp_photo);
    cleanupFile(record.inward_vehicle_back_side_photo);
    cleanupFile(record.inward_vehicle_back_side_photo_with_material);
    cleanupFile(record.inward_count_sheet_photo);

    // Log Operator Activity
    await logActivity(
      req.user ? req.user.email : 'unknown',
      'DELETE',
      'Inward Log',
      `Deleted Inward record ID #${id} for vehicle ${record.inward_vehicle_no} and client ${record.inward_client_name}`
    );

    return res.json({ message: 'Record deleted and related files cleaned up.' });
  } catch (err) {
    console.error('Error deleting inward log:', err);
    return res.status(500).json({ error: 'Failed to delete record.' });
  }
};

// 4. UPDATE AN EXISTING INWARD LOG
exports.updateInwardLog = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const files = req.files || {};

    // Get existing record to handle files merging
    const [existing] = await db.query('SELECT * FROM inward_temp_logs WHERE inward_id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Record not found.' });
    }
    const current = existing[0];

    // Single photos merging
    const getPhotoPath = (fieldName, fallbackValue) => {
      return files[fieldName] ? `uploads/inward_images/${files[fieldName][0].filename}` : fallbackValue;
    };

    const inward_invoice_photos = getPhotoPath('inward_invoice_photos', current.inward_invoice_photos);
    const inward_pod_photo = getPhotoPath('inward_pod_photo', current.inward_pod_photo);
    const inward_vehicle_seal_photo = getPhotoPath('inward_vehicle_seal_photo', current.inward_vehicle_seal_photo);
    const inward_vehicle_temp_photo = getPhotoPath('inward_vehicle_temp_photo', current.inward_vehicle_temp_photo);
    const inward_material_temp_photo = getPhotoPath('inward_material_temp_photo', current.inward_material_temp_photo);
    const inward_vehicle_back_side_photo = getPhotoPath('inward_vehicle_back_side_photo', current.inward_vehicle_back_side_photo);
    const inward_vehicle_back_side_photo_with_material = getPhotoPath('inward_vehicle_back_side_photo_with_material', current.inward_vehicle_back_side_photo_with_material);
    const inward_count_sheet_photo = getPhotoPath('inward_count_sheet_photo', current.inward_count_sheet_photo);

    let inward_damage_boxes_photo = current.inward_damage_boxes_photo;
    if (files.inward_damage_boxes_photo) {
      const damage_photos_list = files.inward_damage_boxes_photo.map(f => `uploads/inward_images/${f.filename}`);
      inward_damage_boxes_photo = damage_photos_list.join(',');
    }

    const localTimestamp = formatDateTime(new Date());
    const query = `
      UPDATE inward_temp_logs SET
        inward_entry_date = COALESCE(?, inward_entry_date),
        inward_vehicle_no = COALESCE(?, inward_vehicle_no),
        inward_seal_no = ?,
        inward_vehicle_temp = ?,
        inward_material_temp = ?,
        inward_transporter_name = ?,
        inward_driver_name = ?,
        inward_driver_no = ?,
        inward_client_name = COALESCE(?, inward_client_name),
        inward_dock_no = ?,
        inward_vehicle_reporting_time = ?,
        inward_unloading_start_time = ?,
        inward_unloading_duration_hours = ?,
        inward_unloading_duration_mins = ?,
        inward_unloading_end_time = ?,
        inward_pallets_in_qty = ?,
        inward_invoice_qty = ?,
        inward_received_qty = ?,
        inward_received_boxes_qty = ?,
        inward_short_received_boxes_qty = ?,
        inward_excess_received_boxes_qty = ?,
        inward_damage_received_boxes_qty = ?,
        inward_material_type = ?,
        inward_unloading_supervisor_name = ?,
        inward_remarks = ?,
        inward_invoice_photos = ?,
        inward_pod_photo = ?,
        inward_vehicle_seal_photo = ?,
        inward_vehicle_temp_photo = ?,
        inward_material_temp_photo = ?,
        inward_vehicle_back_side_photo = ?,
        inward_vehicle_back_side_photo_with_material = ?,
        inward_count_sheet_photo = ?,
        inward_damage_boxes_photo = ?,
        inward_updated_at = ?
      WHERE inward_id = ?
    `;

    let startWithDate = data.inward_unloading_start_time !== undefined ? data.inward_unloading_start_time : current.inward_unloading_start_time;
    if (startWithDate && !startWithDate.includes('-')) {
      const entryDate = data.inward_entry_date || current.inward_entry_date;
      if (entryDate) {
        const dateParts = entryDate.split('-');
        if (dateParts.length === 3) {
          const [yyyy, mm, dd] = dateParts;
          startWithDate = `${dd}-${mm}-${yyyy} ${startWithDate}`;
        }
      }
    }

    const values = [
      data.inward_entry_date,
      data.inward_vehicle_no,
      data.inward_seal_no !== undefined ? data.inward_seal_no : current.inward_seal_no,
      data.inward_vehicle_temp !== undefined && data.inward_vehicle_temp !== '' ? parseFloat(data.inward_vehicle_temp) : current.inward_vehicle_temp,
      data.inward_material_temp !== undefined && data.inward_material_temp !== '' ? parseFloat(data.inward_material_temp) : current.inward_material_temp,
      data.inward_transporter_name !== undefined ? data.inward_transporter_name : current.inward_transporter_name,
      data.inward_driver_name !== undefined ? data.inward_driver_name : current.inward_driver_name,
      data.inward_driver_no !== undefined ? data.inward_driver_no : current.inward_driver_no,
      data.inward_client_name,
      data.inward_dock_no !== undefined ? data.inward_dock_no : current.inward_dock_no,
      data.inward_vehicle_reporting_time !== undefined ? data.inward_vehicle_reporting_time : current.inward_vehicle_reporting_time,
      startWithDate,
      data.inward_unloading_duration_hours !== undefined ? data.inward_unloading_duration_hours : current.inward_unloading_duration_hours,
      data.inward_unloading_duration_mins !== undefined ? data.inward_unloading_duration_mins : current.inward_unloading_duration_mins,
      data.inward_unloading_end_time !== undefined ? data.inward_unloading_end_time : current.inward_unloading_end_time,
      data.inward_pallets_in_qty !== undefined && data.inward_pallets_in_qty !== '' ? parseInt(data.inward_pallets_in_qty) : current.inward_pallets_in_qty,
      data.inward_invoice_qty !== undefined && data.inward_invoice_qty !== '' ? parseInt(data.inward_invoice_qty) : current.inward_invoice_qty,
      data.inward_received_qty !== undefined && data.inward_received_qty !== '' ? parseInt(data.inward_received_qty) : current.inward_received_qty,
      data.inward_received_boxes_qty !== undefined && data.inward_received_boxes_qty !== '' ? parseInt(data.inward_received_boxes_qty) : current.inward_received_boxes_qty,
      data.inward_short_received_boxes_qty !== undefined && data.inward_short_received_boxes_qty !== '' ? parseInt(data.inward_short_received_boxes_qty) : current.inward_short_received_boxes_qty,
      data.inward_excess_received_boxes_qty !== undefined && data.inward_excess_received_boxes_qty !== '' ? parseInt(data.inward_excess_received_boxes_qty) : current.inward_excess_received_boxes_qty,
      data.inward_damage_received_boxes_qty !== undefined && data.inward_damage_received_boxes_qty !== '' ? parseInt(data.inward_damage_received_boxes_qty) : current.inward_damage_received_boxes_qty,
      data.inward_material_type !== undefined ? data.inward_material_type : current.inward_material_type,
      data.inward_unloading_supervisor_name !== undefined ? data.inward_unloading_supervisor_name : current.inward_unloading_supervisor_name,
      data.inward_remarks !== undefined ? data.inward_remarks : current.inward_remarks,
      inward_invoice_photos,
      inward_pod_photo,
      inward_vehicle_seal_photo,
      inward_vehicle_temp_photo,
      inward_material_temp_photo,
      inward_vehicle_back_side_photo,
      inward_vehicle_back_side_photo_with_material,
      inward_count_sheet_photo,
      inward_damage_boxes_photo,
      localTimestamp,
      id
    ];

    await db.query(query, values);
    
    // Log Operator Activity
    await logActivity(
      req.user ? req.user.email : 'unknown',
      'UPDATE',
      'Inward Log',
      `Updated Inward record ID #${id} for vehicle ${data.inward_vehicle_no || current.inward_vehicle_no}`
    );

    return res.json({ message: 'Inward temperature record updated successfully.' });
  } catch (err) {
    console.error('Error updating inward log:', err);
    return res.status(500).json({ error: 'Failed to update inward log.' });
  }
};
