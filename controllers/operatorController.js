// ====================================================================
// Data Operator Controller (backend/controllers/operatorController.js)
// Implements secure CRUD actions for managing Data Operator accounts.
// ====================================================================

const db = require('../config/db');
const bcrypt = require('bcryptjs');

// 1. GET ALL OPERATORS
exports.getOperators = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, email, full_name, phone_no, warehouse_name, created_at FROM do_operators ORDER BY id DESC'
    );
    return res.json(rows);
  } catch (err) {
    console.error('Error fetching operators:', err);
    return res.status(500).json({ error: 'Failed to fetch data operators.' });
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

    return res.status(201).json({ message: 'Data operator created successfully.' });
  } catch (err) {
    console.error('Error creating operator:', err);
    return res.status(500).json({ error: 'Failed to create data operator.' });
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

    return res.json({ message: 'Data operator updated successfully.' });
  } catch (err) {
    console.error('Error updating operator:', err);
    return res.status(500).json({ error: 'Failed to update data operator.' });
  }
};

// 4. DELETE OPERATOR
exports.deleteOperator = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM do_operators WHERE id = ?', [id]);
    return res.json({ message: 'Data operator deleted successfully.' });
  } catch (err) {
    console.error('Error deleting operator:', err);
    return res.status(500).json({ error: 'Failed to delete data operator.' });
  }
};
