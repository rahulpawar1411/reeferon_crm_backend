// ====================================================================
// Dashboard API Routes (routes/dashboardRoutes.js)
// ====================================================================

const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

// GET /api/dashboard/stats - Fetch aggregated stats
router.get('/stats', dashboardController.getDashboardStats);
router.get('/', dashboardController.getDashboardStats);

module.exports = router;
