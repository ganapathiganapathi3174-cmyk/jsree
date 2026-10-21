import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';

// ─────────────────────────────────────────────────────────────
// Regression: GET /api/receipts/:paymentId and /:paymentId/html performed
// no ownership check — any authenticated active user could read any other
// user's receipt (payer name/email/mobile + amount + UTR), and the HTML
// variant interpolated those values unescaped (stored XSS).
// Both endpoints must now be owner-or-admin (mirrors
// paymentService.requirePaymentOwner) and the HTML renderer must escape
// every untrusted field. All database access is mocked — no shared DB.
// ─────────────────────────────────────────────────────────────

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));
vi.mock('../../db/supabase.js', () => ({
  supabase: supabaseMock,
  supabaseAnon: {},
  default: supabaseMock,
}));

const { verifyTokenMock } = vi.hoisted(() => ({ verifyTokenMock: vi.fn() }));
vi.mock('../../utils/helpers.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, verifyToken: verifyTokenMock };
});

import receiptsRouter from '../../routes/receipts.js';
import paymentReceiptService from '../../services/paymentReceiptService.js';
import { escapeHtml } from '../../utils/helpers.js';

const OWNER = { id: 'user-a', role: 'user', status: 'active', full_name: 'Alice Owner', email: 'alice@test.com' };
const ATTACKER = { id: 'user-b', role: 'user', status: 'active', full_name: 'Bob', email: 'bob@test.com' };
const ADMIN = { id: 'admin-1', role: 'admin', status: 'active', full_name: 'Admin', email: 'admin@test.com' };

const PAYMENT = {
  id: 'pay-1',
  user_id: OWNER.id,
  expected_amount: '120.50',
  transaction_id: 'UTR1234567890',
  status: 'approved',
  approved_at: '2026-08-16T10:00:00Z',
  created_at: '2026-08-16T09:00:00Z',
  users: { id: OWNER.id, full_name: OWNER.full_name, email: OWNER.email, mobile: '918000000001' }
};

function dbChain() {
  const chain = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.range = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve({ data: null, error: null }));
  return chain;
}

function mockUserLookup(user) {
  const chain = dbChain();
  chain.single = vi.fn(() => Promise.resolve(user ? { data: user, error: null } : { data: null, error: { message: 'not found' } }));
  return chain;
}

function mockPaymentSingle(result) {
  const chain = dbChain();
  chain.single = vi.fn(() => Promise.resolve(result));
  return chain;
}

function mockPaymentList(result) {
  const chain = dbChain();
  chain.range = vi.fn(() => Promise.resolve(result));
  return chain;
}

function mockTopups(result = { data: [], error: null }) {
  const chain = dbChain();
  chain.limit = vi.fn(() => Promise.resolve(result));
  return chain;
}

let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/receipts', receiptsRouter);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: every token is valid and maps to its user row.
  verifyTokenMock.mockImplementation((token) => {
    if (token === 'tok-owner') return { userId: OWNER.id };
    if (token === 'tok-attacker') return { userId: ATTACKER.id };
    if (token === 'tok-admin') return { userId: ADMIN.id };
    return null;
  });
  const users = { [OWNER.id]: OWNER, [ATTACKER.id]: ATTACKER, [ADMIN.id]: ADMIN };
  supabaseMock.from.mockImplementation((table) => {
    if (table === 'users') {
      // Called by authenticateToken with the decoded userId; also embedded
      // as a join alias inside payments selects, but never queried as a table
      // from the receipt service itself.
      return {
        select: vi.fn(() => ({
          eq: vi.fn((_col, id) => ({
            single: vi.fn(() => Promise.resolve(users[id] ? { data: users[id], error: null } : { data: null, error: { message: 'not found' } }))
          }))
        }))
      };
    }
    if (table === 'payments') return mockPaymentSingle({ data: null, error: { message: 'not found' } });
    if (table === 'topups') return mockTopups();
    throw new Error('unexpected table: ' + table);
  });
});

function auth(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

describe('receipt IDOR — server-side ownership enforcement', () => {
  it('rejects unauthenticated requests with 401 TOKEN_REQUIRED', async () => {
    const res = await fetch(`${baseUrl}/api/receipts/pay-1`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('TOKEN_REQUIRED');
  });

  it('rejects invalid tokens with 401 TOKEN_INVALID', async () => {
    const res = await fetch(`${baseUrl}/api/receipts/pay-1`, { headers: auth('tok-bad') });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('TOKEN_INVALID');
  });

  it('serves the owner their own receipt', async () => {
    supabaseMock.from.mockImplementation((table) => {
      if (table === 'users') return mockUserLookup(OWNER);
      if (table === 'payments') return mockPaymentSingle({ data: PAYMENT, error: null });
      if (table === 'topups') return mockTopups();
    });
    const res = await fetch(`${baseUrl}/api/receipts/pay-1`, { headers: auth('tok-owner') });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      paymentId: 'pay-1',
      userName: OWNER.full_name,
      userEmail: OWNER.email,
      amount: 120.5,
      utrNumber: PAYMENT.transaction_id,
      status: 'approved'
    });
  });

  it('rejects a cross-user request with 403 and leaks no receipt data', async () => {
    supabaseMock.from.mockImplementation((table) => {
      if (table === 'users') return mockUserLookup(ATTACKER);
      if (table === 'payments') return mockPaymentSingle({ data: PAYMENT, error: null });
      if (table === 'topups') return mockTopups();
    });
    const res = await fetch(`${baseUrl}/api/receipts/pay-1`, { headers: auth('tok-attacker') });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(OWNER.full_name);
    expect(raw).not.toContain(OWNER.email);
    expect(raw).not.toContain(PAYMENT.transaction_id);
  });

  it('ignores a client-supplied user_id query parameter (forged owner)', async () => {
    supabaseMock.from.mockImplementation((table) => {
      if (table === 'users') return mockUserLookup(ATTACKER);
      if (table === 'payments') return mockPaymentSingle({ data: PAYMENT, error: null });
      if (table === 'topups') return mockTopups();
    });
    const res = await fetch(`${baseUrl}/api/receipts/pay-1?user_id=${OWNER.id}`, { headers: auth('tok-attacker') });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('UNAUTHORIZED');
    expect(JSON.stringify(body)).not.toContain(OWNER.email);
  });

  it('permits an admin requester (explicitly allowed by the authorization policy)', async () => {
    supabaseMock.from.mockImplementation((table) => {
      if (table === 'users') return mockUserLookup(ADMIN);
      if (table === 'payments') return mockPaymentSingle({ data: PAYMENT, error: null });
      if (table === 'topups') return mockTopups();
    });
    const res = await fetch(`${baseUrl}/api/receipts/pay-1`, { headers: auth('tok-admin') });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paymentId).toBe('pay-1');
  });

  it('returns 404 PAYMENT_NOT_FOUND for a missing payment', async () => {
    supabaseMock.from.mockImplementation((table) => {
      if (table === 'users') return mockUserLookup(OWNER);
      if (table === 'payments') return mockPaymentSingle({ data: null, error: { message: 'not found' } });
      if (table === 'topups') return mockTopups();
    });
    const res = await fetch(`${baseUrl}/api/receipts/pay-missing`, { headers: auth('tok-owner') });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('PAYMENT_NOT_FOUND');
  });

  it('applies the same ownership gate to the HTML endpoint', async () => {
    supabaseMock.from.mockImplementation((table) => {
      if (table === 'users') return mockUserLookup(ATTACKER);
      if (table === 'payments') return mockPaymentSingle({ data: PAYMENT, error: null });
      if (table === 'topups') return mockTopups();
    });
    const res = await fetch(`${baseUrl}/api/receipts/pay-1/html`, { headers: auth('tok-attacker') });
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toMatch(/json/);
    const raw = await res.text();
    expect(raw).not.toContain('<html');
    expect(raw).not.toContain(OWNER.email);
  });

  it('my-receipts stays scoped to the caller and includes joined payer fields', async () => {
    supabaseMock.from.mockImplementation((table) => {
      if (table === 'users') return mockUserLookup(OWNER);
      if (table === 'payments') return mockPaymentList({ data: [PAYMENT], error: null, count: 1 });
      if (table === 'topups') return mockTopups();
    });
    const res = await fetch(`${baseUrl}/api/receipts/my-receipts`, { headers: auth('tok-owner') });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.receipts).toHaveLength(1);
    expect(body.receipts[0]).toMatchObject({ userName: OWNER.full_name, userEmail: OWNER.email, amount: 120.5 });
    // The payments query must be scoped by the server-side owner id.
    const paymentsCalls = supabaseMock.from.mock.results
      .map((r) => r.value)
      .filter((c) => c && typeof c.eq === 'function' && c.eq.mock.calls.length);
    const scoped = paymentsCalls.some((c) =>
      c.eq.mock.calls.some(([col, val]) => col === 'user_id' && val === OWNER.id));
    expect(scoped).toBe(true);
  });
});

describe('stored XSS — receipt HTML escapes every untrusted field', () => {
  const MAL_NAME = '<script>alert("name")</script>';
  const MAL_EMAIL = '"><img src=x onerror=alert(2)>@evil.test';
  const MAL_UTR = "UTR'<svg/onload=alert(3)>";
  const MAL_PAYMENT = {
    ...PAYMENT,
    transaction_id: MAL_UTR,
    users: { id: OWNER.id, full_name: MAL_NAME, email: MAL_EMAIL, mobile: '918000000001' }
  };

  it('serves the owner an HTML receipt with neutralised payloads and intact formatting', async () => {
    supabaseMock.from.mockImplementation((table) => {
      if (table === 'users') return mockUserLookup(OWNER);
      if (table === 'payments') return mockPaymentSingle({ data: MAL_PAYMENT, error: null });
      if (table === 'topups') return mockTopups();
    });
    const res = await fetch(`${baseUrl}/api/receipts/pay-1/html`, { headers: auth('tok-owner') });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();

    // No live markup from the injected payloads.
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<svg/onload');
    // Escaped forms are present instead.
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
    expect(html).toContain('&#39;&lt;svg/onload=alert(3)&gt;');
    // Legitimate formatting preserved.
    expect(html).toContain('₹120.5');
    expect(html).toContain('>APPROVED<');
    expect(html).toContain('ReferralHub');
  });

  it('service-level generateHTML escapes all five meta characters', async () => {
    supabaseMock.from.mockImplementation((table) => {
      if (table === 'users') return mockUserLookup(OWNER);
      if (table === 'payments') return mockPaymentSingle({ data: MAL_PAYMENT, error: null });
      if (table === 'topups') return mockTopups();
    });
    const receipt = await paymentReceiptService.generateReceipt('pay-1', OWNER);
    const html = paymentReceiptService.generateHTML(receipt);
    expect(html).not.toMatch(/<script|<img |<svg/);
    expect(html).toContain(escapeHtml(MAL_NAME));
    expect(html).toContain(escapeHtml(MAL_UTR));
  });

  it('escapeHtml encodes &, <, >, " and \' in a single pass (no double-encoding)', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(120.5)).toBe('120.5');
  });
});
