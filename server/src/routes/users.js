import { Router } from 'express';
import * as userController from '../controllers/userController.js';
import { authenticateToken, requireActiveUser } from '../middleware/auth.js';
import { uploadAvatar, handleUploadError } from '../middleware/upload.js';

const router = Router();

router.get('/profile', authenticateToken, userController.getProfile);
router.put('/profile', authenticateToken, userController.updateProfile);
router.get('/dashboard', authenticateToken, requireActiveUser, userController.getDashboard);
router.put('/avatar', authenticateToken, uploadAvatar, handleUploadError, userController.uploadAvatar);
router.delete('/avatar', authenticateToken, userController.removeAvatar);

export default router;
