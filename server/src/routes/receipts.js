import { Router } from 'express';
import { authenticateToken, requireActiveUser } from '../middleware/auth.js';
import paymentReceiptService from '../services/paymentReceiptService.js';

const router = Router();

router.get('/my-receipts', authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { page, limit } = req.query;
    const result = await paymentReceiptService.getUserReceipts(req.user.id, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:paymentId', authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const receipt = await paymentReceiptService.generateReceipt(req.params.paymentId);
    res.json(receipt);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:paymentId/html', authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const receipt = await paymentReceiptService.generateReceipt(req.params.paymentId);
    const html = paymentReceiptService.generateHTML(receipt);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
