const express = require('express');
const router = express.Router();
const masterController = require('../controllers/masterController');

router.get('/warehouses', masterController.listWarehouses);
router.post('/warehouses', masterController.createWarehouse);
router.put('/warehouses/:id', masterController.updateWarehouse);

router.get('/clients', masterController.listClients);
router.post('/clients', masterController.createClient);
router.put('/clients/:id', masterController.updateClient);

module.exports = router;
