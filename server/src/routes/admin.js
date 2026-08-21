import { Router } from 'express';
import * as adminController from '../controllers/adminController.js';
import * as chatController from '../controllers/chatController.js';
import * as paymentService from '../services/paymentService.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { supabase } from '../db/supabase.js';
import { logAction } from '../services/auditService.js';

const router = Router();
router.use(authenticateToken);
router.use(requireAdmin);

router.get('/dashboard', adminController.getDashboard);
router.get('/users', adminController.getUsers);
router.get('/users/:userId', adminController.getUserDetails);
router.put('/users/:userId/status', adminController.updateUserStatus);
router.patch('/users/:userId/password', adminController.resetUserPassword);
router.delete('/users/:userId', adminController.deleteUser);

router.get('/payments', adminController.getPayments);
router.put('/payments/:paymentId/approve', adminController.approvePayment);
router.put('/payments/:paymentId/reject', adminController.rejectPayment);
router.delete('/payments/:paymentId', adminController.deletePayment);

router.put('/payments/bulk-approve', async (req, res) => {
  try {
    const { paymentIds } = req.body;
    if (!Array.isArray(paymentIds) || paymentIds.length === 0) {
      return res.status(400).json({ success: false, message: 'paymentIds array required' });
    }
    const results = [];
    for (const pid of paymentIds) {
      try {
        await paymentService.approvePayment(pid, req.user.id);
        results.push({ id: pid, status: 'approved' });
      } catch (e) {
        results.push({ id: pid, status: 'skipped', reason: e.code === 'PAYMENT_NOT_PENDING' ? 'not pending' : e.message });
      }
    }
    res.json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/payments/bulk-reject', async (req, res) => {
  try {
    const { paymentIds, reason } = req.body;
    if (!Array.isArray(paymentIds) || paymentIds.length === 0) {
      return res.status(400).json({ success: false, message: 'paymentIds array required' });
    }
    const results = [];
    for (const pid of paymentIds) {
      try {
        const { data: payment } = await supabase.from('payments').select('*').eq('id', pid).single();
        if (!payment || payment.status !== 'pending') {
          results.push({ id: pid, status: 'skipped', reason: 'not pending' });
          continue;
        }
        await supabase.from('payments').update({ status: 'rejected', rejected_at: new Date().toISOString(), rejection_reason: reason || 'Bulk reject' }).eq('id', pid);
        await logAction(req.user.id, 'admin', 'bulk_reject_payment', pid, 'payment', { userId: payment.user_id, reason });
        results.push({ id: pid, status: 'rejected' });
      } catch (e) {
        results.push({ id: pid, status: 'error', message: e.message });
      }
    }
    res.json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/topups', adminController.getTopups);
router.delete('/topups/:topupId', adminController.deleteTopup);

router.get('/plan-change-requests', adminController.getPlanChangeRequests);
router.put('/plan-change-requests/:requestId/approve', adminController.approvePlanChangeRequest);
router.put('/plan-change-requests/:requestId/reject', adminController.rejectPlanChangeRequest);
router.delete('/plan-change-requests/:requestId', adminController.deletePlanChange);

router.get('/inactive-users', adminController.getInactiveUsers);
router.put('/users/:userId/activate', adminController.activateUser);

router.get('/chats', adminController.getChats);
router.get('/chats/:conversationId/messages', adminController.getChatMessages);
router.put('/chats/:conversationId/read', adminController.markChatRead);
router.post('/chats/messages', adminController.sendAdminMessage);

router.get('/audit-logs', adminController.getAuditLogs);

export default router;
