import { Router } from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import ipLogService from '../services/ipLogService.js';
import suspiciousActivityService from '../services/suspiciousActivityService.js';

const router = Router();

router.get('/ip-history', authenticateToken, async (req, res) => {
  try {
    const { page, limit } = req.query;
    const result = await ipLogService.getIPHistory(req.user.id, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/suspicious', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page, limit, resolved, severity } = req.query;
    const result = await suspiciousActivityService.getSuspiciousActivities({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      resolved: resolved !== undefined ? resolved === 'true' : null,
      severity
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/suspicious/:id/resolve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const activity = await suspiciousActivityService.resolveActivity(req.params.id, req.user.id);
    res.json(activity);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/check-multiple-accounts/:ip', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await suspiciousActivityService.checkMultipleAccountsSameIP(req.params.ip);
    res.json({ flagged: !!result, details: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
