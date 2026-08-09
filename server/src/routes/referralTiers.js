import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import referralTierService from '../services/referralTierService.js';

const router = Router();

router.get('/tiers', async (req, res) => {
  try {
    const tiers = await referralTierService.getAllTiers();
    res.json(tiers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/my-tier', authenticateToken, async (req, res) => {
  try {
    const tierInfo = await referralTierService.getUserTier(req.user.id);
    res.json(tierInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
