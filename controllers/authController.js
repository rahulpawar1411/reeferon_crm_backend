// ====================================================================
// Authentication Controller (backend/controllers/authController.js)
// Implements secure Login, Logout, Profile verification, and Bcrypt validation.
// ====================================================================

const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { logActivity } = require('../utils/logger');

// Expiration time: 24 hours
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; 

/**
 * Helper: Map selected UI Role to its corresponding DB Table Name.
 */
const getTableForRole = (role) => {
  switch (role) {
    case 'super_admin':
      return 'super_admin';
    case 'sub_admin':
      return 'sub_admins';
    case 'do_operator':
      return 'do_operators';
    default:
      return null;
  }
};

/**
 * 1. User Login Handler
 * Checks credentials against Bcrypt hash in role-specific DB table.
 * Sends signed JWT token in an HttpOnly secure Cookie.
 */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Validation Checks
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    let user = null;
    let resolvedRole = null;

    // A. Check in super_admin table
    const [superRows] = await db.query('SELECT * FROM super_admin WHERE email = ? LIMIT 1', [cleanEmail]);
    if (superRows.length > 0) {
      user = superRows[0];
      resolvedRole = 'super_admin';
    } else {
      // B. Check in sub_admins table
      const [subRows] = await db.query('SELECT * FROM sub_admins WHERE email = ? LIMIT 1', [cleanEmail]);
      if (subRows.length > 0) {
        user = subRows[0];
        resolvedRole = 'sub_admin';
      } else {
        // C. Check in do_operators table
        const [doRows] = await db.query('SELECT * FROM do_operators WHERE email = ? LIMIT 1', [cleanEmail]);
        if (doRows.length > 0) {
          user = doRows[0];
          resolvedRole = 'do_operator';
        }
      }
    }

    // 2. If user not found in any table
    if (!user) {
      console.warn(`⚠️ Security Warning: Failed login attempt for unregistered email: ${cleanEmail}`);
      await logActivity(cleanEmail, 'LOGIN_FAILED', 'SECURITY', `Failed login attempt for unregistered email`);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password. Access Denied.'
      });
    }

    // 3. Verify Password Hash using Bcrypt
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.warn(`⚠️ Security Warning: Incorrect password entered for: ${cleanEmail} (Resolved Role: ${resolvedRole})`);
      await logActivity(cleanEmail, 'LOGIN_FAILED', 'SECURITY', `Incorrect password attempt for role: ${resolvedRole}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password. Access Denied.'
      });
    }

    // 4. Generate JSON Web Token (JWT)
    const tokenPayload = {
      id: user.id,
      email: user.email,
      role: resolvedRole,
      full_name: user.full_name || user.fullName || user.username || user.name || null,
      phone_no: user.phone_no || user.phone || null,
      warehouse_name: user.warehouse_name || user.warehouse || null
    };

    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET || 'ReeferON_SuperSecured_JWT_Secret_Token_Key_2026',
      { expiresIn: '24h' }
    );

    // 5. Send token in an HTTP-Only Secure Cookie
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true, // Prevents XSS token reading
      secure: isProduction, // Set to true in HTTPS production
      sameSite: 'strict', // CSRF Protection
      maxAge: TOKEN_EXPIRY_MS // 24 hours expiry
    });

    console.log(`🔐 Success: User ${cleanEmail} authenticated successfully. Role: ${resolvedRole}`);
    await logActivity(cleanEmail, 'LOGIN', 'SECURITY', `Authenticated successfully as role: ${resolvedRole}`);

    return res.status(200).json({
      success: true,
      message: 'Logged in successfully.',
      user: tokenPayload
    });
  } catch (error) {
    console.error('❌ Login Error:', error);
    return res.status(500).json({
      success: false,
      message: 'A server error occurred during login. Please contact support.',
      error: error.message
    });
  }
};

/**
 * 2. User Logout Handler
 * Clears the verification JWT token cookie.
 */
exports.logout = (req, res) => {
  try {
    res.clearCookie('token', {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production'
    });

    console.log('🔐 Success: User session cleared successfully.');
    return res.status(200).json({
      success: true,
      message: 'Logged out successfully.'
    });
  } catch (error) {
    console.error('❌ Logout Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while clearing session.',
      error: error.message
    });
  }
};

/**
 * 3. Token Profile Verification Handler (Get Logged In User Info)
 * Decodes active token cookie and returns session data.
 */
exports.getMe = async (req, res) => {
  try {
    // req.user has already been populated by verifyToken middleware
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'No active session found.'
      });
    }

    return res.status(200).json({
      success: true,
      user: req.user
    });
  } catch (error) {
    console.error('❌ Profile Fetch Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving user profile.',
      error: error.message
    });
  }
};
