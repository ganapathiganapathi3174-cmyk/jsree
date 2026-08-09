import { Router } from 'express';
import { authenticateToken, requireActiveUser } from '../middleware/auth.js';
import walletService from '../services/walletService.js';

const router = Router();

router.get('/balance', authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const balance = await walletService.getBalance(req.user.id);
    res.json({ balance });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/transactions', authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { page, limit, type } = req.query;
    const result = await walletService.getTransactions(req.user.id, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      type
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
