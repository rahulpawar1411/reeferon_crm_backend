// ====================================================================
// Temperature Monitoring Routes (routes/tempRoutes.js)
// Endpoints for Data Operator daily Inward/Outward temp logs.
// ====================================================================

const express = require('express');
const router = express.Router();
const tempController = require('../controllers/tempController');

// GET /api/temp-logs - List all temp logs (optional ?entry_type= & ?search=)
router.get('/', tempController.getAllTempLogs);

// POST /api/temp-logs - Record new daily temp measurement
router.post('/', tempController.createTempLog);

// DELETE /api/temp-logs/:id - Delete a log entry
router.delete('/:id', tempController.deleteTempLog);

module.exports = router;
