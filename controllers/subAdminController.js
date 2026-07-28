// ====================================================================
// Sub-Admin Controller (backend/controllers/subAdminController.js)
// Implements secure CRUD actions for managing Sub-Admin accounts.
// ====================================================================

const db = require('../config/db');
const bcrypt = require('bcryptjs');
const { logActivity } = require('../utils/logger');
const { handleControllerError } = require('../utils/errorHandler');
const { sendSubAdminCredentialsEmail } = require('../utils/emailService');

// 1. GET ALL SUB-ADMINS
exports.getSubAdmins = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, email, full_name, phone_no, allowed_clients, allowed_warehouses, created_at FROM sub_admins ORDER BY id DESC'
    );
    return res.json(rows);
  } catch (err) {
    return handleControllerError(res, err, {
      checkpoint: 'getSubAdmins',
      req,
      clientMessage: 'Failed to fetch sub-admins.'
    });
  }
};

// 2. CREATE NEW SUB-ADMIN
exports.createSubAdmin = async (req, res) => {
  try {
    const { email, password, full_name, phone_no, allowed_clients, allowed_warehouses } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanFullName = (full_name || '').trim();
    const cleanPhone = (phone_no || '').trim();

    if (!cleanEmail || !password || !cleanFullName || !cleanPhone) {
      return res.status(400).json({ error: 'All fields (Email, Password, Full Name, Phone No.) are required.' });
    }

    // Check if sub-admin email already exists
    const [existing] = await db.query(
      'SELECT id FROM sub_admins WHERE email = ? LIMIT 1',
      [cleanEmail]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Sub-Admin email already exists.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(password, salt);

    // Store allowed_clients and allowed_warehouses as comma-separated strings
    const clientsStr = Array.isArray(allowed_clients) ? allowed_clients.join(',') : (allowed_clients || null);
    const warehousesStr = Array.isArray(allowed_warehouses) ? allowed_warehouses.join(',') : (allowed_warehouses || null);

    await db.query(
      'INSERT INTO sub_admins (email, password, full_name, phone_no, allowed_clients, allowed_warehouses) VALUES (?, ?, ?, ?, ?, ?)',
      [cleanEmail, hashed, cleanFullName, cleanPhone, clientsStr, warehousesStr]
    );

    // Log the permission change
    await logActivity(
      req.user?.email || 'super_admin',
      'CREATE',
      'PERMISSION',
      `Registered sub-admin profile: ${cleanEmail} | Access: Clients=[${clientsStr || 'All'}] Warehouses=[${warehousesStr || 'All'}]`
    );

    const emailResult = await sendSubAdminCredentialsEmail({
      email: cleanEmail,
      password,
      full_name: cleanFullName,
      phone_no: cleanPhone,
      allowed_clients: clientsStr,
      allowed_warehouses: warehousesStr
    });

    if (emailResult.sent) {
      await logActivity(
        req.user?.email || 'super_admin',
        'EMAIL_SENT',
        'SECURITY',
        `Credentials email sent to Sub-Admin: ${cleanEmail}`
      );
    } else {
      await logActivity(
        req.user?.email || 'super_admin',
        'EMAIL_FAILED',
        'SECURITY',
        `Credentials email NOT sent to Sub-Admin: ${cleanEmail} (${emailResult.error || 'unknown'})`
      );
    }

    return res.status(201).json({
      message: emailResult.sent
        ? 'Sub-admin created successfully. Login credentials emailed.'
        : 'Sub-admin created successfully, but credentials email could not be sent.',
      emailSent: !!emailResult.sent,
      emailSkipped: !!emailResult.skipped,
      emailError: emailResult.sent ? null : (emailResult.error || null)
    });
  } catch (err) {
    const detail = err.code === 'ER_DUP_ENTRY'
      ? 'Sub-Admin email already exists.'
      : (err.code === 'ER_BAD_FIELD_ERROR'
        ? 'Database schema is outdated. Restart the backend server to apply migrations.'
        : 'Failed to create sub-admin.');
    return handleControllerError(res, err, {
      checkpoint: 'createSubAdmin',
      req,
      clientMessage: detail,
      statusCode: err.code === 'ER_DUP_ENTRY' ? 409 : 500
    });
  }
};

// 3. UPDATE SUB-ADMIN
exports.updateSubAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { email, password, full_name, phone_no, allowed_clients, allowed_warehouses } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanFullName = (full_name || '').trim();
    const cleanPhone = (phone_no || '').trim();

    if (!cleanEmail || !cleanFullName || !cleanPhone) {
      return res.status(400).json({ error: 'All fields (Email, Full Name, Phone No.) are required.' });
    }

    // Check if email belongs to another sub-admin
    const [existing] = await db.query(
      'SELECT id FROM sub_admins WHERE email = ? AND id != ? LIMIT 1',
      [cleanEmail, id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Email is already taken by another sub-admin.' });
    }

    // Store allowed_clients and allowed_warehouses as comma-separated strings
    const clientsStr = Array.isArray(allowed_clients) ? allowed_clients.join(',') : (allowed_clients || null);
    const warehousesStr = Array.isArray(allowed_warehouses) ? allowed_warehouses.join(',') : (allowed_warehouses || null);

    if (password && password.trim() !== '') {
      // Hash new password
      const salt = await bcrypt.genSalt(10);
      const hashed = await bcrypt.hash(password, salt);
      await db.query(
        'UPDATE sub_admins SET email = ?, password = ?, full_name = ?, phone_no = ?, allowed_clients = ?, allowed_warehouses = ? WHERE id = ?',
        [cleanEmail, hashed, cleanFullName, cleanPhone, clientsStr, warehousesStr, id]
      );
    } else {
      await db.query(
        'UPDATE sub_admins SET email = ?, full_name = ?, phone_no = ?, allowed_clients = ?, allowed_warehouses = ? WHERE id = ?',
        [cleanEmail, cleanFullName, cleanPhone, clientsStr, warehousesStr, id]
      );
    }

    // Log the permission change
    await logActivity(
      req.user?.email || 'super_admin',
      'UPDATE',
      'PERMISSION',
      `Updated sub-admin profile: ${cleanEmail} | Access: Clients=[${clientsStr || 'All'}] Warehouses=[${warehousesStr || 'All'}]`
    );

    return res.json({ message: 'Sub-admin updated successfully.' });
  } catch (err) {
    return handleControllerError(res, err, {
      checkpoint: 'updateSubAdmin',
      req,
      clientMessage: 'Failed to update sub-admin.'
    });
  }
};

// 4. DELETE SUB-ADMIN
exports.deleteSubAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Fetch details before deletion for audit logging
    const [opRows] = await db.query('SELECT email FROM sub_admins WHERE id = ? LIMIT 1', [id]);
    const opEmail = opRows.length > 0 ? opRows[0].email : `ID ${id}`;

    await db.query('DELETE FROM sub_admins WHERE id = ?', [id]);

    // Log the permission revocation
    await logActivity(
      req.user?.email || 'super_admin',
      'DELETE',
      'PERMISSION',
      `Revoked workspace access for sub-admin: ${opEmail}`
    );

    return res.json({ message: 'Sub-admin deleted successfully.' });
  } catch (err) {
    return handleControllerError(res, err, {
      checkpoint: 'deleteSubAdmin',
      req,
      clientMessage: 'Failed to delete sub-admin.'
    });
  }
};
