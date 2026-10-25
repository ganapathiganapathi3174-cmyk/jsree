import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses, runDeepAmountRecovery } = vi.hoisted(() => {
  // Ensure receiver name is configured so the name gate does not block
  // auto-approval in these tests.
  if (!process.env.ADMIN_RECEIVER_NAME) {
    process.env.ADMIN_RECEIVER_NAME = 'Jayaraj';
  }
  // These suites assert straight-through auto-approval: enable it explicitly.
  // Production default (unset) is the secure external-confirmation fallback.
  process.env.PAYMENT_AUTO_APPROVE = 'true';
  return {
    runOCR: vi.fn(),
    runAmountRecoveryOCR: vi.fn(),
    runAdditionalOCRPasses: vi.fn(),
    runDeepAmountRecovery: vi.fn(),
  };
});

vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses, runDeepAmountRecovery };
});

const { db } = vi.hoisted(() => {
  const state = { paymentRow: null, userRow: null, updates: {}, inserts: {}, results: {} };
  const rec = (bucket, table, payload) => {
    (state[bucket][table] = state[bucket][table] || []).push(payload);
  };
  const builder = (table) => {
    const p = {
      _sel: false, _single: false, _inserted: null,
      update: (payload) => {
        rec('updates', table, payload);
        if (table === 'payments' && state.paymentRow) Object.assign(state.paymentRow, payload);
        if (table === 'users' && state.userRow) Object.assign(state.userRow, payload);
        return p;
      },
      insert: (payload) => { rec('inserts', table, payload); p._inserted = payload; return p; },
      delete: () => p,
      select: () => { p._sel = true; return p; },
      eq: () => p, neq: () => p, in: () => p, or: () => p, order: () => p,
      limit: () => p, range: () => p, lt: () => p, gt: () => p,
      single: () => { p._single = true; return p; },
      maybeSingle: () => { p._single = true; return p; },
      then: (res, rej) => {
        let out;
        if (table === 'payments') {
          if (p._inserted) out = { data: { ...p._inserted }, error: null };
          else out = { data: state.paymentRow ? { ...state.paymentRow } : null, error: null };
          if (p._sel && !p._single && state.paymentList) out = { data: state.paymentList.map(r => ({ ...r })), error: null };
        } else if (table === 'users') {
          if (p._sel) out = { data: state.userRow ? [{ ...state.userRow }] : [], error: null };
          else out = { data: state.userRow ? { ...state.userRow } : null, error: null };
        } else if (table === 'approved_utrs') {
          out = p._inserted
            ? { data: { id: 'utr-1', ...p._inserted }, error: null }
            : { data: null, error: null };
        } else if (table === 'notifications') {
          out = { data: p._inserted ? { id: 'notif-1', ...p._inserted } : null, error: null };
        } else {
          out = state.results[table] || { data: null, error: null };
        }
        return Promise.resolve(out).then(res, rej);
      },
      catch: (fn) => p.then(undefined, fn),
    };
    return p;
  };
  return { db: { state, from: (t) => builder(t) } };
});

vi.mock('../../db/supabase.js', () => {
  const client = { from: (t) => db.from(t), storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: 'https://x/p.png' } }) }) } };
  return { supabase: client, supabaseAnon: {}, default: client };
});

import { uploadScreenshot } from '../../controllers/paymentController.js';

const RECEIVER_UPI = 'jayarajj126-3@okicici';

const VALID_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

// Real production GPay receipt text (validated earlier by diagnostic test).
const GPAY_TEXT = [
  'Payment Successful',
  '\u20B9120',
  'To Jayaraj',
  RECEIVER_UPI,
  `Date: ${(() => {
    const ist = new Date(Date.now() - 2 * 60000 + 5.5 * 3600000);
    const pad = n => String(n).padStart(2, '0');
    let h = ist.getUTCHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return `${pad(ist.getUTCDate())}/${pad(ist.getUTCMonth() + 1)}/${ist.getUTCFullYear()}, ${h}:${pad(ist.getUTCMinutes())} ${ap}`;
  })()}`,
  'UPI transaction ID: T7GHD240824',
].join('\n');

function seed() {
  db.state.updates = {};
  db.state.inserts = {};
  db.state.results = {};
  db.state.paymentList = null;
  db.state.paymentRow = {
    id: 'pay-1',
    user_id: 'user-1',
    selected_plan: 120,
    expected_amount: 120,
    upi_id: RECEIVER_UPI,
    receiver_upi: RECEIVER_UPI,
    screenshot_url: 'https://x/s.png',
    status: 'pending',
    expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
  };
  db.state.userRow = { id: 'user-1', status: 'pending', current_plan: null, referred_by: null, referral_code: 'REFX' };
}

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  runOCR.mockResolvedValue({ text: GPAY_TEXT, confidence: 90 });
  runAmountRecoveryOCR.mockResolvedValue([]);
  runAdditionalOCRPasses.mockResolvedValue([]);
  runDeepAmountRecovery.mockResolvedValue([]);
  seed();
});

describe('E2E: valid screenshot through paymentController.uploadScreenshot', () => {
  it('full engine evidence approves the payment and activates the user', async () => {
    const req = {
      params: { paymentId: 'pay-1' },
      user: { id: 'user-1', role: 'user' },
      file: { buffer: VALID_IMAGE, originalname: 'shot.png', mimetype: 'image/png' },
    };
    const res = mockRes();

    await uploadScreenshot(req, res);

    expect(res.body.success).toBe(true);
    expect(res.body.data.verification.status).toBe('approved');
    expect(db.state.paymentRow.status).toBe('approved');
    expect(db.state.paymentRow.transaction_id).toBe('T7GHD240824');
    expect(db.state.paymentRow.verification_result).toMatchObject({
      decision: 'approved',
      engine: 'paymentValidationEngine/v1',
    });
    expect(db.state.userRow.status).toBe('active');
    expect(db.state.userRow.current_plan).toBe(120);
    // The reserved UTR is recorded exactly once.
    const utrInserts = (db.state.inserts.approved_utrs || []);
    expect(utrInserts).toHaveLength(1);
    expect(utrInserts[0].utr).toBe('T7GHD240824');
  });
});
