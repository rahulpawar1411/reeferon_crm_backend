// ====================================================================
// Daily Chamber Temp Log Routes (backend/routes/chamberTempRoutes.js)
// Multer Upload Configuration for temp_sensor_image
// ====================================================================

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const controller = require('../controllers/chamberTempController');

// Ensure destination folder exists: uploads/daily_temp_monitor_images/
const uploadDir = path.join(__dirname, '../uploads/daily_temp_monitor_images');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `sensor-temp-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({ storage });

router.get('/', controller.getChamberLogs);
router.post('/', upload.single('temp_sensor_image'), controller.addChamberLog);
router.put('/:id', upload.single('temp_sensor_image'), controller.updateChamberLog);
router.delete('/:id', controller.deleteChamberLog);

module.exports = router;
