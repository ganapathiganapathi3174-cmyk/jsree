import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as chatService from '../../services/chatService.js';

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));
vi.mock('../../db/supabase.js', () => ({ supabase: supabaseMock }));

const USER_A = 'user-a';
const USER_B = 'user-b';
const ADMIN = 'admin-1';
const CONV_A = 'conv-a';
const CONV_UNKNOWN = 'conv-missing';

// In-memory "DB": conversations by id, messages appended in call order.
const dbState = {
  conversations: { [CONV_A]: { id: CONV_A, user_id: USER_A } },
  messages: [],
};
let msgId = 0;

// Minimal chainable supabase mock. Every builder method records the call and
// returns the same thenable, which resolves to { data, error } for whatever
// query shape chatService issued.
function makeChain(table) {
  const state = { calls: [] };
  const thenable = {};
  for (const m of ['select', 'eq', 'neq', 'is', 'order', 'limit', 'in', 'insert', 'update', 'single']) {
    thenable[m] = (...args) => { state.calls.push([m, args]); return thenable; };
  }
  thenable.then = (resolve) => {
    const r = compute(table, state.calls);
    return Promise.resolve(r).then(resolve);
  };
  return thenable;
}

function compute(table, calls) {
  const arg = (name) => {
    for (let i = calls.length - 1; i >= 0; i--) if (calls[i][0] === name) return calls[i][1];
    return undefined;
  };
  const eqValue = (name) => { const a = arg(name); return Array.isArray(a) ? a[1] : undefined; };
  const allCalls = (name) => calls.filter(([m]) => m === name).map(([, a]) => a);

  if (table === 'conversations') {
    const insert = allCalls('insert');
    if (insert.length > 0) {
      const row = { id: `conv-${++msgId}`, ...insert[0][0] };
      dbState.conversations[row.id] = row;
      return { data: row, error: null };
    }
    const upd = allCalls('update');
    if (upd.length > 0) return { data: null, error: null };
    // lookup by id
    const conv = dbState.conversations[eqValue('eq')];
    if (!conv) return { data: null, error: { code: 'PGRST116' } };
    return { data: conv, error: null };
  }

  if (table === 'messages') {
    const insert = allCalls('insert');
    if (insert.length > 0) {
      const payload = insert[0][0];
      const row = { id: `msg-${++msgId}`, created_at: '2026-08-20T00:00:00.000Z', ...payload };
      dbState.messages.push(row);
      return { data: row, error: null };
    }
    const upd = allCalls('update');
    if (upd.length > 0) return { data: null, error: null };
    const convId = eqValue('eq');
    return { data: dbState.messages.filter(m => m.conversation_id === convId), error: null };
  }

  return { data: null, error: null };
}

function resetDb() {
  dbState.conversations = { [CONV_A]: { id: CONV_A, user_id: USER_A } };
  dbState.messages = [];
  msgId = 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDb();
  supabaseMock.from.mockImplementation((table) => makeChain(table));
});

describe('chatService access control (conversation ownership)', () => {
  it('conversation owner can read its messages', async () => {
    const msgs = await chatService.getMessages(CONV_A, USER_A, 'user');
    expect(msgs).toEqual([]);
  });

  it('admin can read any conversation (the fixed bug: role was undefined)', async () => {
    const msgs = await chatService.getMessages(CONV_A, ADMIN, 'admin');
    expect(msgs).toEqual([]);
  });

  it('another user CANNOT read a foreign conversation', async () => {
    await expect(chatService.getMessages(CONV_A, USER_B, 'user')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('unknown conversation is rejected', async () => {
    await expect(chatService.getMessages(CONV_UNKNOWN, USER_A, 'user')).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
  });

  it('conversation owner can send a message', async () => {
    const msg = await chatService.sendMessage(CONV_A, USER_A, 'user', 'Hello admin');
    expect(msg.message).toBe('Hello admin');
    expect(msg.conversation_id).toBe(CONV_A);
    expect(msg.sender_role).toBe('user');
  });

  it('a user CANNOT send into another user conversation (no cross-user injection)', async () => {
    await expect(chatService.sendMessage(CONV_A, USER_B, 'user', 'sneak')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('admin can send/read any conversation', async () => {
    const msg = await chatService.sendMessage(CONV_A, ADMIN, 'admin', 'Hello user');
    expect(msg.sender_role).toBe('admin');
    const msgs = await chatService.getMessages(CONV_A, ADMIN, 'admin');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].message).toBe('Hello user');
  });

  it('user can mark own conversation read, foreign read is blocked', async () => {
    await expect(chatService.markAsRead(CONV_A, USER_A, 'user')).resolves.toBeTruthy();
    await expect(chatService.markAsRead(CONV_A, USER_B, 'user')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(chatService.markAsRead(CONV_A, ADMIN, 'admin')).resolves.toBeTruthy();
  });

  it('messages persist across calls (refresh/reconnect does not lose history)', async () => {
    await chatService.sendMessage(CONV_A, USER_A, 'user', 'Hello admin');
    await chatService.sendMessage(CONV_A, ADMIN, 'admin', 'Hello user');
    const afterRefresh = await chatService.getMessages(CONV_A, USER_A, 'user');
    expect(afterRefresh.map(m => m.message)).toEqual(['Hello admin', 'Hello user']);
  });
});