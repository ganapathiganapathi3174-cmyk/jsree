import { describe, it, expect, vi, beforeEach } from 'vitest';

const { supabaseMock, runOCR, runAdditionalOCRPasses, runAmountRecoveryOCR, runDeepAmountRecovery, preprocessImage } = vi.hoisted(() => {
  process.env.ADMIN_RECEIVER_NAME = process.env.ADMIN_RECEIVER_NAME || 'Jayaraj';
  process.env.ADMIN_UPI_ID = process.env.ADMIN_UPI_ID || 'jayarajj126-3@okicici';
  process.env.SENDER_NAME_POLICY = process.env.SENDER_NAME_POLICY || 'off';
  // Provider confirmation is mandatory for approval: the mock provider
  // confirms any transaction carrying a UTR reference (>= 6 chars).
  process.env.PAYMENT_PROVIDER_MODE = 'mock';
  delete process.env.PAYMENT_PROVIDER_MOCK_TIMEOUT;
  return {
    supabaseMock: { from: vi.fn() },
    runOCR: vi.fn(),
    runAdditionalOCRPasses: vi.fn(),
    runAmountRecoveryOCR: vi.fn(),
    runDeepAmountRecovery: vi.fn(),
    preprocessImage: vi.fn(),
  };
});

vi.mock('../../db/supabase.js', () => ({ supabase: supabaseMock }));
vi.mock('../../services/paymentVerificationV2/ocrExtraction.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runOCR,
    runAdditionalOCRPasses,
    runAmountRecoveryOCR,
    runDeepAmountRecovery,
    preprocessImage,
  };
});

import { paymentVerificationEngine } from '../../services/paymentVerificationV2/index.js';
import { decidePaymentVerification } from '../../services/paymentVerificationV2/decisionEngine.js';
import { reserveApprovedUtr } from '../../services/paymentVerificationV2/duplicateDetection.js';

const RECEIVER_UPI = 'jayarajj126-3@okicici';
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function makeChain(result) {
  const obj = {};
  for (const m of ['select', 'eq', 'neq', 'in', 'order', 'update', 'delete', 'insert']) obj[m] = vi.fn(() => obj);
  obj.limit = vi.fn(async () => ({ data: result, error: null }));
  obj.single = vi.fn(async () => ({ data: result, error: null }));
  obj.maybeSingle = vi.fn(async () => ({ data: result?.data ?? null, error: result?.error ?? null }));
  return obj;
}

function line(minutesAgo = 2, dayOffset = 0) {
  const d = new Date(Date.now() + dayOffset * 86400000 - minutesAgo * 60000 + 5.5 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  const h24 = d.getUTCHours();
  const h = h24 % 12 || 12;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}, ${h}:${pad(d.getUTCMinutes())} ${ampm}`;
}

// Today's IST calendar date as a wall-clock stamp at a GIVEN hour/minute —
// used to prove time-of-day is never validated (early morning, late night,
// even a future time within the current IST day).
function todayIstStamp(hour, minute = 0) {
  const ist = new Date(Date.now() + 5.5 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${pad(ist.getUTCDate())}/${pad(ist.getUTCMonth() + 1)}/${ist.getUTCFullYear()}, ${h12}:${pad(minute)} ${ampm}`;
}

// Today's IST calendar date with NO time printed (date-only receipt).
function todayIstDateOnly() {
  const ist = new Date(Date.now() + 5.5 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(ist.getUTCDate())}/${pad(ist.getUTCMonth() + 1)}/${ist.getUTCFullYear()}`;
}

function receiptText({ amount = 120, upi = RECEIVER_UPI, utr = 'UTR123456', receiver = 'Jayaraj', status = 'success', date, dateOnly = false } = {}) {
  const dateLine = dateOnly ? `Date: ${todayIstDateOnly()}` : `Date: ${date || line(2)}`;
  const lines = ['Payment Successful', `Rs. ${amount}`, `To ${receiver}`, upi, dateLine, `UPI transaction ID: ${utr}`];
  if (status === 'failed') lines[0] = 'Payment Failed';
  if (status === 'declined') lines[0] = 'Payment Declined';
  return lines.join('\n');
}

async function verify(overrides = {}) {
  const result = await paymentVerificationEngine.verify({
    imageBuffer: overrides.imageBuffer || TINY_PNG,
    purpose: 'topup',
    paymentRequest: {
      type: 'topup',
      expectedAmount: overrides.amount ?? 120,
      paymentId: 'topup-1',
      userId: 'user-1',
      receiverName: 'Jayaraj',
      receiverUpi: RECEIVER_UPI,
      expectedPayerName: null,
      senderPolicy: 'off',
    },
    serverTime: overrides.serverTime,
    timeoutMs: 60000,
    skipIntegrityCheck: overrides.skipIntegrityCheck ?? false,
  });
  return result;
}

describe('paymentVerificationV2 engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preprocessImage.mockResolvedValue(TINY_PNG);
    runAdditionalOCRPasses.mockResolvedValue([]);
    runAmountRecoveryOCR.mockResolvedValue([]);
    runDeepAmountRecovery.mockResolvedValue([]);
    supabaseMock.from.mockImplementation(() => makeChain([]));
  });

  describe('flat decision rule (decidePaymentVerification)', () => {
    it('approves when every gate passes', () => {
      expect(decidePaymentVerification({
        upiMatch: true, amountMatch: true, dateValid: true, utrPresent: true,
        transactionStatusOk: true, ocrConfidence: 90, receiverName: 'Jayaraj', nameMatch: true, nameFound: true, nameConfigured: true,
      })).toEqual({ decision: 'approved', reason: null });
    });

    it('receiver UPI mismatch is informational — never rejects', () => {
      expect(decidePaymentVerification({
        upiMatch: false, amountMatch: true, dateValid: true, utrPresent: true,
        transactionStatusOk: true, ocrConfidence: 90, receiverName: 'Jayaraj', nameMatch: true, nameFound: true, nameConfigured: true,
      })).toEqual({ decision: 'approved', reason: null });
    });

    it('rejects amount mismatch (amount was read)', () => {
      expect(decidePaymentVerification({
        upiMatch: true, amountMatch: false, amountDetected: true, dateValid: true, utrPresent: true,
        transactionStatusOk: true, ocrConfidence: 90, receiverName: 'Jayaraj', nameMatch: true, nameFound: true, nameConfigured: true,
      })).toEqual({ decision: 'rejected', reason: 'AMOUNT_MISMATCH' });
    });

    it('manual-reviews (never approves) when no amount was read', () => {
      expect(decidePaymentVerification({
        upiMatch: true, amountMatch: false, amountDetected: false, dateValid: true, utrPresent: true,
        transactionStatusOk: true, ocrConfidence: 90, receiverName: 'Jayaraj', nameMatch: true, nameFound: true, nameConfigured: true,
      })).toEqual({ decision: 'manual_review', reason: 'AMOUNT_NOT_DETECTED' });
    });

    it('manual-reviews when date could not be detected', () => {
      expect(decidePaymentVerification({
        upiMatch: true, amountMatch: true, dateValid: false, dateDetected: false, utrPresent: true,
        transactionStatusOk: true, ocrConfidence: 90, receiverName: 'Jayaraj', nameMatch: true, nameFound: true, nameConfigured: true,
      })).toEqual({ decision: 'manual_review', reason: 'PAYMENT_DATE_NOT_DETECTED' });
    });

    it('rejects when transaction status is not success', () => {
      expect(decidePaymentVerification({
        upiMatch: true, amountMatch: true, dateValid: true, utrPresent: true,
        transactionStatusOk: false, ocrConfidence: 90, receiverName: 'Jayaraj', nameMatch: true, nameFound: true, nameConfigured: true,
      })).toEqual({ decision: 'rejected', reason: 'TRANSACTION_FAILED' });
    });

    it('rejects when UTR is missing', () => {
      expect(decidePaymentVerification({
        upiMatch: true, amountMatch: true, dateValid: true, utrPresent: false,
        transactionStatusOk: true, ocrConfidence: 90, receiverName: 'Jayaraj', nameMatch: true, nameFound: true, nameConfigured: true,
      })).toEqual({ decision: 'rejected', reason: 'MISSING_UTR' });
    });

    it('rejects below the OCR confidence floor', () => {
      expect(decidePaymentVerification({
        upiMatch: true, amountMatch: true, dateValid: true, utrPresent: true,
        transactionStatusOk: true, ocrConfidence: 20, receiverName: 'Jayaraj', nameMatch: true, nameFound: true, nameConfigured: true,
      })).toEqual({ decision: 'rejected', reason: 'LOW_OCR_CONFIDENCE' });
    });

    it('receiver name mismatch is informational — never rejects', () => {
      expect(decidePaymentVerification({
        upiMatch: true, amountMatch: true, dateValid: true, utrPresent: true,
        transactionStatusOk: true, ocrConfidence: 90, receiverName: 'Jayaraj', nameMatch: false, nameFound: true, nameConfigured: true,
      })).toEqual({ decision: 'approved', reason: null });
    });

    it('unreadable/partial receiver name is informational — never parks', () => {
      expect(decidePaymentVerification({
        upiMatch: true, amountMatch: true, dateValid: true, utrPresent: true,
        transactionStatusOk: true, ocrConfidence: 90, receiverName: 'Jayaraj', nameMatch: false, nameFound: false, namePartial: true, nameConfigured: true,
      })).toEqual({ decision: 'approved', reason: null });
      expect(decidePaymentVerification({
        upiMatch: true, amountMatch: true, dateValid: true, utrPresent: true,
        transactionStatusOk: true, ocrConfidence: 90, receiverName: 'Jayaraj', nameMatch: false, nameFound: false, nameConfigured: true,
      })).toEqual({ decision: 'approved', reason: null });
    });
  });

  describe('engine: APPROVED happy path', () => {
    it('approves a valid, fresh, matching screenshot', async () => {
      runOCR.mockResolvedValue({ text: receiptText({ amount: 120 }), confidence: 90 });
      const v = await verify({ amount: 120 });
      expect(v.outcome).toBe('APPROVED');
      expect(v.approved).toBe(true);
      expect(v.inconclusive).toBe(false);
      expect(v.verificationResult.decision).toBe('approved');
      expect(v.verificationResult.status).toBe('APPROVED');
      expect(v.transactionId).toBe('UTR123456');
    });

    it('rejects amount mismatch', async () => {
      runOCR.mockResolvedValue({ text: receiptText({ amount: 999 }), confidence: 90 });
      const v = await verify({ amount: 120 });
      expect(v.outcome).toBe('REJECTED');
      expect(v.reason).toBe('AMOUNT_MISMATCH');
      expect(v.approved).toBe(false);
      expect(v.inconclusive).toBe(false);
      expect(v.verificationResult.decision).toBe('rejected');
    });
  });

  describe('engine: DUPLICATE_UTR rejection', () => {
    it('rejects a reused UTR', async () => {
      supabaseMock.from.mockImplementation((t) =>
        t === 'approved_utrs'
          ? makeChain([{ utr: 'UTR123456', reference_type: 'payment', reference_id: 'other-payment' }])
          : makeChain([]));
      runOCR.mockResolvedValue({ text: receiptText({ amount: 120 }), confidence: 90 });
      const v = await verify({ amount: 120 });
      expect(v.outcome).toBe('REJECTED');
      expect(v.reason).toBe('DUPLICATE_UTR');
    });
  });

  describe('engine: transaction date (IST day only — time never checked)', () => {
    it('rejects a receipt dated on a previous IST day', async () => {
      runOCR.mockResolvedValue({ text: receiptText({ amount: 120, date: line(2, -1) }), confidence: 90 });
      const v = await verify({ amount: 120, serverTime: new Date() });
      expect(v.outcome).toBe('REJECTED');
      expect(v.approved).toBe(false);
      expect(v.reason).toBe('INVALID_PAYMENT_DATE');
      expect(v.details?.variant).toBe('INVALID_PAYMENT_DATE_NOT_TODAY');
    });

    it('rejects a receipt dated tomorrow (no future-date tolerance)', async () => {
      runOCR.mockResolvedValue({ text: receiptText({ amount: 120, date: line(2, 1) }), confidence: 90 });
      const v = await verify({ amount: 120, serverTime: new Date() });
      expect(v.outcome).toBe('REJECTED');
      expect(v.approved).toBe(false);
      expect(v.details?.variant).toBe('INVALID_PAYMENT_DATE_NOT_TODAY');
    });

    it('accepts an early-morning same-day receipt (time of day irrelevant)', async () => {
      runOCR.mockResolvedValue({ text: receiptText({ amount: 120, date: todayIstStamp(0, 5) }), confidence: 90 });
      const v = await verify({ amount: 120, serverTime: new Date() });
      expect(v.outcome).toBe('APPROVED');
      expect(v.checks.transactionDate.passed).toBe(true);
    });

    it('accepts a same-day receipt with a FUTURE time-of-day (no clock-skew check)', async () => {
      runOCR.mockResolvedValue({ text: receiptText({ amount: 120, date: todayIstStamp(23, 55) }), confidence: 90 });
      const v = await verify({ amount: 120, serverTime: new Date() });
      expect(v.outcome).toBe('APPROVED');
      expect(v.checks.transactionDate.passed).toBe(true);
    });

    it('accepts a date-only receipt (no printed time) for the current IST date', async () => {
      runOCR.mockResolvedValue({ text: receiptText({ amount: 120, dateOnly: true }), confidence: 90 });
      const v = await verify({ amount: 120, serverTime: new Date() });
      expect(v.outcome).toBe('APPROVED');
      expect(v.checks.transactionDate.passed).toBe(true);
      expect(v.reason).not.toBe('PAYMENT_TIME_NOT_DETECTED');
      expect(v.reason).not.toBe('PAYMENT_DATE_NOT_DETECTED');
    });
  });

  describe('engine: receiver UPI is informational (never a rejection gate)', () => {
    it('does not reject on an OCR UPI mismatch — records an advisory check', async () => {
      runOCR.mockResolvedValue({ text: receiptText({ amount: 120, upi: 'attacker@paytm' }), confidence: 90 });
      const v = await verify({ amount: 120 });
      expect(v.outcome).toBe('APPROVED');
      expect(v.approved).toBe(true);
      expect(v.checks.receiverUpi.passed).toBe(false);
      expect(v.checks.receiverUpi.advisory).toBe(true);
      expect(v.checks.receiverUpi.reason).toBe('UPI_MISMATCH');
      expect(v.checks.receiverUpi.expected).toBe(RECEIVER_UPI);
      expect(v.checks.receiverUpi.detected).toBe('attacker@paytm');
    });
  });

  describe('engine: receiver name is informational (never a gate)', () => {
    it('does not reject a wrong receiver name — records it as advisory', async () => {
      runOCR.mockResolvedValue({ text: receiptText({ amount: 120, receiver: 'Someone Else' }), confidence: 90 });
      const v = await verify({ amount: 120 });
      expect(v.outcome).toBe('APPROVED');
      expect(v.approved).toBe(true);
      expect(v.checks.receiverName.passed).toBe(false);
      expect(v.checks.receiverName.advisory).toBe(true);
      expect(v.checks.receiverName.reason).toBe('RECEIVER_NAME_MISMATCH');
      expect(v.checks.receiverName.expected).toBe('Jayaraj');
      expect(v.checks.receiverName.detected).toBe('Someone Else');
    });

    it('does not park when the receiver name is unreadable', async () => {
      runOCR.mockResolvedValue({ text: receiptText({ amount: 120, receiver: '' }), confidence: 90 });
      const v = await verify({ amount: 120 });
      expect(v.approved).toBe(true);
      expect(v.outcome).toBe('APPROVED');
      expect(v.checks.receiverName.passed).toBe(false);
      expect(v.checks.receiverName.advisory).toBe(true);
      expect(v.checks.receiverName.reason).toBe('RECEIVER_NAME_UNREADABLE');
    });

    it('recognizes Jayaraj variants with additional names (advisory MATCH)', async () => {
      runOCR.mockResolvedValue({ text: receiptText({ amount: 120, receiver: 'JAYA RAJ ALAGAR' }), confidence: 90 });
      const v = await verify({ amount: 120 });
      expect(v.outcome).toBe('APPROVED');
      expect(v.checks.receiverName.passed).toBe(true);
      expect(v.checks.receiverName.advisory).toBe(true);
      expect(v.checks.receiverName.method).toBeTruthy();
    });
  });

  describe('engine: provider gating (auto-approve requires provider confirmation)', () => {
    it('parks as MANUAL_REVIEW when no payment provider is configured', async () => {
      const prev = process.env.PAYMENT_PROVIDER_MODE;
      process.env.PAYMENT_PROVIDER_MODE = 'none';
      try {
        runOCR.mockResolvedValue({ text: receiptText({ amount: 120 }), confidence: 90 });
        const v = await verify({ amount: 120 });
        expect(v.outcome).toBe('MANUAL_REVIEW');
        expect(v.approved).toBe(false);
        expect(v.inconclusive).toBe(false);
        expect(v.reason).toBe('PROVIDER_NOT_CONFIGURED');
        expect(v.verificationResult.decision).toBe('manual_review');
        expect(v.verificationResult.status).toBe('MANUAL_REVIEW');
      } finally {
        if (prev === undefined) delete process.env.PAYMENT_PROVIDER_MODE;
        else process.env.PAYMENT_PROVIDER_MODE = prev;
      }
    });

    it('approves only when the provider confirms the transaction', async () => {
      runOCR.mockResolvedValue({ text: receiptText({ amount: 120 }), confidence: 90 });
      const v = await verify({ amount: 120 });
      expect(v.outcome).toBe('APPROVED');
      expect(v.provider?.verified).toBe(true);
      expect(v.verificationResult.decision).toBe('approved');
    });
  });

  describe('engine: integrity + OCR failures', () => {
    it('rejects an invalid screenshot', async () => {
      const v = await verify({ imageBuffer: Buffer.from('not-an-image'), skipIntegrityCheck: false });
      expect(v.outcome).toBe('REJECTED');
      expect(v.reason).toBe('IMAGE_INTEGRITY_FAILED');
      expect(v.inconclusive).toBe(false);
    });

    it('stays inconclusive (never approves) when OCR fails', async () => {
      runOCR.mockRejectedValue({ code: 'OCR_FAILED', message: 'ocr down' });
      const v = await verify({ amount: 120 });
      expect(v.approved).toBe(false);
      expect(v.inconclusive).toBe(true);
      expect(v.outcome).toBe('PENDING_VERIFICATION');
      expect(v.reason).toBe('OCR_FAILED');
    });

    it('rejects when OCR confidence is low', async () => {
      runOCR.mockResolvedValue({ text: receiptText({ amount: 120 }), confidence: 20 });
      const v = await verify({ amount: 120 });
      expect(v.approved).toBe(false);
      expect(v.inconclusive).toBe(false);
      expect(v.outcome).toBe('REJECTED');
      expect(v.reason).toBe('LOW_OCR_CONFIDENCE');
    });
  });

  describe('engine: atomic UTR reservation', () => {
    it('reserves an approved UTR and reports duplicates', async () => {
      supabaseMock.from.mockImplementation(() => makeChain({ data: { utr: 'UTR123456' }, error: null }));
      const ok = await reserveApprovedUtr('UTR123456', 'topup', 'topup-1');
      expect(ok.reserved).toBe(true);
      expect(ok.duplicate).toBe(false);
      expect(ok.utr).toBe('UTR123456');

      supabaseMock.from.mockImplementation(() => makeChain({ data: null, error: { code: '23505' } }));
      const dup = await reserveApprovedUtr('UTR123456', 'topup', 'topup-1');
      expect(dup.reserved).toBe(false);
      expect(dup.duplicate).toBe(true);
      expect(dup.utr).toBe('UTR123456');
    });
  });
});
