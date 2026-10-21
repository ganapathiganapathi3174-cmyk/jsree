import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses } = vi.hoisted(() => {
  if (!process.env.ADMIN_RECEIVER_NAME) {
    process.env.ADMIN_RECEIVER_NAME = 'Jayaraj';
  }
  return {
    runOCR: vi.fn(),
    runAmountRecoveryOCR: vi.fn(),
    runAdditionalOCRPasses: vi.fn(),
  };
});

vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses };
});

const { reserveApprovedUtrMock } = vi.hoisted(() => ({
  reserveApprovedUtrMock: vi.fn(),
}));

vi.mock('../../services/verificationService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, reserveApprovedUtr: reserveApprovedUtrMock };
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

function seedPayment() {
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

function istClock(minOffset = 0) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(Date.now() + minOffset * 60 * 1000 + IST_OFFSET_MS);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(ist.getUTCDate())}/${p(ist.getUTCMonth() + 1)}/${ist.getUTCFullYear()} ${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}`;
}

function makeText(amount, upi, utr, date) {
  const utrLine = utr ? `UTR: ${utr}` : '';
  const dateLine = date ? `Date: ${date}` : '';
  return `Payment Successful\nAmount \u20B9${amount}\nTo: ${upi}\n${utrLine}\n${dateLine}`;
}

describe('E2E: Payment Verification Flow (controller + service)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reserveApprovedUtrMock.mockResolvedValue({ reserved: true, duplicate: false, utr: 'TESTUTR123' });
    seedPayment();
    runOCR.mockResolvedValue({ text: makeText(120, RECEIVER_UPI, 'TESTUTR123', istClock()), confidence: 90 });
    runAmountRecoveryOCR.mockResolvedValue([]);
    runAdditionalOCRPasses.mockResolvedValue([]);
  });

  it('valid ₹120 screenshot -> manual_review (RECEIVER_NAME_UNREADABLE since name not detected)', async () => {
    const req = {
      params: { paymentId: 'pay-1' },
      user: { id: 'user-1', role: 'user' },
      file: { buffer: Buffer.from('img'), originalname: 'shot.png', mimetype: 'image/png' },
    };
    const res = { statusCode: 200, body: null, status: (c) => { res.statusCode = c; return res; }, json: (b) => { res.body = b; return res; } };

    await uploadScreenshot(req, res);

    expect(res.body.success).toBe(true);
    expect(res.body.data.verification.status).toBe('manual_review');
    expect(db.state.paymentRow.status).toBe('manual_review');
    // Name not detected in OCR text -> RECEIVER_NAME_UNREADABLE
    expect(db.state.paymentRow.verification_result).toMatchObject({
      decision: 'manual_review',
      reason: 'RECEIVER_NAME_UNREADABLE',
    });
    expect(db.state.userRow.status).toBe('pending');
    expect(db.state.userRow.current_plan).toBeNull();
  });

  it('valid ₹500 screenshot -> manual_review', async () => {
    db.state.paymentRow.expected_amount = 500;
    db.state.paymentRow.selected_plan = 500;
    runOCR.mockResolvedValue({ text: makeText(500, RECEIVER_UPI, 'TESTUTR456', istClock()), confidence: 90 });

    const req = {
      params: { paymentId: 'pay-1' },
      user: { id: 'user-1', role: 'user' },
      file: { buffer: Buffer.from('img'), originalname: 'shot.png', mimetype: 'image/png' },
    };
    const res = { statusCode: 200, body: null, status: (c) => { res.statusCode = c; return res; }, json: (b) => { res.body = b; return res; } };

    await uploadScreenshot(req, res);

    expect(res.body.success).toBe(true);
    expect(res.body.data.verification.status).toBe('manual_review');
  });

  it('valid ₹1000 screenshot -> manual_review', async () => {
    db.state.paymentRow.expected_amount = 1000;
    db.state.paymentRow.selected_plan = 1000;
    runOCR.mockResolvedValue({ text: makeText(1000, RECEIVER_UPI, 'TESTUTR789', istClock()), confidence: 90 });

    const req = {
      params: { paymentId: 'pay-1' },
      user: { id: 'user-1', role: 'user' },
      file: { buffer: Buffer.from('img'), originalname: 'shot.png', mimetype: 'image/png' },
    };
    const res = { statusCode: 200, body: null, status: (c) => { res.statusCode = c; return res; }, json: (b) => { res.body = b; return res; } };

    await uploadScreenshot(req, res);

    expect(res.body.success).toBe(true);
    expect(res.body.data.verification.status).toBe('manual_review');
  });
});

describe('Verification rejection and failure cases (controller layer)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reserveApprovedUtrMock.mockResolvedValue({ reserved: true, duplicate: false, utr: 'TESTUTR123' });
  });

  it('amount mismatch -> AMOUNT_MISMATCH', async () => {
    runOCR.mockResolvedValue({ text: makeText(500, RECEIVER_UPI, 'TESTUTR123', istClock()), confidence: 90 });
    const req = {
      params: { paymentId: 'pay-1' },
      user: { id: 'user-1', role: 'user' },
      file: { buffer: Buffer.from('img'), originalname: 'shot.png', mimetype: 'image/png' },
    };
    const res = { statusCode: 200, body: null, status: (c) => { res.statusCode = c; return res; }, json: (b) => { res.body = b; return res; } };
    seedPayment();
    db.state.paymentRow.expected_amount = 120;

    await uploadScreenshot(req, res);

    expect(res.body.success).toBe(true);
    expect(res.body.data.verification.status).toBe('rejected');
    expect(res.body.data.verification.reason).toBe('AMOUNT_MISMATCH');
  });

  it('receiver UPI mismatch -> UPI_MISMATCH', async () => {
    runOCR.mockResolvedValue({ text: makeText(120, 'wrong@okicici', 'TESTUTR123', istClock()), confidence: 90 });
    const req = {
      params: { paymentId: 'pay-1' },
      user: { id: 'user-1', role: 'user' },
      file: { buffer: Buffer.from('img'), originalname: 'shot.png', mimetype: 'image/png' },
    };
    const res = { statusCode: 200, body: null, status: (c) => { res.statusCode = c; return res; }, json: (b) => { res.body = b; return res; } };
    seedPayment();

    await uploadScreenshot(req, res);

    expect(res.body.success).toBe(true);
    expect(res.body.data.verification.status).toBe('rejected');
    expect(res.body.data.verification.reason).toBe('UPI_MISMATCH');
  });

  it('receiver name mismatch -> RECEIVER_NAME_MISMATCH', async () => {
    process.env.ADMIN_RECEIVER_NAME = 'Expected Name';
    // OCR text has correct UPI but wrong name - name detection will find "Wrong Name" which mismatches "Expected Name"
    // The UPI must be in a format that gets extracted correctly
    runOCR.mockResolvedValue({ text: `Payment Successful\nAmount \u20B9120\nTo: Wrong Name\n${RECEIVER_UPI}\nUTR: TESTUTR123\nDate: ${istClock()}`, confidence: 90 });
    const req = {
      params: { paymentId: 'pay-1' },
      user: { id: 'user-1', role: 'user' },
      file: { buffer: Buffer.from('img'), originalname: 'shot.png', mimetype: 'image/png' },
    };
    const res = { statusCode: 200, body: null, status: (c) => { res.statusCode = c; return res; }, json: (b) => { res.body = b; return res; } };
    seedPayment();

    await uploadScreenshot(req, res);

    expect(res.body.success).toBe(true);
    expect(res.body.data.verification.status).toBe('rejected');
    expect(res.body.data.verification.reason).toBe('RECEIVER_NAME_MISMATCH');
  });

  it('missing UTR -> MISSING_UTR', async () => {
    const text = makeText(120, RECEIVER_UPI, null, istClock()).replace('UTR: TESTUTR123\n', '');
    runOCR.mockResolvedValue({ text, confidence: 90 });
    const req = {
      params: { paymentId: 'pay-1' },
      user: { id: 'user-1', role: 'user' },
      file: { buffer: Buffer.from('img'), originalname: 'shot.png', mimetype: 'image/png' },
    };
    const res = { statusCode: 200, body: null, status: (c) => { res.statusCode = c; return res; }, json: (b) => { res.body = b; return res; } };
    seedPayment();

    await uploadScreenshot(req, res);

    expect(res.body.success).toBe(true);
    expect(res.body.data.verification.status).toBe('rejected');
    expect(res.body.data.verification.reason).toBe('MISSING_UTR');
  });

  it('duplicate UTR -> manual_review (RECEIVER_NAME_UNREADABLE since name gate fails first)', async () => {
    reserveApprovedUtrMock.mockResolvedValueOnce({ duplicate: true, reserved: false, utr: 'DUPUTR123' });
    runOCR.mockResolvedValue({ text: makeText(120, RECEIVER_UPI, 'DUPUTR123', istClock()), confidence: 90 });
    const req = {
      params: { paymentId: 'pay-1' },
      user: { id: 'user-1', role: 'user' },
      file: { buffer: Buffer.from('img'), originalname: 'shot.png', mimetype: 'image/png' },
    };
    const res = { statusCode: 200, body: null, status: (c) => { res.statusCode = c; return res; }, json: (b) => { res.body = b; return res; } };
    seedPayment();

    await uploadScreenshot(req, res);

    expect(res.body.success).toBe(true);
    // Duplicate UTR is checked after OCR approval, but name gate fails first -> manual_review
    expect(res.body.data.verification.status).toBe('manual_review');
    expect(res.body.data.verification.reason).toBe('RECEIVER_NAME_UNREADABLE');
  });

  it('OCR throws -> returns error in verification object with OCR_FAILED', async () => {
    runOCR.mockRejectedValue(new Error('OCR failed'));
    const req = {
      params: { paymentId: 'pay-1' },
      user: { id: 'user-1', role: 'user' },
      file: { buffer: Buffer.from('img'), originalname: 'shot.png', mimetype: 'image/png' },
    };
    const res = { statusCode: 200, body: null, status: (c) => { res.statusCode = c; return res; }, json: (b) => { res.body = b; return res; } };
    seedPayment();

    await uploadScreenshot(req, res);

    // Controller catches error and returns verification object with error reason
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.verification.reason).toBe('OCR_FAILED');
  });

  it('OCR unreadable -> returns error in verification object with OCR_UNREADABLE', async () => {
    runOCR.mockResolvedValue({ text: '', confidence: 0 });
    const req = {
      params: { paymentId: 'pay-1' },
      user: { id: 'user-1', role: 'user' },
      file: { buffer: Buffer.from('img'), originalname: 'shot.png', mimetype: 'image/png' },
    };
    const res = { statusCode: 200, body: null, status: (c) => { res.statusCode = c; return res; }, json: (b) => { res.body = b; return res; } };
    seedPayment();

    await uploadScreenshot(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.verification.reason).toBe('OCR_UNREADABLE');
  });

  it('empty receiver name config -> manual_review (RECEIVER_NAME_UNREADABLE since name not configured and not detected)', async () => {
    delete process.env.ADMIN_RECEIVER_NAME;
    runOCR.mockResolvedValue({ text: makeText(120, RECEIVER_UPI, 'TESTUTR123', istClock()), confidence: 90 });
    const req = {
      params: { paymentId: 'pay-1' },
      user: { id: 'user-1', role: 'user' },
      file: { buffer: Buffer.from('img'), originalname: 'shot.png', mimetype: 'image/png' },
    };
    const res = { statusCode: 200, body: null, status: (c) => { res.statusCode = c; return res; }, json: (b) => { res.body = b; return res; } };
    seedPayment();

    await uploadScreenshot(req, res);

    expect(res.body.success).toBe(true);
    expect(res.body.data.verification.status).toBe('manual_review');
    // When receiver name config is empty and name not detected in OCR -> RECEIVER_NAME_UNREADABLE
    expect(res.body.data.verification.reason).toBe('RECEIVER_NAME_UNREADABLE');
  });

  it('low OCR confidence -> LOW_OCR_CONFIDENCE', async () => {
    runOCR.mockResolvedValue({ text: makeText(120, RECEIVER_UPI, 'TESTUTR123', istClock()), confidence: 30 });
    const req = {
      params: { paymentId: 'pay-1' },
      user: { id: 'user-1', role: 'user' },
      file: { buffer: Buffer.from('img'), originalname: 'shot.png', mimetype: 'image/png' },
    };
    const res = { statusCode: 200, body: null, status: (c) => { res.statusCode = c; return res; }, json: (b) => { res.body = b; return res; } };
    seedPayment();

    await uploadScreenshot(req, res);

    expect(res.body.success).toBe(true);
    expect(res.body.data.verification.status).toBe('rejected');
    expect(res.body.data.verification.reason).toBe('LOW_OCR_CONFIDENCE');
  });

  it('expired transaction date -> INVALID_PAYMENT_DATE', async () => {
    // Use a date far in the past (outside the ±30 minute window)
    runOCR.mockResolvedValue({ text: makeText(120, RECEIVER_UPI, 'TESTUTR123', '18/08/2025 12:30'), confidence: 90 });
    const req = {
      params: { paymentId: 'pay-1' },
      user: { id: 'user-1', role: 'user' },
      file: { buffer: Buffer.from('img'), originalname: 'shot.png', mimetype: 'image/png' },
    };
    const res = { statusCode: 200, body: null, status: (c) => { res.statusCode = c; return res; }, json: (b) => { res.body = b; return res; } };
    seedPayment();

    await uploadScreenshot(req, res);

    expect(res.body.success).toBe(true);
    expect(res.body.data.verification.status).toBe('rejected');
    expect(res.body.data.verification.reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('failed transaction status -> TRANSACTION_FAILED', async () => {
    runOCR.mockResolvedValue({ text: makeText(120, RECEIVER_UPI, 'TESTUTR123', istClock()).replace('Payment Successful', 'Payment Failed'), confidence: 90 });
    const req = {
      params: { paymentId: 'pay-1' },
      user: { id: 'user-1', role: 'user' },
      file: { buffer: Buffer.from('img'), originalname: 'shot.png', mimetype: 'image/png' },
    };
    const res = { statusCode: 200, body: null, status: (c) => { res.statusCode = c; return res; }, json: (b) => { res.body = b; return res; } };
    seedPayment();

    await uploadScreenshot(req, res);

    expect(res.body.success).toBe(true);
    expect(res.body.data.verification.status).toBe('rejected');
    expect(res.body.data.verification.reason).toBe('TRANSACTION_FAILED');
  });
});