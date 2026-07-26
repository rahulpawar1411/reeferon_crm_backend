// ====================================================================
// Authentication Middleware (backend/middleware/auth.js)
// Verifies JWT token from HttpOnly cookies and handles Role-Based permissions.
// ====================================================================

const jwt = require('jsonwebtoken');

/**
 * 1. Global Authentication Verification Middleware
 * Extracts the JWT token from HttpOnly cookies and verifies its signature.
 */
exports.verifyToken = (req, res, next) => {
  try {
    // Read token from cookies (requires cookie-parser)
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access Denied: No authentication token provided. Please log in.'
      });
    }

    // Verify JWT Signature
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'ReeferON_SuperSecured_JWT_Secret_Token_Key_2026');
    
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
