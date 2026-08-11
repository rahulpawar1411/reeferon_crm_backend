const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Configure Cloudinary if keys are provided
if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

/**
 * Creates storage engine depending on UPLOAD_TO_CLOUDINARY setting.
 * @param {string} folderName - The folder name under uploads/ or Cloudinary crm/
 * @param {string} filePrefix - The filename prefix
 */
const getStorage = (folderName, filePrefix) => {
  const uploadToCloudinary = process.env.UPLOAD_TO_CLOUDINARY === 'true';

  if (uploadToCloudinary && process.env.CLOUDINARY_CLOUD_NAME) {
    return new CloudinaryStorage({
      cloudinary: cloudinary,
      params: {
        folder: `crm/${folderName}`,
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
        public_id: (req, file) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
          return `${filePrefix}-${file.fieldname || 'photo'}-${uniqueSuffix}`;
        }
      }
    });
  } else {
    // Disk Storage Fallback
    const uploadDir = path.join(__dirname, '../uploads', folderName);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    return multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, uploadDir);
      },
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `${filePrefix}-${file.fieldname || 'photo'}-${uniqueSuffix}${ext}`);
      }
    });
  }
};

/**
 * Creates a Multer instance configured for the specified folder.
 * @param {string} folderName - Subfolder in uploads/ (e.g. 'daily_temp_monitor_images')
 * @param {string} filePrefix - Prefix for generated file name (e.g. 'sensor-temp')
 */
const createUploader = (folderName, filePrefix) => {
  const storage = getStorage(folderName, filePrefix);
  return multer({ storage });
};

/**
 * Helper to get the saved path for database storage.
 * Returns the Cloudinary HTTP URL if uploaded to Cloud,
 * or the local relative path (e.g., uploads/folderName/filename) if stored locally.
 */
const getSavedFilePath = (file, folderName) => {
  if (!file) return null;
  if (file.path && /^https?:\/\//i.test(file.path)) {
    return file.path;
  }
  return `uploads/${folderName}/${file.filename}`;
};

module.exports = {
  createUploader,
  getSavedFilePath,
  cloudinary
};
