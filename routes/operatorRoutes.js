// ====================================================================
// Data Operator Routes (backend/routes/operatorRoutes.js)
// Defines API endpoints for Super Admin to CRUD Data Operator accounts.
// ====================================================================

const express = require('express');
const router = express.Router();
const operatorController = require('../controllers/operatorController');

// All endpoints are managed under Super Admin scope in server.js
router.get('/', operatorController.getOperators);
router.post('/', operatorController.createOperator);
router.put('/:id', operatorController.updateOperator);
router.delete('/:id', operatorController.deleteOperator);

module.exports = router;
