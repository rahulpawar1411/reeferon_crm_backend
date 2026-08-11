// ====================================================================
// Customer Report Routes
// POST   /api/customer-reports             — Customer submit
// GET    /api/customer-reports             — Super Admin list
// PATCH  /api/customer-reports/:id/status  — Super Admin status update
// DELETE /api/customer-reports/:id         — Super Admin delete
// ====================================================================

const express = require('express');
const router = express.Router();
const customerReportController = require('../controllers/customerReportController');

router.post('/', customerReportController.createCustomerReport);
router.get('/', customerReportController.getCustomerReports);
router.patch('/:id/status', customerReportController.updateCustomerReportStatus);
router.delete('/:id', customerReportController.deleteCustomerReport);

module.exports = router;
