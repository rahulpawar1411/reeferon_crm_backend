// ====================================================================
// Permission Requests Routes
// (backend/routes/permissionRoutes.js)
// Maps permission-related actions to controllers.
// ====================================================================

const express = require('express');
const router = express.Router();
const permissionController = require('../controllers/permissionController');
const { verifyToken, requireRole } = require('../middleware/auth');

// 1. Get system-wide permissions config settings
router.get('/config', verifyToken, permissionController.getSystemConfig);

// 2. Update system-wide permissions config settings (Super Admin only)
router.post('/config', verifyToken, requireRole(['super_admin']), permissionController.updateSystemConfig);

// 3. Check if permission is approved for a specific record (DO Operator)
router.get('/check', verifyToken, permissionController.checkPermission);

// 4. Get permission requests (All for Super Admin, User-specific for Operator)
router.get('/', verifyToken, permissionController.getPermissionRequests);

// 5. Request edit permission (DO Operator)
router.post('/', verifyToken, permissionController.createPermissionRequest);

// 6. Approve or deny permission request (Super Admin only)
router.put('/:id', verifyToken, requireRole(['super_admin']), permissionController.updatePermissionRequestStatus);

// 7. DO marks notification as handled (Completed section)
router.patch(
  '/:id/complete',
  verifyToken,
  requireRole(['do_operator', 'super_admin']),
  permissionController.markPermissionActionComplete
);

module.exports = router;
