// ====================================================================
// Customer Report Routes
// POST  /api/customer-reports          — Sub Admin submit
// GET   /api/customer-reports          — Super Admin list
// PATCH /api/customer-reports/:id/status — Super Admin status update
// ====================================================================

const express = require('express');
const router = express.Router();
const customerReportController = require('../controllers/customerReportController');

router.post('/', customerReportController.createCustomerReport);
router.get('/', customerReportController.getCustomerReports);
router.patch('/:id/status', customerReportController.updateCustomerReportStatus);

module.exports = router;
