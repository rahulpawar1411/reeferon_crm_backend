// ====================================================================
// Sub-Admin Routes (backend/routes/subAdminRoutes.js)
// Defines API endpoints for Super Admin to CRUD Sub-Admin accounts.
// ====================================================================

const express = require('express');
const router = express.Router();
const subAdminController = require('../controllers/subAdminController');

router.get('/', subAdminController.getSubAdmins);
router.post('/', subAdminController.createSubAdmin);
router.put('/:id', subAdminController.updateSubAdmin);
router.delete('/:id', subAdminController.deleteSubAdmin);

module.exports = router;
