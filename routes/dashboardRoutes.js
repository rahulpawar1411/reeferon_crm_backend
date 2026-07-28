// ====================================================================
// Dashboard API Routes (routes/dashboardRoutes.js)
// ====================================================================

const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

// GET /api/dashboard/stats - Fetch aggregated stats
router.get('/stats', dashboardController.getDashboardStats);
router.get('/', dashboardController.getDashboardStats);

// GET /api/dashboard/access-options - Fetch distinct clients & warehouses for sub-admin scope
router.get('/access-options', dashboardController.getAccessScopeOptions);

module.exports = router;
