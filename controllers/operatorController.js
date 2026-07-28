// ====================================================================
// Data Operator Controller (backend/controllers/operatorController.js)
// Implements secure CRUD actions for managing Data Operator accounts.
// ====================================================================

const db = require('../config/db');
const bcrypt = require('bcryptjs');
const { logActivity } = require('../utils/logger');
const { handleControllerError } = require('../utils/errorHandler');
const { sendOperatorCredentialsEmail } = require('../utils/emailService');

// 1. GET ALL OPERATORS
exports.getOperators = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, email, full_name, phone_no, warehouse_name, created_at FROM do_operators ORDER BY id DESC'
    );
    return res.json(rows);
  } catch (err) {
    return handleControllerError(res, err, {
      checkpoint: 'getOperators',
      req,
      clientMessage: 'Failed to fetch data operators.'
    });
  }
};

// 2. CREATE NEW OPERATOR
exports.createOperator = async (req, res) => {
  try {
    const { email, password, full_name, phone_no, warehouse_name } = req.body;
    if (!email || !password || !full_name || !phone_no || !warehouse_name) {
      return res.status(400).json({ error: 'All fields (Email, Password, Full Name, Phone No., Warehouse Name) are required.' });
    }

    // Check if operator already exists
    const [existing] = await db.query(
      'SELECT id FROM do_operators WHERE email = ? LIMIT 1',
      [email]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Operator email already exists.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(password, salt);

    await db.query(
      'INSERT INTO do_operators (email, password, full_name, phone_no, warehouse_name) VALUES (?, ?, ?, ?, ?)',
      [email, hashed, full_name, phone_no, warehouse_name]
    );

    // Log the permission change
    await logActivity(
      req.user?.email || 'super_admin',
      'CREATE',
      'PERMISSION',
      `Registered operator profile: ${email} (Warehouse: ${warehouse_name})`
    );

    // Send login credentials to operator email (non-blocking for account creation)
    const emailResult = await sendOperatorCredentialsEmail({
      email: String(email).trim().toLowerCase(),
      password,
      full_name,
      phone_no,
      warehouse_name
    });

    if (emailResult.sent) {
      await logActivity(
        req.user?.email || 'super_admin',
        'EMAIL_SENT',
        'SECURITY',
        `Credentials email sent to DO: ${email}`
      );
    } else {
      await logActivity(
        req.user?.email || 'super_admin',
        'EMAIL_FAILED',
        'SECURITY',
        `Credentials email NOT sent to DO: ${email} (${emailResult.error || 'unknown'})`
      );
    }

    return res.status(201).json({
      message: emailResult.sent
        ? 'Data operator created successfully. Login credentials emailed.'
        : 'Data operator created successfully, but credentials email could not be sent.',
      emailSent: !!emailResult.sent,
      emailSkipped: !!emailResult.skipped,
      emailError: emailResult.sent ? null : (emailResult.error || null)
    });
  } catch (err) {
    return handleControllerError(res, err, {
      checkpoint: 'createOperator',
      req,
      clientMessage: 'Failed to create data operator.'
    });
  }
};

// 3. UPDATE OPERATOR
exports.updateOperator = async (req, res) => {
  try {
    const { id } = req.params;
    const { email, password, full_name, phone_no, warehouse_name } = req.body;

    if (!email || !full_name || !phone_no || !warehouse_name) {
      return res.status(400).json({ error: 'All fields (Email, Full Name, Phone No., Warehouse Name) are required.' });
    }

    // Check if email belongs to another operator
    const [existing] = await db.query(
      'SELECT id FROM do_operators WHERE email = ? AND id != ? LIMIT 1',
      [email, id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Email is already taken by another operator.' });
    }

    if (password && password.trim() !== '') {
      // Hash new password
      const salt = await bcrypt.genSalt(10);
      const hashed = await bcrypt.hash(password, salt);
      await db.query(
        'UPDATE do_operators SET email = ?, password = ?, full_name = ?, phone_no = ?, warehouse_name = ? WHERE id = ?',
        [email, hashed, full_name, phone_no, warehouse_name, id]
      );
    } else {
      await db.query(
        'UPDATE do_operators SET email = ?, full_name = ?, phone_no = ?, warehouse_name = ? WHERE id = ?',
        [email, full_name, phone_no, warehouse_name, id]
      );
    }

    // Log the permission change
    await logActivity(
      req.user?.email || 'super_admin',
      'UPDATE',
      'PERMISSION',
      `Updated operator profile: ${email} (Warehouse: ${warehouse_name})`
    );

    return res.json({ message: 'Data operator updated successfully.' });
  } catch (err) {
    return handleControllerError(res, err, {
      checkpoint: 'updateOperator',
      req,
      clientMessage: 'Failed to update data operator.'
    });
  }
};

// 4. DELETE OPERATOR
exports.deleteOperator = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Fetch operator details before deletion for audit logging
    const [opRows] = await db.query('SELECT email, warehouse_name FROM do_operators WHERE id = ? LIMIT 1', [id]);
    const opEmail = opRows.length > 0 ? opRows[0].email : `ID ${id}`;
    const opWarehouse = opRows.length > 0 ? opRows[0].warehouse_name : 'Unknown';

    await db.query('DELETE FROM do_operators WHERE id = ?', [id]);

    // Log the permission revocation
    await logActivity(
      req.user?.email || 'super_admin',
      'DELETE',
      'PERMISSION',
      `Revoked workspace access for operator: ${opEmail} (Warehouse: ${opWarehouse})`
    );

    return res.json({ message: 'Data operator deleted successfully.' });
  } catch (err) {
    return handleControllerError(res, err, {
      checkpoint: 'deleteOperator',
      req,
      clientMessage: 'Failed to delete data operator.'
    });
  }
};
