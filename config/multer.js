const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

/**
 * Uploads a file buffer directly to Cloudinary using the official SDK.
 * @param {Buffer} buffer - The file buffer in memory
 * @param {string} folder - The destination folder name
 * @param {string} publicId - Generated public ID for the file
 */
const uploadBuffer = (buffer, folder, publicId) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `crm/${folder}`,
        public_id: publicId,
        resource_type: 'auto'
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
};

/**
 * Creates custom upload middleware that dynamically routes to Cloudinary or Local Disk.
 * Returns an object exposing `single(fieldName)` and `fields(fieldsArray)` middleware functions.
 */
const createUploader = (folderName, filePrefix) => {
  const uploadToCloudinary = process.env.UPLOAD_TO_CLOUDINARY === 'true';

  if (uploadToCloudinary && process.env.CLOUDINARY_CLOUD_NAME) {
    // Cloudinary Mode: Parse files to memory, then upload to Cloudinary in a wrapper middleware
    const memoryMulter = multer({ storage: multer.memoryStorage() });

    return {
      single: (fieldName) => {
        const parse = memoryMulter.single(fieldName);
        return (req, res, next) => {
          parse(req, res, async (err) => {
            if (err) return next(err);
            if (!req.file) return next();

            try {
              const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
              const publicId = `${filePrefix}-${fieldName}-${uniqueSuffix}`;
              const result = await uploadBuffer(req.file.buffer, folderName, publicId);
              
              // Map the Cloudinary secure URL to req.file.path
              req.file.path = result.secure_url;
              next();
            } catch (uploadErr) {
              next(uploadErr);
            }
          });
        };
      },

      fields: (fieldsArray) => {
        const parse = memoryMulter.fields(fieldsArray);
        return (req, res, next) => {
          parse(req, res, async (err) => {
            if (err) return next(err);
            if (!req.files) return next();

            try {
              const uploadPromises = [];
              
              for (const fieldName of Object.keys(req.files)) {
                const filesList = req.files[fieldName];
                for (let i = 0; i < filesList.length; i++) {
                  const file = filesList[i];
                  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                  const publicId = `${filePrefix}-${fieldName}-${uniqueSuffix}`;
                  
                  const promise = uploadBuffer(file.buffer, folderName, publicId)
                    .then((result) => {
                      file.path = result.secure_url;
                    });
                  uploadPromises.push(promise);
                }
              }

              await Promise.all(uploadPromises);
              next();
            } catch (uploadErr) {
              next(uploadErr);
            }
          });
        };
      }
    };
  } else {
    // Disk Storage Fallback Mode (For self-hosting on Hostinger)
    const uploadDir = path.join(__dirname, '../uploads', folderName);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, uploadDir);
      },
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `${filePrefix}-${file.fieldname || 'photo'}-${uniqueSuffix}${ext}`);
      }
    });

    const diskMulter = multer({ storage });
    return {
      single: (fieldName) => diskMulter.single(fieldName),
      fields: (fieldsArray) => diskMulter.fields(fieldsArray)
    };
  }
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
