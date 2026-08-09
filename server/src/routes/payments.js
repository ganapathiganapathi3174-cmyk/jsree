import { Router } from 'express';
import * as paymentController from '../controllers/paymentController.js';
import { authenticateToken } from '../middleware/auth.js';
import { validatePayment } from '../middleware/validation.js';
import { uploadScreenshot, handleUploadError } from '../middleware/upload.js';

const router = Router();

router.post('/', authenticateToken, validatePayment, paymentController.createPayment);
router.post('/:paymentId/screenshot', authenticateToken, uploadScreenshot, handleUploadError, paymentController.uploadScreenshot);
router.post('/:paymentId/verify', authenticateToken, paymentController.verifyPaymentManual);
router.get('/:paymentId/status', authenticateToken, paymentController.getPaymentStatus);
router.get('/', authenticateToken, paymentController.getUserPayments);

export default router;
