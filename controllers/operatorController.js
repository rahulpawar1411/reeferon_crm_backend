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
      'SELECT id, email, full_name, phone_no, warehouse_name, chamber_limit, created_at FROM do_operators ORDER BY id DESC'
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
    const { email, password, full_name, phone_no, warehouse_name, chamber_limit } = req.body;
    if (!email || !password || !full_name || !phone_no || !warehouse_name) {
      return res.status(400).json({ error: 'All fields (Email, Password, Full Name, Phone No., Warehouse Name) are required.' });
    }
    const limitVal = chamber_limit ? parseInt(chamber_limit, 10) : 4;

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
      'INSERT INTO do_operators (email, password, full_name, phone_no, warehouse_name, chamber_limit) VALUES (?, ?, ?, ?, ?, ?)',
      [email, hashed, full_name, phone_no, warehouse_name, limitVal]
    );

    // Log the permission change
    await logActivity(
      req.user?.email || 'super_admin',
      'CREATE',
      'PERMISSION',
      `Registered operator profile: ${email} (Warehouse: ${warehouse_name})`
    );

    // Respond immediately — do not wait for SMTP (Render free tier times out ~30s)
    res.status(201).json({
      message: 'Data operator created successfully. Login credentials email is being sent.',
      emailSent: null,
      emailQueued: true
    });

    // Background credentials email (after response)
    setImmediate(async () => {
      try {
        const emailResult = await sendOperatorCredentialsEmail({
          email: String(email).trim().toLowerCase(),
          password,
          full_name,
          phone_no,
          warehouse_name
        });
        await logActivity(
          req.user?.email || 'super_admin',
          emailResult.sent ? 'EMAIL_SENT' : 'EMAIL_FAILED',
          'SECURITY',
          emailResult.sent
            ? `Credentials email sent to DO: ${email}`
            : `Credentials email NOT sent to DO: ${email} (${emailResult.error || 'unknown'})`
        );
      } catch (mailErr) {
        console.error('❌ Background DO credentials email failed:', mailErr.message);
      }
    });
    return;
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
    const { email, password, full_name, phone_no, warehouse_name, chamber_limit } = req.body;

    if (!email || !full_name || !phone_no || !warehouse_name) {
      return res.status(400).json({ error: 'All fields (Email, Full Name, Phone No., Warehouse Name) are required.' });
    }
    const limitVal = chamber_limit ? parseInt(chamber_limit, 10) : 4;

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
        'UPDATE do_operators SET email = ?, password = ?, full_name = ?, phone_no = ?, warehouse_name = ?, chamber_limit = ? WHERE id = ?',
        [email, hashed, full_name, phone_no, warehouse_name, limitVal, id]
      );
    } else {
      await db.query(
        'UPDATE do_operators SET email = ?, full_name = ?, phone_no = ?, warehouse_name = ?, chamber_limit = ? WHERE id = ?',
        [email, full_name, phone_no, warehouse_name, limitVal, id]
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
