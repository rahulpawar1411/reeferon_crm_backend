const express = require('express');
const router = express.Router();
const activityController = require('../controllers/activityController');
const { requireRole } = require('../middleware/auth');

router.get('/', requireRole(['super_admin']), activityController.getActivityLogs);
router.post('/', activityController.createActivityLog);

module.exports = router;
