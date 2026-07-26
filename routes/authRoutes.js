// ====================================================================
// Authentication Routes (backend/routes/authRoutes.js)
// Defines endpoints for Login, Logout, and Token validation checks.
// ====================================================================

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');

// 1. PUBLIC ENDPOINTS
router.post('/login', authController.login);
router.post('/logout', authController.logout);

// 2. PROTECTED ENDPOINTS (Session Profile Check)
router.get('/me', verifyToken, authController.getMe);

module.exports = router;
