import { Router } from 'express';
import * as authController from '../controllers/authController.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateRegistration, validateLogin } from '../middleware/validation.js';

const router = Router();

router.post('/register', validateRegistration, authController.register);
router.post('/login', validateLogin, authController.login);
router.post('/admin-login', validateLogin, authController.adminLogin);
router.post('/logout', authenticateToken, authController.logout);
router.get('/profile', authenticateToken, authController.getProfile);
router.put('/change-password', authenticateToken, authController.changePassword);

export default router;
