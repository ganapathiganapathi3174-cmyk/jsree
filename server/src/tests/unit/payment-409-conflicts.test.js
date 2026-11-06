import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// HTTP 409 CONFLICT REGRESSION SUITE (payment / top-up domain).
//
// Ground-truth tests for every conflict the deployed app can emit, driven
// through the REAL Express app (createApp) against an in-memory Supabase
// emulator. Pins the exact status + code the client sees for each scenario:
//   1. duplicate UTR cross-flow (registration + top-up)      -> 409
//   2. double-click verification (concurrent identical file)  -> 409 DUPLICATE_REQUEST
//   3. concurrent approval race (loser of the UTR reserve)    -> 409, zero side effects
//   4. repeated top-up submission (non-submittable status)    -> 400 (clear, not 500)
//   5. already-approved payment re-approve                    -> 400 (idempotent refusal)
//   6. already-credited wallet (repeat proof never credits)   -> 400 before any credit
//   7. legitimate new payment / unique UTR approval           -> 2xx success
// Plus the two misclassification fixes:
//   - POST /api/topups/direct  TOPUP_EXISTS  was 500, now 409
//   - PUT  /api/admin/payments/:id/approve  DUPLICATE_UTR was 500, now 409
// ─────────────────────────────────────────────────────────────────────────────

const { runOCR, runAdditionalOCRPasses, runAmountRecoveryOCR, runDeepAmountRecovery, walletCreditBatch, walletCredit, db } = vi.hoisted(() => {
  // Production-safe approval policy: auto-approve OFF, provider off.
  process.env.PAYMENT_AUTO_APPROVE = 'false';
  process.env.PAYMENT_PROVIDER_MODE = 'none';
  process.env.ADMIN_RECEIVER_NAME = process.env.ADMIN_RECEIVER_NAME || '';

  // In-memory Supabase/PostgREST emulator (filters, guarded UPDATEs,
  // unique(utr) -> 23505, PGRST116 on empty .single()).
  const store = {
    payments: [], users: [], topups: [],
    wallet_transactions: [], approved_utrs: [],
    notifications: [], referrals: [], audit_logs: [],
  };
  const state = { store, updates: {}, inserts: {}, results: {}, forcedErrors: {} };
  const rec = (bucket, table, payload) => {
    (state[bucket][table] = state[bucket][table] || []).push(payload);
  };

  const builder = (table) => {
    const p = {
      _op: 'select', _filters: [], _payload: null, _single: false, _limit: null,
      _isInsert: false,
      update: (payload) => { p._op = 'update'; p._payload = payload; return p; },
      insert: (payload) => { p._op = 'insert'; p._payload = payload; p._isInsert = true; rec('inserts', table, payload); return p; },
      delete: () => { p._op = 'delete'; return p; },
      select: () => p,
      eq: (col, val) => { p._filters.push(r => r[col] === val); return p; },
      neq: (col, val) => { p._filters.push(r => r[col] !== val); return p; },
      in: (col, vals) => { p._filters.push(r => Array.isArray(vals) && vals.includes(r[col])); return p; },
      lt: (col, val) => { p._filters.push(r => r[col] != null && r[col] < val); return p; },
      gt: (col, val) => { p._filters.push(r => r[col] != null && r[col] > val); return p; },
      or: () => p,
      order: () => p,
      limit: (n) => { p._limit = n; return p; },
      range: () => p,
      single: () => { p._single = true; return p; },
      maybeSingle: () => { p._single = true; return p; },
      then: (onRes, onRej) => {
        const respond = (out) => Promise.resolve(out).then(onRes, onRej);
        const forced = state.forcedErrors[table];
        if (forced && p._op === 'insert') return respond({ data: null, error: forced });

        const rows = store[table] || (store[table] = []);
        const matched = rows.filter(r => p._filters.every(f => f(r)));

        if (p._op === 'update') {
          rec('updates', table, p._payload);
          for (const row of matched) Object.assign(row, p._payload);
          if (p._single) {
            return respond(matched[0]
              ? { data: { ...matched[0] }, error: null }
              : { data: null, error: { code: 'PGRST116', message: 'No rows found' } });
          }
          return respond({ data: matched.map(r => ({ ...r })), error: null });
        }

        if (p._op === 'insert') {
          const payload = Array.isArray(p._payload) ? p._payload : [p._payload];
          const inserted = [];
          for (const item of payload) {
            if (table === 'approved_utrs' && store.approved_utrs.some(r => r.utr === item.utr)) {
              return respond({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
            }
            const row = { id: `${table}-${rows.length + 1}`, created_at: new Date().toISOString(), ...item };
            rows.push(row);
            inserted.push(row);
          }
          const data = p._single ? inserted[0] : inserted;
          return respond({ data: data || null, error: null });
        }

        if (p._op === 'delete') {
          for (const row of matched) rows.splice(rows.indexOf(row), 1);
          return respond({ data: null, error: null });
        }

        const projected = (p._limit ? matched.slice(0, p._limit) : matched).map(r => ({ ...r }));
        if (p._single) {
          return respond(projected[0]
            ? { data: projected[0], error: null }
            : { data: null, error: { code: 'PGRST116', message: 'No rows found' } });
        }
        return respond({ data: projected, error: null });
      },
      catch: (fn) => p.then(undefined, fn),
    };
    return p;
  };

  return {
    runOCR: vi.fn(),
    runAdditionalOCRPasses: vi.fn(),
    runAmountRecoveryOCR: vi.fn(),
    runDeepAmountRecovery: vi.fn(),
    walletCreditBatch: vi.fn(),
    walletCredit: vi.fn(),
    db: { state, from: (t) => builder(t) },
  };
});

vi.mock('../../db/supabase.js', () => {
  const client = {
    from: (t) => db.from(t),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://x/p.png' } }),
        download: async () => new Blob(['x']),
      }),
    },
  };
  return { supabase: client, supabaseAnon: {}, default: client };
});
vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runOCR, runAdditionalOCRPasses, runAmountRecoveryOCR, runDeepAmountRecovery };
});
vi.mock('../../services/walletService.js', () => ({
  default: { creditBatch: walletCreditBatch, credit: walletCredit },
}));
vi.mock('../../services/notificationService.js', () => ({
  default: { createNotification: vi.fn(async () => ({})) },
}));
vi.mock('../../services/auditService.js', () => ({ logAction: vi.fn(async () => ({})) }));
vi.mock('../../services/referralTierService.js', () => ({
  default: { checkAndUpgradeTier: vi.fn(async () => ({})) },
}));
vi.mock('../../services/referralService.js', () => ({
  checkAndDeactivateReferrer: vi.fn(async () => ({})),
}));

import { createApp } from '../../app.js';
import { __testClearInFlight } from '../../middleware/deduplicate.js';

const VALID_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
const future = () => new Date(Date.now() + 30 * 60000).toISOString();

let server;
let baseUrl;
const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

const tokenFor = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET);

function userRow(overrides = {}) {
  return {
    id: 'user-1', full_name: 'Test User', email: 'u1@example.com', mobile: '9000000001',
    role: 'user', status: 'active', referral_code: 'REF1', current_plan: 120,
    avatar_url: null, referred_by: null, ...overrides,
  };
}

function paymentRow(overrides = {}) {
  return {
    id: 'pay-1', user_id: 'user-1', selected_plan: 120, expected_amount: 120,
    status: 'pending', screenshot_url: null, screenshot_hash: null,
    verification_result: null, transaction_id: null,
    created_at: new Date().toISOString(), payment_request_created_at: new Date().toISOString(),
    expires_at: future(), ...overrides,
  };
}

function topupRow(overrides = {}) {
  return {
    id: 'top-1', sender_id: 'user-1', receiver_id: 'sp-1', amount: 120, plan: 120,
    status: 'created', screenshot_url: null, screenshot_hash: null,
    verification_result: null, created_at: new Date().toISOString(),
    expires_at: future(), ...overrides,
  };
}

function seed(...rows) {
  for (const [table, row] of rows) db.state.store[table].push(row);
}

function resetStore() {
  for (const key of Object.keys(db.state.store)) db.state.store[key] = [];
  db.state.updates = {};
  db.state.inserts = {};
  db.state.results = {};
  db.state.forcedErrors = {};
}

function form(fields, file) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append('screenshot', new Blob([file], { type: 'image/png' }), 'proof.png');
  return fd;
}

function authHeaders(userId) {
  return { Authorization: `Bearer ${tokenFor(userId)}` };
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'conflict-regression-secret';
  resetStore();
  server = createApp({ env: { CLIENT_URL: 'https://jsree.vercel.app' }, logger }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  __testClearInFlight();
  runOCR.mockResolvedValue({ text: '', confidence: 0 });
  runAdditionalOCRPasses.mockResolvedValue([]);
  runAmountRecoveryOCR.mockResolvedValue(null);
  runDeepAmountRecovery.mockResolvedValue(null);
  walletCreditBatch.mockResolvedValue([{ credited: true }, { credited: true }]);
  walletCredit.mockResolvedValue({ credited: true });
  seed(['users', userRow({ id: 'sp-1', full_name: 'Sponsor One', email: 'sp1@example.com', current_plan: 0, referral_code: 'SPON1' })]);
  seed(['users', userRow({ id: 'admin-1', full_name: 'Admin', email: 'a@example.com', role: 'admin', referral_code: 'ADM1' })]);
});

describe('scenario 7 — legitimate payment creation + unique-UTR approval', () => {
  it('POST /api/payments with no existing record -> 201 (happy path)', async () => {
    seed(['users', userRow()]);
    const res = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: { ...authHeaders('user-1'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: '120' }),
    });
    expect(res.status).toBe(201);
    expect(db.state.store.payments).toHaveLength(1);
    expect(db.state.store.payments[0].status).toBe('pending');
  });

  it('unique UTR approves via admin review; a second approval is refused with no double side effects', async () => {
    seed(['users', userRow({ status: 'pending', referred_by: 'sp-1' })]);
    seed(['payments', paymentRow({ id: 'pay-ok', status: 'manual_review', screenshot_url: 'https://x/p.png', verification_result: { utr: 'UTR-UNIQUE-1' } })]);

    const first = await fetch(`${baseUrl}/api/admin/payments/pay-ok/review`, {
      method: 'POST',
      headers: { ...authHeaders('admin-1'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', reason: 'manual check ok' }),
    });
    expect(first.status).toBe(200);
    expect(db.state.store.payments.find(p => p.id === 'pay-ok').status).toBe('approved');
    expect(db.state.store.approved_utrs.map(u => u.utr)).toEqual(['UTR-UNIQUE-1']);
    const activations = (db.state.updates.users || []).filter(u => u.status === 'active');
    expect(activations).toHaveLength(1);
    const bonusCalls = walletCredit.mock.calls.filter(c => c[3] === 'pay-ok');
    expect(bonusCalls).toHaveLength(1);

    const second = await fetch(`${baseUrl}/api/admin/payments/pay-ok/review`, {
      method: 'POST',
      headers: { ...authHeaders('admin-1'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', reason: 'double click' }),
    });
    expect(second.status).toBe(400);
    expect((await second.json()).code).toBe('PAYMENT_NOT_PENDING');

    // Exactly-once: activation + referral bonus + UTR row all still single.
    expect((db.state.updates.users || []).filter(u => u.status === 'active')).toHaveLength(1);
    expect(walletCredit.mock.calls.filter(c => c[3] === 'pay-ok')).toHaveLength(1);
    expect(db.state.store.approved_utrs).toHaveLength(1);
  });
});

describe('duplicate UTR cross-flow (registration side)', () => {
  it('scenario 1 — review approve with a UTR already approved elsewhere -> 409 DUPLICATE_UTR, no activation', async () => {
    seed(['users', userRow({ status: 'pending' })]);
    seed(['payments', paymentRow({ id: 'pay-dup', status: 'manual_review', screenshot_url: 'https://x/p.png', verification_result: { utr: 'UTR-SHARED' } })]);
    seed(['approved_utrs', { utr: 'UTR-SHARED', reference_type: 'payment', reference_id: 'pay-other' }]);

    const res = await fetch(`${baseUrl}/api/admin/payments/pay-dup/review`, {
      method: 'POST',
      headers: { ...authHeaders('admin-1'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', reason: 'dup check' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('DUPLICATE_UTR');
    expect(db.state.store.payments.find(p => p.id === 'pay-dup').status).toBe('manual_review');
    expect(db.state.updates.users || []).toHaveLength(0);
    expect(walletCredit).not.toHaveBeenCalled();
  });

  it('FIX — PUT /api/admin/payments/:id/approve with a shared UTR -> 409 (was 500)', async () => {
    seed(['users', userRow({ status: 'pending' })]);
    seed(['payments', paymentRow({ id: 'pay-dup', status: 'manual_review', screenshot_url: 'https://x/p.png', verification_result: { utr: 'UTR-SHARED' } })]);
    seed(['approved_utrs', { utr: 'UTR-SHARED', reference_type: 'payment', reference_id: 'pay-other' }]);

    const res = await fetch(`${baseUrl}/api/admin/payments/pay-dup/approve`, {
      method: 'PUT',
      headers: { ...authHeaders('admin-1'), 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('DUPLICATE_UTR');
    expect(db.state.store.payments.find(p => p.id === 'pay-dup').status).toBe('manual_review');
    expect(db.state.updates.users || []).toHaveLength(0);
  });

  it('scenario 3 — approval race loser (UTR reserved for THIS payment pre-flip) -> 409 with zero side effects', async () => {
    seed(['users', userRow({ status: 'pending' })]);
    seed(['payments', paymentRow({ id: 'pay-race', status: 'manual_review', screenshot_url: 'https://x/p.png', verification_result: { utr: 'UTR-RACE' } })]);
    // Winner of the concurrent race reserved the UTR but has not flipped status yet.
    seed(['approved_utrs', { utr: 'UTR-RACE', reference_type: 'payment', reference_id: 'pay-race' }]);

    const res = await fetch(`${baseUrl}/api/admin/payments/pay-race/review`, {
      method: 'POST',
      headers: { ...authHeaders('admin-1'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', reason: 'concurrent approve' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('DUPLICATE_UTR');
    expect(db.state.store.payments.find(p => p.id === 'pay-race').status).toBe('manual_review');
    expect(db.state.updates.users || []).toHaveLength(0);
    expect(walletCredit).not.toHaveBeenCalled();
  });
});

describe('already-approved payment (scenario 5)', () => {
  it('review approve on an already-approved payment -> 400 PAYMENT_NOT_PENDING (clear refusal, not 409/500)', async () => {
    seed(['users', userRow()]);
    seed(['payments', paymentRow({ id: 'pay-done', status: 'approved' })]);

    const res = await fetch(`${baseUrl}/api/admin/payments/pay-done/review`, {
      method: 'POST',
      headers: { ...authHeaders('admin-1'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', reason: 're-approve attempt' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('PAYMENT_NOT_PENDING');
  });
});

describe('registration payment creation conflicts', () => {
  it('POST /api/payments with an existing pending payment -> 409 PENDING_EXISTS', async () => {
    seed(['users', userRow()]);
    seed(['payments', paymentRow({ id: 'pay-pending' })]);

    const res = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: { ...authHeaders('user-1'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: '120' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('PENDING_EXISTS');
  });

  it('POST /api/payments with an existing approved payment -> 409 PAYMENT_EXISTS', async () => {
    seed(['users', userRow()]);
    seed(['payments', paymentRow({ id: 'pay-approved', status: 'approved' })]);

    const res = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: { ...authHeaders('user-1'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: '120' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('PAYMENT_EXISTS');
  });
});

describe('double-click proof upload (scenario 2)', () => {
  it('two concurrent identical screenshot uploads: one proceeds, the second gets 409 DUPLICATE_REQUEST', async () => {
    seed(['users', userRow()]);
    seed(['payments', paymentRow({ id: 'pay-1' })]);

    let releaseOcr;
    runOCR.mockImplementationOnce(() => new Promise((resolve) => { releaseOcr = resolve; }));

    const first = fetch(`${baseUrl}/api/payments/pay-1/screenshot`, {
      method: 'POST',
      headers: authHeaders('user-1'),
      body: form({}, VALID_IMAGE),
    });

    // First request is mid-verification (OCR gated) — its dedup key is live.
    await vi.waitFor(() => { expect(runOCR).toHaveBeenCalled(); });

    const second = await fetch(`${baseUrl}/api/payments/pay-1/screenshot`, {
      method: 'POST',
      headers: authHeaders('user-1'),
      body: form({}, VALID_IMAGE),
    });
    expect(second.status).toBe(409);
    expect((await second.json()).code).toBe('DUPLICATE_REQUEST');

    releaseOcr({ text: '', confidence: 0 });
    const firstRes = await first;
    expect(firstRes.status).toBe(200);
    expect((await firstRes.json()).success).toBe(true);
  });

  it('screenshot already backing an APPROVED payment -> 409 DUPLICATE_SCREENSHOT', async () => {
    const hash = crypto.createHash('sha256').update(VALID_IMAGE).digest('hex');
    seed(['users', userRow()]);
    seed(['payments', paymentRow({ id: 'pay-other', user_id: 'user-9', status: 'approved', screenshot_hash: hash })]);
    seed(['payments', paymentRow({ id: 'pay-1' })]);

    const res = await fetch(`${baseUrl}/api/payments/pay-1/screenshot`, {
      method: 'POST',
      headers: authHeaders('user-1'),
      body: form({}, VALID_IMAGE),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('DUPLICATE_SCREENSHOT');
    expect(walletCredit).not.toHaveBeenCalled();
  });
});

describe('top-up conflicts', () => {
  it('FIX — POST /api/topups/direct with a legacy non-submittable pending top-up -> 409 TOPUP_EXISTS (was 500)', async () => {
    seed(['users', userRow()]);
    // Legacy status: visible to createTopup's inner guard, invisible to the
    // outer SUBMITTABLE check — the exact race/legacy window that used to 500.
    seed(['topups', topupRow({ id: 'top-legacy', status: 'proof_submitted' })]);

    const res = await fetch(`${baseUrl}/api/topups/direct`, {
      method: 'POST',
      headers: authHeaders('user-1'),
      body: form({ amount: '120', receiverId: 'sp-1' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('TOPUP_EXISTS');
  });

  it('scenario 4/6 — proof resubmission on a completed top-up -> 400 TOPUP_NOT_SUBMITTABLE before any credit', async () => {
    seed(['users', userRow()]);
    seed(['topups', topupRow({ id: 'top-done', status: 'completed', screenshot_url: 'https://x/t.png' })]);

    const res = await fetch(`${baseUrl}/api/topups/top-done/proof`, {
      method: 'POST',
      headers: authHeaders('user-1'),
      body: form({}, VALID_IMAGE),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('TOPUP_NOT_SUBMITTABLE');
    expect(walletCreditBatch).not.toHaveBeenCalled();
  });

  it('screenshot already backing a COMPLETED top-up -> 409 DUPLICATE_SCREENSHOT', async () => {
    const hash = crypto.createHash('sha256').update(VALID_IMAGE).digest('hex');
    seed(['users', userRow()]);
    seed(['topups', topupRow({ id: 'top-a', status: 'completed', screenshot_hash: hash })]);
    seed(['topups', topupRow({ id: 'top-b', status: 'created' })]);

    const res = await fetch(`${baseUrl}/api/topups/top-b/proof`, {
      method: 'POST',
      headers: authHeaders('user-1'),
      body: form({}, VALID_IMAGE),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('DUPLICATE_SCREENSHOT');
  });

  it('scenario 1 (top-up side) — admin review approve with a UTR owned by a payment -> 409 DUPLICATE_UTR, no credit', async () => {
    seed(['users', userRow()]);
    seed(['topups', topupRow({
      id: 'top-dup', status: 'manual_review', screenshot_url: 'https://x/t.png',
      verification_result: {
        utr: 'UTR-TOP-DUP',
        checks: { amount: { passed: true }, receiverUpi: { passed: true }, transactionDate: { passed: true }, utr: { passed: true } },
      },
    })]);
    seed(['approved_utrs', { utr: 'UTR-TOP-DUP', reference_type: 'payment', reference_id: 'pay-owner' }]);

    const res = await fetch(`${baseUrl}/api/admin/topups/top-dup/review`, {
      method: 'PUT',
      headers: { ...authHeaders('admin-1'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true, reason: 'cross-flow dup' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('DUPLICATE_UTR');
    expect(db.state.store.topups.find(t => t.id === 'top-dup').status).toBe('manual_review');
    expect(walletCreditBatch).not.toHaveBeenCalled();
  });
});

describe('payment initialization across amounts (120 / 500 / 1000)', () => {
  it('120 payment initializes -> 201 with expected_amount 120', async () => {
    seed(['users', userRow()]);
    const res = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: { ...authHeaders('user-1'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: '120' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.expected_amount).toBe(120);
    expect(body.data.selected_plan).toBe(120);
    expect(body.data.status).toBe('pending');
  });

  it('500 payment initializes -> 201 with expected_amount 500', async () => {
    seed(['users', userRow()]);
    const res = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: { ...authHeaders('user-1'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: '500' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.expected_amount).toBe(500);
    expect(body.data.selected_plan).toBe(500);
  });

  it('1000 payment initializes -> 201 with expected_amount 1000', async () => {
    seed(['users', userRow()]);
    const res = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: { ...authHeaders('user-1'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: '1000' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.expected_amount).toBe(1000);
    expect(body.data.selected_plan).toBe(1000);
  });

  it('ROOT CAUSE � a stale EXPIRED pending row no longer blocks any new payment (was 409 for every amount)', async () => {
    seed(['users', userRow()]);
    seed(['payments', paymentRow({
      id: 'pay-stale', status: 'pending',
      expires_at: new Date(Date.now() - 60000).toISOString(),
    })]);

    const res = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: { ...authHeaders('user-1'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: '500' }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).data.expected_amount).toBe(500);

    const stale = db.state.store.payments.find(p => p.id === 'pay-stale');
    expect(stale.status).toBe('rejected');
    expect(stale.rejection_reason).toBe('PAYMENT_EXPIRED');
    const live = db.state.store.payments.filter(p => ['pending', 'manual_review'].includes(p.status));
    expect(live).toHaveLength(1);
    expect(live[0].id).not.toBe('pay-stale');
  });

  it('ROOT CAUSE � a stale EXPIRED manual_review row no longer blocks any new payment', async () => {
    seed(['users', userRow()]);
    seed(['payments', paymentRow({
      id: 'pay-stale-mr', status: 'manual_review',
      expires_at: new Date(Date.now() - 60000).toISOString(),
    })]);

    const res = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: { ...authHeaders('user-1'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: '1000' }),
    });
    expect(res.status).toBe(201);
    const stale = db.state.store.payments.find(p => p.id === 'pay-stale-mr');
    expect(stale.status).toBe('rejected');
    expect(stale.rejection_reason).toBe('PAYMENT_EXPIRED');
  });

  it('duplicate request against a LIVE payment -> 409 PENDING_EXISTS, no second record created', async () => {
    seed(['users', userRow()]);
    const first = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: { ...authHeaders('user-1'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: '120' }),
    });
    expect(first.status).toBe(201);

    const retry = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: { ...authHeaders('user-1'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: '500' }),
    });
    expect(retry.status).toBe(409);
    expect((await retry.json()).code).toBe('PENDING_EXISTS');
    expect(db.state.store.payments).toHaveLength(1);
  });

  it('concurrent creates for the same user -> exactly one 201, one 409, exactly one live row', async () => {
    seed(['users', userRow()]);
    const headers = { ...authHeaders('user-1'), 'Content-Type': 'application/json' };
    const [a, b] = await Promise.all([
      fetch(`${baseUrl}/api/payments`, { method: 'POST', headers, body: JSON.stringify({ plan: '120' }) }),
      fetch(`${baseUrl}/api/payments`, { method: 'POST', headers, body: JSON.stringify({ plan: '120' }) }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const live = db.state.store.payments.filter(p => ['pending', 'manual_review'].includes(p.status));
    expect(live).toHaveLength(1);
  });

  it('invalid payment payload -> 400 validation error (not 409)', async () => {
    seed(['users', userRow()]);
    const res = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: { ...authHeaders('user-1'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: '999' }),
    });
    expect(res.status).toBe(400);
    expect(db.state.store.payments).toHaveLength(0);
  });

  it('approved payment still blocks re-purchase -> 409 PAYMENT_EXISTS (unchanged policy)', async () => {
    seed(['users', userRow()]);
    seed(['payments', paymentRow({ id: 'pay-ap', status: 'approved' })]);
    const res = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: { ...authHeaders('user-1'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: '500' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('PAYMENT_EXISTS');
  });
});
