import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import notificationService from '../services/notificationService.js';

const router = Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page, limit, unreadOnly } = req.query;
    const result = await notificationService.getNotifications(req.user.id, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      unreadOnly: unreadOnly === 'true'
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const count = await notificationService.getUnreadCount(req.user.id);
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/read', authenticateToken, async (req, res) => {
  try {
    const notification = await notificationService.markAsRead(req.params.id, req.user.id);
    res.json(notification);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/read-all', authenticateToken, async (req, res) => {
  try {
    await notificationService.markAllAsRead(req.user.id);
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await notificationService.deleteNotification(req.params.id, req.user.id);
    res.json({ message: 'Notification deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
