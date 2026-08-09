import { Router } from 'express';
import * as referralController from '../controllers/referralController.js';
import { authenticateToken, requireActiveUser } from '../middleware/auth.js';

const router = Router();

router.get('/my-code', authenticateToken, requireActiveUser, referralController.getMyReferralCode);
router.get('/my-referrals', authenticateToken, requireActiveUser, referralController.getMyReferrals);
router.get('/validate', referralController.validateReferralCode);

export default router;
