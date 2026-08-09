import { Router } from 'express';
import * as planController from '../controllers/planController.js';
import { authenticateToken, requireActiveUser } from '../middleware/auth.js';
import { validatePlanChange } from '../middleware/validation.js';

const router = Router();

router.get('/', planController.getPlans);
router.post('/change-request', authenticateToken, requireActiveUser, validatePlanChange, planController.requestPlanChange);
router.get('/my-requests', authenticateToken, requireActiveUser, planController.getMyRequests);

export default router;
