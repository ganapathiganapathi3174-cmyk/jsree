import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses, walletCreditBatch } = vi.hoisted(() => {
  if (!process.env.ADMIN_RECEIVER_NAME) {
    process.env.ADMIN_RECEIVER_NAME = 'Jayaraj';
  }
  return {
    runOCR: vi.fn(),
    runAmountRecoveryOCR: vi.fn(),
    runAdditionalOCRPasses: vi.fn(),
    walletCreditBatch: vi.fn(),
  };
});

vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses };
});
vi.mock('../../services/walletService.js', () => ({ default: { creditBatch: walletCreditBatch } }));

const { db } = vi.hoisted(() => {
  // Faithful in-memory Supabase/PostgREST emulator:
  //  - eq/in/lt/gt filters really filter rows
  //  - UPDATE only touches rows matched by the WHERE clause (0-row match = data [])
  //  - INSERT .single() returns the inserted row, unique(utr) enforces 23505
  //  - SELECT .single() with no row returns PGRST116 (like PostgREST)
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

        // select
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
  return { db: { state, from: (t) => builder(t) } };
});

vi.mock('../../db/supabase.js', () => {
  const client = {
    from: (t) => db.from(t),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://x/p.png' } }),
      }),
    },
  };
  return { supabase: client, supabaseAnon: {}, default: client };
});

import { uploadScreenshot } from '../../controllers/paymentController.js';
import { approvePayment, verifyPayment } from '../../services/paymentService.js';
import { applyTopupVerification } from '../../services/topupService.js';

const RECEIVER_UPI = 'jayarajj126-3@okicici';

function istDateLine(minutesBeforeUpload) {
  const ist = new Date(Date.now() - minutesBeforeUpload * 60000 + 5.5 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  let h = ist.getUTCHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${pad(ist.getUTCDate())}/${pad(ist.getUTCMonth() + 1)}/${ist.getUTCFullYear()}, ${h}:${pad(ist.getUTCMinutes())} ${ap}`;
}

const VALID_RECEIPT = [
  'Payment Successful',
  '\u20B9120',
  'To Jayaraj',
  RECEIVER_UPI,
  `Date: ${istDateLine(2)}`,
  'UPI transaction ID: T7GHD240824',
].join('\n');

function seed({ paymentStatus = 'pending', userStatus = 'pending', plan = 120 } = {}) {
  db.state.updates = {};
  db.state.inserts = {};
  db.state.results = {};
  db.state.forcedErrors = {};
  for (const key of Object.keys(db.state.store)) db.state.store[key] = [];
  db.state.store.payments.push({
    id: 'pay-1',
    user_id: 'user-1',
    selected_plan: plan,
    expected_amount: plan,
    upi_id: RECEIVER_UPI,
    receiver_upi: RECEIVER_UPI,
    screenshot_url: 'https://x/s.png',
    status: paymentStatus,
    expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
  });
  db.state.store.users.push({
    id: 'user-1',
    status: userStatus,
    current_plan: plan,
    wallet_balance: 0,
    referred_by: null,
    referral_code: 'REFX',
    role: 'user',
  });
}

const PAY = () => db.state.store.payments.find(r => r.id === 'pay-1');
const USR = () => db.state.store.users.find(r => r.id === 'user-1');
const TOP = () => db.state.store.topups.find(r => r.id === 'top-1');

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const reqFor = () => ({
  params: { paymentId: 'pay-1' },
  user: { id: 'user-1', role: 'user' },
  file: { buffer: Buffer.from('img'), originalname: 'shot.png', mimetype: 'image/png' },
});

const paymentUpdates = () => (db.state.updates.payments || []);

beforeEach(() => {
  vi.clearAllMocks();
  runOCR.mockResolvedValue({ text: VALID_RECEIPT, confidence: 90 });
  runAmountRecoveryOCR.mockResolvedValue([]);
  runAdditionalOCRPasses.mockResolvedValue([]);
  walletCreditBatch.mockResolvedValue([{ credited: true }, { credited: true }]);
  seed();
});

// ─────────────────────────────────────────────────────────────
// 1. OCR-only evidence must never produce a final approval
// ─────────────────────────────────────────────────────────────
describe('S1 valid-looking OCR requires external payment confirmation', () => {
  it('controller returns manual review without activating the user', async () => {
    const res = mockRes();
    await uploadScreenshot(reqFor(), res);

    expect(res.body.success).toBe(true);
    expect(res.body.data.verification.status).toBe('manual_review');
    expect(PAY().status).toBe('manual_review');
    expect(paymentUpdates().some(u => u.status === 'approved')).toBe(false);
    expect(USR().status).toBe('pending');
  });

  it('records the OCR candidate but does not reserve its UTR or set approval fields', async () => {
    const res = mockRes();
    await uploadScreenshot(reqFor(), res);

    const row = PAY();
    expect(row.verification_result).toMatchObject({
      decision: 'manual_review',
      ocrDecision: 'approved',
      reason: 'EXTERNAL_PAYMENT_CONFIRMATION_REQUIRED',
    });
    expect(row.verified_at).toBeTruthy();
    expect(row.transaction_id).toBeNull();
    expect(row.approved_at).toBeUndefined();
    expect(db.state.store.approved_utrs).toHaveLength(0);
  });

  it('keeps a prior manual-review payment in manual review', async () => {
    seed({ paymentStatus: 'manual_review' });
    const res = mockRes();
    await uploadScreenshot(reqFor(), res);
    expect(PAY().status).toBe('manual_review');
  });
});

// ─────────────────────────────────────────────────────────────
// 2. INVALID PAYMENTS NEVER AUTO-APPROVE
// ─────────────────────────────────────────────────────────────
describe('S2 invalid payments are never approved', () => {
  it('wrong amount -> rejected AMOUNT_MISMATCH', async () => {
    runOCR.mockResolvedValue({ text: VALID_RECEIPT.replace('\u20B9120', '\u20B9500'), confidence: 90 });
    const res = mockRes();
    await uploadScreenshot(reqFor(), res);
    expect(PAY().status).toBe('rejected');
    expect(PAY().verification_result.reason).toBe('AMOUNT_MISMATCH');
  });

  it('wrong receiver UPI -> rejected UPI_MISMATCH', async () => {
    runOCR.mockResolvedValue({ text: VALID_RECEIPT.replace(RECEIVER_UPI, 'attacker@paytm'), confidence: 90 });
    const res = mockRes();
    await uploadScreenshot(reqFor(), res);
    expect(PAY().status).toBe('rejected');
    expect(PAY().verification_result.reason).toBe('UPI_MISMATCH');
    expect(USR().status).toBe('pending');
  });

  it('stale/previous-day transaction date -> rejected INVALID_PAYMENT_DATE', async () => {
    runOCR.mockResolvedValue({ text: VALID_RECEIPT.replace(istDateLine(2), '12/01/2024, 9:52 AM'), confidence: 90 });
    const res = mockRes();
    await uploadScreenshot(reqFor(), res);
    expect(PAY().status).toBe('rejected');
    expect(PAY().verification_result.reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('missing UTR -> rejected MISSING_UTR', async () => {
    runOCR.mockResolvedValue({ text: VALID_RECEIPT.replace('UPI transaction ID: T7GHD240824', ''), confidence: 90 });
    const res = mockRes();
    await uploadScreenshot(reqFor(), res);
    expect(PAY().status).toBe('rejected');
    expect(PAY().verification_result.reason).toBe('MISSING_UTR');
  });

  it('failed transaction status -> rejected TRANSACTION_FAILED', async () => {
    runOCR.mockResolvedValue({ text: VALID_RECEIPT.replace('Payment Successful', 'Payment Failed'), confidence: 90 });
    const res = mockRes();
    await uploadScreenshot(reqFor(), res);
    expect(PAY().status).toBe('rejected');
    expect(PAY().verification_result.reason).toBe('TRANSACTION_FAILED');
  });

  it('low OCR confidence -> rejected LOW_OCR_CONFIDENCE', async () => {
    runOCR.mockResolvedValue({ text: VALID_RECEIPT, confidence: 10 });
    const res = mockRes();
    await uploadScreenshot(reqFor(), res);
    expect(PAY().status).toBe('rejected');
    expect(PAY().verification_result.reason).toBe('LOW_OCR_CONFIDENCE');
  });

  it('OCR-only UTR is not reserved or treated as an approved duplicate', async () => {
    db.state.forcedErrors.approved_utrs = { code: '23505', message: 'duplicate key value' };
    const res = mockRes();
    await uploadScreenshot(reqFor(), res);
    expect(PAY().status).toBe('manual_review');
    expect(PAY().verification_result.reason).toBe('EXTERNAL_PAYMENT_CONFIRMATION_REQUIRED');
    expect(USR().status).toBe('pending');
  });
});

// ─────────────────────────────────────────────────────────────
// 3. NON-DECISION FAILURES MUST NOT LOOK LIKE A DECISION
// ─────────────────────────────────────────────────────────────
describe('S3 OCR failure leaves a retryable pending row (never approved)', () => {
  it('runOCR throwing -> status stays pending, verification inconclusive', async () => {
    runOCR.mockRejectedValue(new Error('worker died'));
    const res = mockRes();
    await uploadScreenshot(reqFor(), res);

    expect(res.statusCode).toBe(200);
    expect(PAY().status).toBe('pending');
    expect(PAY().verification_result?.inconclusive).toBe(true);
    expect(PAY().verification_result?.decision).toBe(null);
    expect(PAY().verification_result?.reason).toBe('OCR_FAILED');
    expect(paymentUpdates().some(u => u.status === 'approved')).toBe(false);
    expect(USR().status).toBe('pending');
  });
});

// ─────────────────────────────────────────────────────────────
// 4. SCREENSHOT OCR MUST NOT TRIGGER APPROVAL SIDE EFFECTS
// ─────────────────────────────────────────────────────────────
describe('S4 OCR-only evidence cannot trigger approval side effects', () => {
  it('does not activate the user or emit approval notifications', async () => {
    db.state.forcedErrors.notifications = { code: 'XX000', message: 'insert blocked' };
    const res = mockRes();
    await uploadScreenshot(reqFor(), res);

    expect(PAY().verification_result?.decision).toBe('manual_review');
    expect(PAY().status).toBe('manual_review');
    expect(USR().status).toBe('pending');
    expect(db.state.store.notifications).toHaveLength(0);
    expect(db.state.store.wallet_transactions).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
// 5. DUPLICATE CREDIT PROTECTION (top-up)
// ─────────────────────────────────────────────────────────────
describe('S5 top-up: valid -> completed + credited once; replay -> no double credit', () => {
  function seedTopup() {
    seed();
    db.state.store.users.push({
      id: 'user-2', status: 'active', current_plan: 120,
      wallet_balance: 0, referred_by: 'user-1', referral_code: 'REFY', role: 'user',
    });
    db.state.store.topups.push({
      id: 'top-1',
      sender_id: 'user-1',
      receiver_id: 'user-2',
      amount: 120,
      status: 'created',
      expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
    });
  }

  it('valid top-up proof completes the record and credits both wallets once', async () => {
    seedTopup();
    const verificationResult = {
      decision: 'approved', reason: null, utr: 'UTR-OK-1',
      amountMatch: true, upiMatch: true, dateValid: true,
    };
    const out = await applyTopupVerification(TOP(), verificationResult, new Date());

    expect(TOP().status).toBe('completed');
    expect(out.credited).toBe(true);

    expect(walletCreditBatch).toHaveBeenCalledTimes(1);

    walletCreditBatch.mockResolvedValueOnce([{ credited: false }, { credited: false }]);
    const replay = await applyTopupVerification(TOP(), verificationResult, new Date());
    expect(replay.credited).toBe(false);
    expect(walletCreditBatch).toHaveBeenCalledTimes(2);
  });

  it('rejected top-up proof never credits', async () => {
    seedTopup();
    const out = await applyTopupVerification(
      TOP(),
      { decision: 'rejected', reason: 'UPI_MISMATCH', utr: null },
      new Date()
    );
    expect(TOP().status).toBe('rejected');
    expect(out.credited).toBe(false);
    expect(walletCreditBatch).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// 6. PAYMENT ROWS ARE NEVER RE-OPENED AFTER A DECISION
// ─────────────────────────────────────────────────────────────
describe('S6 decided rows cannot be resurrected', () => {
  it('re-running verifyPayment on an approved row throws PAYMENT_NOT_PENDING', async () => {
    seed({ paymentStatus: 'approved' });
    await expect(verifyPayment('pay-1', Buffer.from('img'))).rejects.toMatchObject({
      code: 'PAYMENT_NOT_PENDING',
    });
    expect(PAY().status).toBe('approved');
  });

  it('expired payment request is rejected, never approved', async () => {
    seed();
    PAY().expires_at = new Date(Date.now() - 60000).toISOString();
    await expect(verifyPayment('pay-1', Buffer.from('img'))).rejects.toMatchObject({
      code: 'PAYMENT_EXPIRED',
    });
    expect(PAY().status).toBe('pending');
  });
});

describe('manual registration approval evidence', () => {
  it('rejects an admin approval attempt when no screenshot proof is stored', async () => {
    seed();
    PAY().screenshot_url = null;

    await expect(approvePayment('pay-1', 'admin-1')).rejects.toMatchObject({
      code: 'PAYMENT_PROOF_REQUIRED',
    });
    expect(PAY().status).toBe('pending');
    expect(USR().status).toBe('pending');
  });
});
