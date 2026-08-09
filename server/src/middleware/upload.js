import multer from 'multer';
import { generateUniqueFilename } from '../utils/helpers.js';

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPG, JPEG, PNG, and WEBP files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE
  }
});

export const uploadScreenshot = upload.single('screenshot');
export const uploadTopupProof = upload.single('screenshot');

export const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 5MB.',
        code: 'FILE_TOO_LARGE'
      });
    }
    return res.status(400).json({
      success: false,
      message: 'File upload error',
      code: 'UPLOAD_ERROR'
    });
  }
  if (err && err.message) {
    return res.status(400).json({
      success: false,
      message: err.message,
      code: 'INVALID_FILE_TYPE'
    });
  }
  next();
};
