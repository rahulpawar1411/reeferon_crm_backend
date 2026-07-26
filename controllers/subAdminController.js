// ====================================================================
// Sub-Admin Controller (backend/controllers/subAdminController.js)
// Implements secure CRUD actions for managing Sub-Admin accounts.
// ====================================================================

const db = require('../config/db');
const bcrypt = require('bcryptjs');
const { logActivity } = require('../utils/logger');

// 1. GET ALL SUB-ADMINS
exports.getSubAdmins = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, email, full_name, phone_no, created_at FROM sub_admins ORDER BY id DESC'
    );
    return res.json(rows);
  } catch (err) {
    console.error('Error fetching sub-admins:', err);
    return res.status(500).json({ error: 'Failed to fetch sub-admins.' });
  }
};

// 2. CREATE NEW SUB-ADMIN
exports.createSubAdmin = async (req, res) => {
  try {
    const { email, password, full_name, phone_no } = req.body;
    if (!email || !password || !full_name || !phone_no) {
      return res.status(400).json({ error: 'All fields (Email, Password, Full Name, Phone No.) are required.' });
    }

    // Check if sub-admin email already exists
    const [existing] = await db.query(
      'SELECT id FROM sub_admins WHERE email = ? LIMIT 1',
      [email]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Sub-Admin email already exists.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(password, salt);

    await db.query(
      'INSERT INTO sub_admins (email, password, full_name, phone_no) VALUES (?, ?, ?, ?)',
      [email, hashed, full_name, phone_no]
    );

    // Log the permission change
    await logActivity(
      req.user?.email || 'super_admin',
      'CREATE',
      'PERMISSION',
      `Registered sub-admin profile: ${email}`
    );

    return res.status(201).json({ message: 'Sub-admin created successfully.' });
  } catch (err) {
    console.error('Error creating sub-admin:', err);
    return res.status(500).json({ error: 'Failed to create sub-admin.' });
  }
};

// 3. UPDATE SUB-ADMIN
exports.updateSubAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { email, password, full_name, phone_no } = req.body;

    if (!email || !full_name || !phone_no) {
      return res.status(400).json({ error: 'All fields (Email, Full Name, Phone No.) are required.' });
    }

    // Check if email belongs to another sub-admin
    const [existing] = await db.query(
      'SELECT id FROM sub_admins WHERE email = ? AND id != ? LIMIT 1',
      [email, id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Email is already taken by another sub-admin.' });
    }

    if (password && password.trim() !== '') {
      // Hash new password
      const salt = await bcrypt.genSalt(10);
      const hashed = await bcrypt.hash(password, salt);
      await db.query(
        'UPDATE sub_admins SET email = ?, password = ?, full_name = ?, phone_no = ? WHERE id = ?',
        [email, hashed, full_name, phone_no, id]
      );
    } else {
      await db.query(
        'UPDATE sub_admins SET email = ?, full_name = ?, phone_no = ? WHERE id = ?',
        [email, full_name, phone_no, id]
      );
    }

    // Log the permission change
    await logActivity(
      req.user?.email || 'super_admin',
      'UPDATE',
      'PERMISSION',
      `Updated sub-admin profile: ${email}`
    );

    return res.json({ message: 'Sub-admin updated successfully.' });
  } catch (err) {
    console.error('Error updating sub-admin:', err);
    return res.status(500).json({ error: 'Failed to update sub-admin.' });
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
    console.error('Error deleting sub-admin:', err);
    return res.status(500).json({ error: 'Failed to delete sub-admin.' });
  }
};
