import * as chatService from '../services/chatService.js';

export async function getConversations(req, res) {
  try {
    if (req.user.role === 'admin') {
      const conversations = await chatService.getConversations();
      res.json({ success: true, data: conversations });
    } else {
      const conversationId = await chatService.getOrCreateConversation(req.user.id);
      res.json({ success: true, data: { id: conversationId } });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch conversations', code: error.code || 'FETCH_FAILED' });
  }
}

export async function getMessages(req, res) {
  try {
    const messages = await chatService.getMessages(req.params.conversationId, req.user.id, req.user.role);
    res.json({ success: true, data: messages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch messages', code: error.code || 'FETCH_FAILED' });
  }
}

export async function sendMessage(req, res) {
  try {
    let conversationId = req.params.conversationId;
    if (!conversationId && req.body.conversation_id) conversationId = req.body.conversation_id;
    if (!conversationId) {
      conversationId = await chatService.getOrCreateConversation(req.user.id);
    }
    const { message } = req.body;
    if (!message || message.trim().length === 0) return res.status(400).json({ success: false, message: 'Message cannot be empty', code: 'VALIDATION_ERROR' });

    const msg = await chatService.sendMessage(conversationId, req.user.id, req.user.role, message);
    res.status(201).json({ success: true, data: msg });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to send message', code: error.code || 'SEND_FAILED' });
  }
}

export async function markAsRead(req, res) {
  try {
    const result = await chatService.markAsRead(req.params.conversationId, req.user.id);
    res.json({ success: true, message: result.message });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to mark as read', code: error.code || 'MARK_READ_FAILED' });
  }
}

export async function getUnreadCount(req, res) {
  try {
    const result = await chatService.getUnreadCount(req.user.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to get unread count', code: error.code || 'COUNT_FAILED' });
  }
}
