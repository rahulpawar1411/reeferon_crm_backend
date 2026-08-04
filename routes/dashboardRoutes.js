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

// GET /api/dashboard/inventory-reconciliation - Fetch inventory box calculations and discrepancies
router.get('/inventory-reconciliation', dashboardController.getInventoryReconciliation);

// GET /api/dashboard/daily-inventory-deltas - Fetch daily inventory box comparisons (deltas)
router.get('/daily-inventory-deltas', dashboardController.getDailyInventoryDeltas);

module.exports = router;
