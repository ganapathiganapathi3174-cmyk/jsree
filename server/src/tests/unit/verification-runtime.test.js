import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyPayment } from '../../services/paymentService.js';
import { getUserPayments } from '../../services/paymentService.js';
import { runScreenshotVerification } from '../../services/verificationService.js';
import { applyTopupVerification, getTopupsForUser } from '../../services/topupService.js';

const { runOCR, runAmountRecoveryOCR } = vi.hoisted(() => ({
  runOCR: vi.fn(),
  runAmountRecoveryOCR: vi.fn(),
}));

vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runOCR, runAmountRecoveryOCR };
});

// ─────────────────────────────────────────────────────────────
// Flexible Supabase mock that CAPTURES every UPDATE payload so the
// test can assert exactly what status the real service persists.
// ─────────────────────────────────────────────────────────────
const { db } = vi.hoisted(() => {
  const state = {
    // Mutable rows: updates MERGE so re-selects observe new status.
    paymentRow: null,
    topupRow: null,
    results: {},
    updates: {},
    inserts: {},
  };
  const rec = (bucket, table, payload) => {
    (state[bucket][table] = state[bucket][table] || []).push(payload);
  };
  const builder = (table) => {
    const p = {
      _sel: false,
      _last: null,
      update: (payload) => {
        rec('updates', table, payload);
        if (table === 'payments' && state.paymentRow) Object.assign(state.paymentRow, payload);
        if (table === 'topups' && state.topupRow) Object.assign(state.topupRow, payload);
        p._sel = false;
        return p;
      },
      insert: (payload) => { rec('inserts', table, payload); return p; },
      delete: () => p,
      select: () => { p._sel = true; return p; },
      eq: () => p,
      neq: () => p,
      in: () => p,
      or: () => p,
      order: () => p,
      limit: () => p,
      range: () => p,
      single: () => p,
      maybeSingle: () => p,
      then: (res) => {
        const row = table === 'payments' ? state.paymentRow : table === 'topups' ? state.topupRow : undefined;
        if (row !== undefined) {
          if (p._last === 'single' || p._last === 'maybeSingle') return res({ data: row ? { ...row } : null, error: null });
          if (p._sel) return res({ data: row ? [{ ...row }] : [], error: null });
        }
        return res(state.results[table] || { data: null, error: null });
      },
      catch: () => p,
    };
    for (const m of ['single', 'maybeSingle']) {
      const orig = p[m];
      p[m] = (...a) => { p._last = m; p._sel = false; return orig(...a); };
    }
    return p;
  };
  return { db: { state, builder, from: (t) => builder(t) } };
});

vi.mock('../../db/supabase.js', () => {
  const client = { from: (t) => db.from(t) };
  return { supabase: client, supabaseAnon: {}, default: client };
});

import { supabase } from '../../db/supabase.js';
void supabase;

const RECEIVER_UPI = 'jayarajj126-3@okicici';
const NOW = () => new Date('2026-08-24T07:30:00.000Z'); // 13:00 IST

// verifyPayment uses the REAL server clock (no injected now), so runtime
// receipt timestamps must be generated relative to Date.now().
function istDateLine(minutesBeforeUpload) {
  const ist = new Date(Date.now() - minutesBeforeUpload * 60000 + 5.5 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  const dd = pad(ist.getUTCDate()), mm = pad(ist.getUTCMonth() + 1), yy = ist.getUTCFullYear();
  let h = ist.getUTCHours();
  const mi = pad(ist.getUTCMinutes());
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${dd}/${mm}/${yy}, ${h}:${mi} ${ampm}`;
}

function seedPaymentRow(overrides = {}) {
  return {
    id: 'pay-1',
    user_id: 'user-1',
    selected_plan: 120,
    expected_amount: 120,
    screenshot_url: 'https://x/s.png',
    upi_id: RECEIVER_UPI,
    status: 'pending',
    ...overrides,
  };
}

function resetDb(paymentRow) {
  db.state.updates = {};
  db.state.inserts = {};
  db.state.paymentRow = { ...paymentRow };
  db.state.results = {
    users: { data: [{ id: 'user-1', referred_by: null, referral_code: 'REFX', status: 'active' }], error: null },
    approved_utrs: { data: { id: 'utr-1' }, error: null }, // fresh reservation
    notifications: { data: null, error: null },
    audit_logs: { data: null, error: null },
    referrals: { data: [], error: null },
    wallet_transactions: { data: [], error: null },
    user_tiers: { data: null, error: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  runAmountRecoveryOCR.mockResolvedValue([]);
  resetDb(seedPaymentRow());
});

const PROVIDERS = [
  ['Google Pay', () => ['Google Pay', 'Payment Successful', '\u20B9120', 'To Jayaraj', RECEIVER_UPI, `Date: ${istDateLine(2)}`, 'UPI transaction ID: T7GHD240824'].join('\n')],
  ['PhonePe', () => ['PhonePe', 'Transaction Successful', '\u20B9120', 'Paid to jayarajj126-3@okicici', istDateLine(3).replace(/(\d{2})\/(\d{2})\/(\d{4}),/, '$1/$2/$3,'), 'Transaction ID: PP240824123456'].join('\n')],
  ['Paytm', () => ['Paytm', 'Money Sent Successfully', '\u20B9120', 'To: jayarajj126-3@okicici', 'UPI Ref No: T250824123456', istDateLine(4)].join('\n')],
  ['BHIM', () => ['BHIM', 'Payment Successful', '\u20B9120', 'To: jayarajj126-3@okicici', 'UPI Reference Number: BHIM240824001', istDateLine(5)].join('\n')],
  ['Bank UPI', () => ['SBI UPI', 'Transferred Successfully', 'Rs.120', 'To: jayarajj126-3@okicici', 'Bank Ref No: SBIN240824123', istDateLine(6)].join('\n')],
  ['Amazon Pay', () => ['Amazon Pay', 'Payment Completed', 'Amount \u20B9120', 'Sent to jayarajj126-3@okicici', 'Reference ID: AMZ24082412345', `${istDateLine(7)}`].join('\n')],
];

describe('RUNTIME PATH: paymentService.verifyPayment persisted status', () => {
  for (const [name, makeText] of PROVIDERS) {
    it(`${name}: valid receipt -> DB row becomes "approved" (never manual_review)`, async () => {
      runOCR.mockResolvedValue({ text: makeText(), confidence: 90 });
      resetDb(seedPaymentRow());

      const result = await verifyPayment('pay-1', Buffer.from('img'));

      const payUpdates = db.state.updates.payments || [];
      const persistedStatuses = payUpdates.map(u => u.status);
      const finalRow = { ...seedPaymentRow(), ...payUpdates[payUpdates.length - 1] };

      const diag = {
        provider: name,
        expectedAmount: 120,
        amountMatch: result.verificationResult.amountMatch,
        upiMatch: result.verificationResult.upiMatch,
        utr: result.utr,
        dateValid: result.verificationResult.dateValid,
        transactionStatus: result.verificationResult.transactionStatus?.status ?? null,
        ocrConfidence: result.verificationResult.ocrConfidence,
        apiDecision: result.decision,
        apiReason: result.reason,
        persistedStatuses,
        finalDbStatus: finalRow.status,
        userActivationUpdate: (db.state.updates.users || []).map(u => u.status),
      };
      // Structured diagnostic visible in test output (no sensitive data).
      console.log('VERIFICATION_DIAGNOSTIC', JSON.stringify(diag));

      expect(result.decision).toBe('approved');
      expect(persistedStatuses).toContain('approved');
      expect(persistedStatuses.every(s => s !== 'manual_review')).toBe(true);
      expect(finalRow.status).toBe('approved');
    });
  }

  it('Paytm wrong UPI -> DB row becomes "rejected" with UPI_MISMATCH', async () => {
    runOCR.mockResolvedValue({
      text: ['Paytm', 'Money Sent Successfully', '\u20B9120', 'To: attacker@paytm', 'UPI Ref No: NEG000000001', istDateLine(2)].join('\n'),
      confidence: 90,
    });
    const result = await verifyPayment('pay-1', Buffer.from('img'));
    const statuses = (db.state.updates.payments || []).map(u => u.status);
    console.log('VERIFICATION_DIAGNOSTIC', JSON.stringify({ case: 'wrong-upi', apiDecision: result.decision, apiReason: result.reason, persistedStatuses: statuses }));
    expect(result.decision).toBe('rejected');
    expect(result.reason).toBe('UPI_MISMATCH');
    expect(statuses).toContain('rejected');
    expect(statuses.every(s => s !== 'manual_review')).toBe(true);
  });

  it('duplicate UTR -> DB row becomes "rejected" with DUPLICATE_UTR', async () => {
    runOCR.mockResolvedValue({
      text: ['Paytm', 'Money Sent Successfully', '\u20B9120', 'To: jayarajj126-3@okicici', 'UPI Ref No: DUP000000001', istDateLine(2)].join('\n'),
      confidence: 90,
    });
    db.state.results.approved_utrs = { data: null, error: { code: '23505', message: 'unique violation' } };

    const result = await verifyPayment('pay-1', Buffer.from('img'));
    const statuses = (db.state.updates.payments || []).map(u => u.status);
    console.log('VERIFICATION_DIAGNOSTIC', JSON.stringify({ case: 'duplicate-utr', apiDecision: result.decision, apiReason: result.reason, persistedStatuses: statuses }));
    expect(result.decision).toBe('rejected');
    expect(result.reason).toBe('DUPLICATE_UTR');
    expect(statuses.every(s => s !== 'manual_review')).toBe(true);
  });

  it('legacy manual_review row retried through POST /verify -> resolved by CURRENT rules', async () => {
    runOCR.mockResolvedValue({
      text: ['Paytm', 'Money Sent Successfully', '\u20B9120', 'To: jayarajj126-3@okicici', 'UPI Ref No: FIX000000001', istDateLine(2)].join('\n'),
      confidence: 90,
    });
    resetDb(seedPaymentRow({ status: 'manual_review' }));

    const result = await verifyPayment('pay-1', Buffer.from('img'));
    const statuses = (db.state.updates.payments || []).map(u => u.status);
    console.log('VERIFICATION_DIAGNOSTIC', JSON.stringify({ case: 'legacy-manual_review-retry', apiDecision: result.decision, apiReason: result.reason, persistedStatuses: statuses }));
    expect(['approved', 'rejected']).toContain(result.decision);
    expect(statuses.every(s => s !== 'manual_review')).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════
// TOP-UP RUNTIME PATH: same engine, binary persistence only.
// ═══════════════════════════════════════════════════════════════
describe('RUNTIME PATH: applyTopupVerification persisted status', () => {
  const seedTopup = (overrides = {}) => ({
    id: 'top-1',
    sender_id: 'sender-1',
    receiver_id: 'receiver-1',
    amount: 120,
    plan: 120,
    status: 'created',
    ...overrides,
  });

  function resetTopupDb(row) {
    db.state.updates = {};
    db.state.inserts = {};
    db.state.topupRow = { ...row };
    db.state.results = {
      users: { data: { id: 'u', wallet_balance: 0 }, error: null },
      approved_utrs: { data: { id: 'utr-1' }, error: null },
      wallet_transactions: { data: [], error: null },
      notifications: { data: null, error: null },
      audit_logs: { data: null, error: null },
    };
  }

  async function runTopupVerification(text) {
    runOCR.mockResolvedValue({ text, confidence: 90 });
    const { verificationResult, verificationTime } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
    });
    return applyTopupVerification(seedTopup(), verificationResult, verificationTime);
  }

  it('Paytm valid proof -> topup "completed", both wallets credited once', async () => {
    resetTopupDb(seedTopup());
    const outcome = await runTopupVerification(
      ['Paytm', 'Money Sent Successfully', '\u20B9120', `To: ${RECEIVER_UPI}`, 'UPI Ref No: TOP2408240001', istDateLine(2)].join('\n')
    );
    const statuses = (db.state.updates.topups || []).map(u => u.status);
    const credits = (db.state.inserts.wallet_transactions || []);
    console.log('VERIFICATION_DIAGNOSTIC', JSON.stringify({ flow: 'topup-valid', outcome, persistedStatuses: statuses, creditCount: credits.length }));
    expect(statuses).toContain('completed');
    expect(statuses.every(s => s !== 'manual_review')).toBe(true);
    expect(credits.length).toBe(2);
  });

  it('GPay valid proof -> completed + credited (provider parity)', async () => {
    resetTopupDb(seedTopup());
    await runTopupVerification(
      ['Google Pay', 'Payment Successful', '\u20B9120', 'To Jayaraj', RECEIVER_UPI, `Date: ${istDateLine(2)}`, 'UPI transaction ID: T7GHDTOP001'].join('\n')
    );
    const statuses = (db.state.updates.topups || []).map(u => u.status);
    expect(statuses).toContain('completed');
    expect((db.state.inserts.wallet_transactions || []).length).toBe(2);
  });

  it('PhonePe wrong amount -> rejected, NO wallet credit', async () => {
    resetTopupDb(seedTopup());
    await runTopupVerification(
      ['PhonePe', 'Transaction Successful', '\u20B9500', `Paid to ${RECEIVER_UPI}`, istDateLine(2), 'Transaction ID: PPXTOP000002'].join('\n')
    );
    const statuses = (db.state.updates.topups || []).map(u => u.status);
    console.log('VERIFICATION_DIAGNOSTIC', JSON.stringify({ flow: 'topup-wrong-amount', persistedStatuses: statuses }));
    expect(statuses).toContain('rejected');
    expect(statuses.every(s => s !== 'manual_review' && s !== 'completed')).toBe(true);
    expect(db.state.inserts.wallet_transactions || []).toHaveLength(0);
  });

  it('duplicate UTR -> reverted to rejected, NO wallet credit', async () => {
    resetTopupDb(seedTopup());
    db.state.results.approved_utrs = { data: null, error: { code: '23505', message: 'unique violation' } };
    const outcome = await runTopupVerification(
      ['Paytm', 'Money Sent Successfully', '\u20B9120', `To: ${RECEIVER_UPI}`, 'UPI Ref No: DUPSTOP00003', istDateLine(2)].join('\n')
    );
    const statuses = (db.state.updates.topups || []).map(u => u.status);
    console.log('VERIFICATION_DIAGNOSTIC', JSON.stringify({ flow: 'topup-duplicate-utr', outcome, persistedStatuses: statuses }));
    expect(outcome.credited).toBeFalsy();
    expect(statuses).toContain('rejected');
    expect(statuses.every(s => s !== 'manual_review')).toBe(true);
    expect(db.state.inserts.wallet_transactions || []).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// USER-FACING API: legacy manual_review never reaches the frontend.
// ═══════════════════════════════════════════════════════════════
describe('USER-FACING API: getUserPayments maps manual_review -> pending', () => {
  it('legacy manual_review row returned as pending to the user', async () => {
    db.state.paymentRow = { id: 'pay-lr', status: 'manual_review', selected_plan: 120, expected_amount: 120 };
    db.state.results.payments = { data: [{ id: 'pay-lr', status: 'manual_review', selected_plan: 120, expected_amount: 120 }], error: null };
    const payments = await getUserPayments('user-1');
    const statuses = payments.map(p => p.status);
    console.log('VERIFICATION_DIAGNOSTIC', JSON.stringify({ case: 'legacy-manual_review-to-user', statuses }));
    expect(statuses).toContain('pending');
    expect(statuses).not.toContain('manual_review');
  });
});

// ═══════════════════════════════════════════════════════════════
// DEMO/SAMPLE SCREENSHOT: runtime rejection through verifyPayment.
// ═══════════════════════════════════════════════════════════════
describe('RUNTIME PATH: DEMO/SAMPLE screenshot rejected', () => {

  function resetDbForDemo() {
    db.state.paymentRow = seedPaymentRow({ status: 'pending' });
    db.state.results = {};
    db.state.updates = {};
    db.state.inserts = {};
  }

  it('DEMO screenshot -> rejected with DEMO_SCREENSHOT', async () => {
    resetDbForDemo();
    runOCR.mockResolvedValue({
      text: [
        'Google Pay', 'DEMO', 'Payment Successful',
        '₹120', `To Jayaraj`, RECEIVER_UPI,
        `Date: ${istDateLine(2)}`, 'UPI Ref No: DEMO123456'
      ].join('\n'),
      confidence: 90,
    });
    runAmountRecoveryOCR.mockResolvedValue([120]);
    const result = await verifyPayment('pay-1', Buffer.from('img'));
    const statuses = (db.state.updates.payments || []).map(u => u.status);
    console.log('VERIFICATION_DIAGNOSTIC', JSON.stringify({ flow: 'demo-rejected', decision: result.decision, reason: result.reason, persistedStatuses: statuses }));
    expect(result.decision).toBe('rejected');
    expect(result.reason).toBe('DEMO_SCREENSHOT');
    expect(statuses).toContain('rejected');
    expect(statuses.every(s => s !== 'manual_review' && s !== 'approved')).toBe(true);
  });

  it('SAMPLE screenshot -> rejected with DEMO_SCREENSHOT', async () => {
    resetDbForDemo();
    runOCR.mockResolvedValue({
      text: [
        'PhonePe', 'SAMPLE', 'Transaction Successful',
        '₹120', `Paid to ${RECEIVER_UPI}`,
        '25/08/2026, 9:50 AM', 'UTR: SAMP123456789'
      ].join('\n'),
      confidence: 88,
    });
    runAmountRecoveryOCR.mockResolvedValue([120]);
    const result = await verifyPayment('pay-1', Buffer.from('img'));
    expect(result.decision).toBe('rejected');
    expect(result.reason).toBe('DEMO_SCREENSHOT');
  });

  it('TEST payment screenshot -> rejected with DEMO_SCREENSHOT', async () => {
    resetDbForDemo();
    runOCR.mockResolvedValue({
      text: [
        'UPI', 'TEST PAYMENT', 'Completed',
        '₹120', RECEIVER_UPI,
        'Ref No: TEST999888', '25/08/2026, 9:50 AM'
      ].join('\n'),
      confidence: 85,
    });
    runAmountRecoveryOCR.mockResolvedValue([120]);
    const result = await verifyPayment('pay-1', Buffer.from('img'));
    expect(result.decision).toBe('rejected');
    expect(result.reason).toBe('DEMO_SCREENSHOT');
  });
});
