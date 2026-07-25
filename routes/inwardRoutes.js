// ====================================================================
// DO Inward Temp Log Routes (backend/routes/inwardRoutes.js)
// Configures Multer storage for multi-file field uploading.
// ====================================================================

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const controller = require('../controllers/inwardController');

// Ensure destination folder exists: uploads/inward_images/
const uploadDir = path.join(__dirname, '../uploads/inward_images');
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
    cb(null, `inward-${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({ storage });

// Define multi-field uploads layout
const uploadFields = upload.fields([
  { name: 'inward_invoice_photos', maxCount: 1 }, 
  { name: 'inward_pod_photo', maxCount: 1 },
  { name: 'inward_vehicle_seal_photo', maxCount: 1 },
  { name: 'inward_vehicle_temp_photo', maxCount: 1 },
  { name: 'inward_material_temp_photo', maxCount: 1 },
  { name: 'inward_vehicle_back_side_photo', maxCount: 1 },
  { name: 'inward_vehicle_back_side_photo_with_material', maxCount: 1 },
  { name: 'inward_count_sheet_photo', maxCount: 1 },
  { name: 'inward_damage_boxes_photo', maxCount: 10 }
]);

router.get('/', controller.getInwardLogs);
router.post('/', uploadFields, controller.addInwardLog);
router.delete('/:id', controller.deleteInwardLog);

module.exports = router;
