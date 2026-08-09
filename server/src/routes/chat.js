import { Router } from 'express';
import * as chatController from '../controllers/chatController.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateChatMessage } from '../middleware/validation.js';

const router = Router();

router.get('/conversations', authenticateToken, chatController.getConversations);
router.get('/unread/count', authenticateToken, chatController.getUnreadCount);
router.get('/messages/:conversationId', authenticateToken, chatController.getMessages);
router.post('/messages', authenticateToken, chatController.sendMessage);
router.put('/read/:conversationId', authenticateToken, chatController.markAsRead);

export default router;
