// ====================================================================
// Mobile Sub-Admin routes (full-access app accounts)
// Mounted at /api/sub-admins — Super Admin only
// ====================================================================

const express = require('express');
const router = express.Router();
const appSubAdminController = require('../controllers/appSubAdminController');

router.get('/', appSubAdminController.listSubAdmins);
router.post('/', appSubAdminController.createSubAdmin);
router.put('/:id', appSubAdminController.updateSubAdmin);
router.delete('/:id', appSubAdminController.deleteSubAdmin);

module.exports = router;
