import { Router } from 'express';
import * as userController from '../controllers/userController.js';
import { authenticateToken, requireActiveUser } from '../middleware/auth.js';

const router = Router();

router.get('/profile', authenticateToken, userController.getProfile);
router.put('/profile', authenticateToken, userController.updateProfile);
router.get('/dashboard', authenticateToken, requireActiveUser, userController.getDashboard);

export default router;
