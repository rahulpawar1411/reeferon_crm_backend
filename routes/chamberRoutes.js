const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const controller = require('../controllers/chamberController');

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

// Define Chamber and Client assignment routes
router.get('/', controller.getChambers);
router.post('/', controller.createChamber);
router.get('/assignments', controller.getAssignments);
router.post('/assignments', controller.addAssignment);
router.delete('/assignments', controller.deleteAssignment);
router.put('/:id', controller.updateChamber);
router.delete('/:id', controller.deleteChamber);
router.post('/inspections', upload.single('sensor_photo'), controller.addInspection);
router.get('/inspections', controller.getInspections);
router.delete('/inspections/:id', controller.deleteInspection);

module.exports = router;
