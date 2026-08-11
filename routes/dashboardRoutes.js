// ====================================================================
// Dashboard API Routes (routes/dashboardRoutes.js)
// ====================================================================

const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

// GET /api/dashboard/stats - Fetch aggregated stats
router.get('/stats', dashboardController.getDashboardStats);
router.get('/', dashboardController.getDashboardStats);

// GET /api/dashboard/access-options - Fetch distinct clients & warehouses for customer scope
router.get('/access-options', dashboardController.getAccessScopeOptions);

// GET /api/dashboard/inventory-filter-options - Live warehouse → client lists from DB
router.get('/inventory-filter-options', dashboardController.getInventoryFilterOptions);

// GET /api/dashboard/inventory-reconciliation - Fetch inventory box calculations and discrepancies
router.get('/inventory-reconciliation', dashboardController.getInventoryReconciliation);

// GET /api/dashboard/daily-inventory-deltas - Fetch daily inventory box comparisons (deltas)
router.get('/daily-inventory-deltas', dashboardController.getDailyInventoryDeltas);

// GET /api/dashboard/do-task-overview - Warehouse-wise DO completed / pending / overdue
router.get('/do-task-overview', dashboardController.getDoTaskOverview);

module.exports = router;
