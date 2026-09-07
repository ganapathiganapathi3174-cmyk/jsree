import { Router } from 'express';
import * as configController from '../controllers/configController.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = Router();

// Public: get UPI ID and plans for frontend display
router.get('/public', configController.getPublicConfig);

// Admin-only: full config read/write
router.get('/', authenticateToken, requireAdmin, configController.getFullConfig);
router.put('/', authenticateToken, requireAdmin, configController.updateConfig);

export default router;
