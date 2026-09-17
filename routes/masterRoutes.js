// ====================================================================
// Master Data Routes — /api/masters
// Catalog only: warehouses + clients. Roles: super_admin, sub_admin.
// Operational chambers/assignments live under /api/chambers.
// ====================================================================

const express = require('express');
const router = express.Router();
const masterController = require('../controllers/masterController');

// Warehouses (warehouse_master)
router.get('/warehouses', masterController.listWarehouses);
router.post('/warehouses', masterController.createWarehouse);
router.put('/warehouses/:id', masterController.updateWarehouse);
router.delete('/warehouses/:id', masterController.deleteWarehouse);

// Clients (client_master)
router.get('/clients', masterController.listClients);
router.post('/clients', masterController.createClient);
router.put('/clients/:id', masterController.updateClient);
router.delete('/clients/:id', masterController.deleteClient);

module.exports = router;
