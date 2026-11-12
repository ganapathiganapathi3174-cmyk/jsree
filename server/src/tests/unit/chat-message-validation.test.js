import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { generateToken } from '../../utils/helpers.js';

// ─────────────────────────────────────────────────────────────
// Chat message validation was exported (validateChatMessage) but never
// wired into any route, so messages up to the 10MB JSON body limit were
// accepted. The route now enforces the declared contract: non-empty,
// max 2000 characters (sanitized/trimmed by express-validator).
// ─────────────────────────────────────────────────────────────

const { supabaseMock, chatServiceMock } = vi.hoisted(() => {
  process.env.JWT_SECRET = 'isolated-chat-validation-test-secret';
  return {
    supabaseMock: { from: vi.fn() },
    chatServiceMock: {
      getConversations: vi.fn(),
      getOrCreateConversation: vi.fn(),
      getMessages: vi.fn(),
      sendMessage: vi.fn(),
      markAsRead: vi.fn(),
      getUnreadCount: vi.fn(),
    },
  };
});

vi.mock('../../db/supabase.js', () => ({ supabase: supabaseMock, supabaseAnon: {}, default: supabaseMock }));
vi.mock('../../services/chatService.js', () => chatServiceMock);

import chatRouter from '../../routes/chat.js';

function authChain() {
  const chain = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve({
    data: {
      id: 'user-1', full_name: 'Test User', email: 'user@test.local', mobile: '1',
      role: 'user', status: 'active', referral_code: 'USR1',
      current_plan: '120', avatar_url: null,
    },
    error: null,
  }));
  return chain;
}

supabaseMock.from.mockImplementation((table) => {
  if (table === 'users') return authChain();
  throw new Error(`unexpected table: ${table}`);
});

let server;

afterEach(async () => {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  server = null;
  vi.clearAllMocks();
});

async function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/chat', chatRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function sendMessage(base, payload) {
  const token = generateToken({ userId: 'user-1' });
  const response = await fetch(`${base}/chat/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
}

describe('POST /api/chat/messages — validation', () => {
  it('rejects a message over 2000 characters without calling the service', async () => {
    chatServiceMock.getOrCreateConversation.mockResolvedValue('conv-1');
    const base = await startApp();
    const { status, body } = await sendMessage(base, { message: 'x'.repeat(2001) });

    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(chatServiceMock.sendMessage).not.toHaveBeenCalled();
    expect(chatServiceMock.getOrCreateConversation).not.toHaveBeenCalled();
  });

  it('rejects a missing/empty message', async () => {
    const base = await startApp();
    const { status, body } = await sendMessage(base, {});

    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(chatServiceMock.sendMessage).not.toHaveBeenCalled();
  });

  it('accepts a 2000-character message and delivers it to the service', async () => {
    chatServiceMock.getOrCreateConversation.mockResolvedValue('conv-1');
    chatServiceMock.sendMessage.mockResolvedValue({
      id: 'msg-1', conversation_id: 'conv-1', message: 'x'.repeat(2000),
      sender_role: 'user', created_at: '2026-11-09T00:00:00.000Z',
    });
    const base = await startApp();
    const { status, body } = await sendMessage(base, { message: 'x'.repeat(2000) });

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(chatServiceMock.sendMessage).toHaveBeenCalledWith('conv-1', 'user-1', 'user', 'x'.repeat(2000));
  });

  it('trims surrounding whitespace before delivery', async () => {
    chatServiceMock.getOrCreateConversation.mockResolvedValue('conv-1');
    chatServiceMock.sendMessage.mockResolvedValue({
      id: 'msg-2', conversation_id: 'conv-1', message: 'hello',
      sender_role: 'user', created_at: '2026-11-09T00:00:00.000Z',
    });
    const base = await startApp();
    const { status } = await sendMessage(base, { message: '  hello  ' });

    expect(status).toBe(201);
    expect(chatServiceMock.sendMessage).toHaveBeenCalledWith('conv-1', 'user-1', 'user', 'hello');
  });
});
