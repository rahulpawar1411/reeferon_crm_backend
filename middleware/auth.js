// ====================================================================
// Authentication Middleware (backend/middleware/auth.js)
// Verifies JWT token from HttpOnly cookies and handles Role-Based permissions.
// ====================================================================

const jwt = require('jsonwebtoken');
const db = require('../config/db');

/**
 * 1. Global Authentication Verification Middleware
 * Extracts the JWT token from HttpOnly cookies and verifies its signature.
 */
exports.verifyToken = async (req, res, next) => {
  try {
    // Read token from cookies or Authorization header
    let token = req.cookies.token;
    
    if (!token && req.headers.authorization) {
      const authHeader = req.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access Denied: No authentication token provided. Please log in.'
      });
    }

    // Verify JWT Signature
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'ReeferON_SuperSecured_JWT_Secret_Token_Key_2026');
    
    // Check if the user still exists in the database
    let userExists = false;
    try {
      if (decoded.role === 'super_admin') {
        const [rows] = await db.query('SELECT id FROM super_admin WHERE email = ? LIMIT 1', [decoded.email]);
        if (rows.length > 0) userExists = true;
      } else if (decoded.role === 'sub_admin') {
        const [rows] = await db.query('SELECT id FROM sub_admins WHERE email = ? LIMIT 1', [decoded.email]);
        if (rows.length > 0) userExists = true;
      } else if (decoded.role === 'do_operator') {
        const [rows] = await db.query('SELECT id FROM do_operators WHERE email = ? LIMIT 1', [decoded.email]);
        if (rows.length > 0) userExists = true;
      }
    } catch (dbErr) {
      console.warn('⚠️ DB verifyToken check failed, defaulting to allow request:', dbErr.message);
      userExists = true; // Fallback to prevent blocking user in case of query errors
    }

    if (!userExists) {
      return res.status(401).json({
        success: false,
        message: 'Your account has been deleted or disabled. Please log in again.'
      });
    }

    // Attach decoded user context (id, email, role) to the request object
    req.user = decoded;
    
    return next();
  } catch (error) {
    console.error('❌ JWT Verification Error:', error.message);
    
    // Handle specific JWT Errors cleanly
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Your session has expired. Please log in again.'
      });
    }
    
    return res.status(403).json({
      success: false,
      message: 'Invalid signature or corrupt token. Authentication failed.'
    });
  }
};

/**
 * 2. Role Authorization Middleware Helper
 * Restricts route access to specific roles (e.g. ['super_admin', 'sub_admin']).
 * Must be mounted AFTER verifyToken middleware.
 */
exports.requireRole = (allowedRoles = []) => {
  return (req, res, next) => {
    try {
      // Ensure verifyToken was run first
      if (!req.user || !req.user.role) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized: User authentication context missing.'
        });
      }

      // Check if user's role is permitted
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: `Access Denied: Role '${req.user.role}' does not have permission to access this resource.`
        });
      }

      return next();
    } catch (error) {
      console.error('❌ Role Authorization Error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Internal server error during authorization check.'
      });
    }
  };
};
