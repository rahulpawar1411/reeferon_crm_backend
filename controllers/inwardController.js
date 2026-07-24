// ====================================================================
// Inward Controller (controllers/inwardController.js)
// Implements CRUD APIs and file saving for the DO Inward Temp Monitor.
// ====================================================================

const db = require('../config/db');
const fs = require('fs');
const path = require('path');

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
    let query = `
      SELECT id, DATE_FORMAT(entry_date, '%Y-%m-%d') as entry_date, vehicle_no, seal_no, 
             vehicle_temp, material_temp, transporter_name, driver_name, driver_no, 
             client_name, dock_no, vehicle_reporting_time, unloading_start_time, unloading_end_time, 
             pallets_in_qty, invoice_qty, received_qty, received_boxes_qty, 
             short_received_boxes_qty, excess_received_boxes_qty, damage_received_boxes_qty, 
             material_type, unloading_supervisor_name, remarks, invoice_photos, pod_photo, 
             vehicle_seal_photo, vehicle_temp_photo, material_temp_photo, vehicle_back_side_photo, 
             damage_boxes_photo, created_at 
      FROM inward_temp_logs 
      ORDER BY entry_date DESC, id DESC
    `;
    let params = [];

    if (search) {
      query = `
        SELECT id, DATE_FORMAT(entry_date, '%Y-%m-%d') as entry_date, vehicle_no, seal_no, 
               vehicle_temp, material_temp, transporter_name, driver_name, driver_no, 
               client_name, dock_no, vehicle_reporting_time, unloading_start_time, unloading_end_time, 
               pallets_in_qty, invoice_qty, received_qty, received_boxes_qty, 
               short_received_boxes_qty, excess_received_boxes_qty, damage_received_boxes_qty, 
               material_type, unloading_supervisor_name, remarks, invoice_photos, pod_photo, 
               vehicle_seal_photo, vehicle_temp_photo, material_temp_photo, vehicle_back_side_photo, 
               damage_boxes_photo, created_at 
        FROM inward_temp_logs 
        WHERE vehicle_no LIKE ? OR client_name LIKE ? OR transporter_name LIKE ? OR driver_name LIKE ?
        ORDER BY entry_date DESC, id DESC
      `;
      params = [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`];
    }

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

    // Map invoice photos if multiple uploaded
    let invoice_photos_list = [];
    if (files.invoice_photos) {
      invoice_photos_list = files.invoice_photos.map(f => `uploads/inward_images/${f.filename}`);
    }
    const invoice_photos = invoice_photos_list.length > 0 ? invoice_photos_list.join(',') : null;

    // Single photos mapping
    const getPhotoPath = (fieldName) => {
      return files[fieldName] ? `uploads/inward_images/${files[fieldName][0].filename}` : null;
    };

    const pod_photo = getPhotoPath('pod_photo');
    const vehicle_seal_photo = getPhotoPath('vehicle_seal_photo');
    const vehicle_temp_photo = getPhotoPath('vehicle_temp_photo');
    const material_temp_photo = getPhotoPath('material_temp_photo');
    const vehicle_back_side_photo = getPhotoPath('vehicle_back_side_photo');
    const damage_boxes_photo = getPhotoPath('damage_boxes_photo');

    // Required fields check
    if (!data.entry_date || !data.vehicle_no || !data.client_name) {
      return res.status(400).json({ error: 'Date, Vehicle No, and Client Name are required.' });
    }

    const query = `
      INSERT INTO inward_temp_logs (
        entry_date, vehicle_no, seal_no, vehicle_temp, material_temp, transporter_name, 
        driver_name, driver_no, client_name, dock_no, vehicle_reporting_time, 
        unloading_start_time, unloading_end_time, pallets_in_qty, invoice_qty, 
        received_qty, received_boxes_qty, short_received_boxes_qty, excess_received_boxes_qty, 
        damage_received_boxes_qty, material_type, unloading_supervisor_name, remarks, 
        invoice_photos, pod_photo, vehicle_seal_photo, vehicle_temp_photo, 
        material_temp_photo, vehicle_back_side_photo, damage_boxes_photo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      data.entry_date,
      data.vehicle_no,
      data.seal_no || null,
      data.vehicle_temp !== undefined && data.vehicle_temp !== '' ? parseFloat(data.vehicle_temp) : null,
      data.material_temp !== undefined && data.material_temp !== '' ? parseFloat(data.material_temp) : null,
      data.transporter_name || null,
      data.driver_name || null,
      data.driver_no || null,
      data.client_name,
      data.dock_no || null,
      data.vehicle_reporting_time || null,
      data.unloading_start_time || null,
      data.unloading_end_time || null,
      data.pallets_in_qty !== undefined && data.pallets_in_qty !== '' ? parseInt(data.pallets_in_qty) : 0,
      data.invoice_qty !== undefined && data.invoice_qty !== '' ? parseInt(data.invoice_qty) : 0,
      data.received_qty !== undefined && data.received_qty !== '' ? parseInt(data.received_qty) : 0,
      data.received_boxes_qty !== undefined && data.received_boxes_qty !== '' ? parseInt(data.received_boxes_qty) : 0,
      data.short_received_boxes_qty !== undefined && data.short_received_boxes_qty !== '' ? parseInt(data.short_received_boxes_qty) : 0,
      data.excess_received_boxes_qty !== undefined && data.excess_received_boxes_qty !== '' ? parseInt(data.excess_received_boxes_qty) : 0,
      data.damage_received_boxes_qty !== undefined && data.damage_received_boxes_qty !== '' ? parseInt(data.damage_received_boxes_qty) : 0,
      data.material_type || null,
      data.unloading_supervisor_name || null,
      data.remarks || null,
      invoice_photos,
      pod_photo,
      vehicle_seal_photo,
      vehicle_temp_photo,
      material_temp_photo,
      vehicle_back_side_photo,
      damage_boxes_photo
    ];

    const [result] = await db.query(query, values);
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
      SELECT invoice_photos, pod_photo, vehicle_seal_photo, vehicle_temp_photo, 
             material_temp_photo, vehicle_back_side_photo, damage_boxes_photo 
      FROM inward_temp_logs WHERE id = ?
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Record not found.' });
    }

    const record = rows[0];

    // Delete record from database
    await db.query('DELETE FROM inward_temp_logs WHERE id = ?', [id]);

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

    // Clean up multiple invoices
    if (record.invoice_photos) {
      record.invoice_photos.split(',').forEach(cleanupFile);
    }
    
    // Clean up single photos
    cleanupFile(record.pod_photo);
    cleanupFile(record.vehicle_seal_photo);
    cleanupFile(record.vehicle_temp_photo);
    cleanupFile(record.material_temp_photo);
    cleanupFile(record.vehicle_back_side_photo);
    cleanupFile(record.damage_boxes_photo);

    return res.json({ message: 'Record deleted and related files cleaned up.' });
  } catch (err) {
    console.error('Error deleting inward log:', err);
    return res.status(500).json({ error: 'Failed to delete record.' });
  }
};
