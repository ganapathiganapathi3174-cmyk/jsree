import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as adminController from '../../controllers/adminController.js';
import * as chatService from '../../services/chatService.js';

vi.mock('../../services/chatService.js', () => ({
  getConversations: vi.fn(),
  getMessages: vi.fn(),
  markAsRead: vi.fn(),
  sendMessage: vi.fn(),
}));

const { getMessages, markAsRead, sendMessage } = chatService;

function mockRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('adminController chat routes (admin UI uses these)', () => {
  it('getChatMessages passes the admin ROLE so admins can open conversations', async () => {
    getMessages.mockResolvedValue([{ id: 'm1' }]);
    const req = { params: { conversationId: 'conv-a' }, user: { id: 'admin-1', role: 'admin' } };
    const res = mockRes();
    await adminController.getChatMessages(req, res);
    expect(getMessages).toHaveBeenCalledWith('conv-a', 'admin-1', 'admin');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ id: 'm1' }] });
  });

  it('markChatRead passes the admin role', async () => {
    markAsRead.mockResolvedValue({ message: 'Messages marked as read' });
    const req = { params: { conversationId: 'conv-a' }, user: { id: 'admin-1', role: 'admin' } };
    const res = mockRes();
    await adminController.markChatRead(req, res);
    expect(markAsRead).toHaveBeenCalledWith('conv-a', 'admin-1', 'admin');
  });

  it('sendAdminMessage sends with the admin role', async () => {
    sendMessage.mockResolvedValue({ id: 'm1' });
    const req = { body: { conversation_id: 'conv-a', message: 'Hello' }, user: { id: 'admin-1', role: 'admin' } };
    const res = mockRes();
    await adminController.sendAdminMessage(req, res);
    expect(sendMessage).toHaveBeenCalledWith('conv-a', 'admin-1', 'admin', 'Hello');
  });

  it('getChats fetches the admin conversation list', async () => {
    chatService.getConversations.mockResolvedValue([{ id: 'conv-a', unreadCount: 0 }]);
    const req = { user: { id: 'admin-1', role: 'admin' } };
    const res = mockRes();
    await adminController.getChats(req, res);
    expect(chatService.getConversations).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ id: 'conv-a', unreadCount: 0 }] });
  });
});