import { Router } from 'express';
import { authenticateToken, requireActiveUser } from '../middleware/auth.js';
import paymentReceiptService from '../services/paymentReceiptService.js';

const router = Router();

// Maps service authorization errors to HTTP status without echoing receipt
// data: 403 UNAUTHORIZED for a cross-user request (consistent with
// paymentController), 404 PAYMENT_NOT_FOUND for a missing payment, 500 otherwise.
function sendReceiptError(res, error) {
  const status = error.code === 'PAYMENT_NOT_FOUND' ? 404 :
    error.code === 'UNAUTHORIZED' ? 403 : 500;
  res.status(status).json({
    success: false,
    message: error.message || 'Receipt error',
    code: error.code || 'RECEIPT_ERROR'
  });
}

router.get('/my-receipts', authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { page, limit } = req.query;
    const result = await paymentReceiptService.getUserReceipts(req.user.id, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20
    });
    res.json(result);
  } catch (error) {
    sendReceiptError(res, error);
  }
});

router.get('/:paymentId', authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const receipt = await paymentReceiptService.generateReceipt(req.params.paymentId, req.user);
    res.json(receipt);
  } catch (error) {
    sendReceiptError(res, error);
  }
});

router.get('/:paymentId/html', authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const receipt = await paymentReceiptService.generateReceipt(req.params.paymentId, req.user);
    const html = paymentReceiptService.generateHTML(receipt);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    sendReceiptError(res, error);
  }
});

export default router;
