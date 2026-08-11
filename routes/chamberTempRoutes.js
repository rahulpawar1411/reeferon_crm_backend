// ====================================================================
// Daily Chamber Temp Log Routes (backend/routes/chamberTempRoutes.js)
// Multer Upload Configuration for temp_sensor_image
// ====================================================================

const express = require('express');
const router = express.Router();
const { createUploader } = require('../config/multer');
const controller = require('../controllers/chamberTempController');

const upload = createUploader('daily_temp_monitor_images', 'sensor-temp');

router.get('/', controller.getChamberLogs);
router.post('/', upload.single('temp_sensor_image'), controller.addChamberLog);
router.put('/:id', upload.single('temp_sensor_image'), controller.updateChamberLog);
router.delete('/:id', controller.deleteChamberLog);

module.exports = router;
