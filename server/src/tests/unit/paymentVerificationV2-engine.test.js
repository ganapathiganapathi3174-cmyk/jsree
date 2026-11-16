import { describe, it, expect, vi, beforeEach } from 'vitest';

const { supabaseMock, runOCR, runAdditionalOCRPasses, runAmountRecoveryOCR, runDeepAmountRecovery, preprocessImage } = vi.hoisted(() => {
  process.env.ADMIN_RECEIVER_NAME = process.env.ADMIN_RECEIVER_NAME || 'Jayaraj';
  process.env.ADMIN_UPI_ID = process.env.ADMIN_UPI_ID || 'jayarajj126-3@okicici';
  process.env.SENDER_NAME_POLICY = process.env.SENDER_NAME_POLICY || 'off';
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

function receiptText({ amount = 120, upi = RECEIVER_UPI, utr = 'UTR123456', receiver = 'Jayaraj', status = 'success', date } = {}) {
  const lines = ['Payment Successful', `Rs. ${amount}`, `To ${receiver}`, upi, `Date: ${date || line(2)}`, `UPI transaction ID: ${utr}`];
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

    it('rejects on UPI mismatch', () => {
      expect(decidePaymentVerification({
        upiMatch: false, amountMatch: true, dateValid: true, utrPresent: true,
        transactionStatusOk: true, ocrConfidence: 90, receiverName: 'Jayaraj', nameMatch: true, nameFound: true, nameConfigured: true,
      })).toEqual({ decision: 'rejected', reason: 'UPI_MISMATCH' });
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

  describe('engine: timestamp gates', () => {
    it('rejects a future transaction timestamp', async () => {
      runOCR.mockResolvedValue({ text: receiptText({ amount: 120, date: line(2, 1) }), confidence: 90 });
      const v = await verify({ amount: 120, serverTime: new Date(Date.now() + 3600000) });
      expect(v.outcome).toBe('REJECTED');
      expect(v.approved).toBe(false);
      expect(v.details?.variant).toBe('INVALID_PAYMENT_DATE_FUTURE');
    });

    it('rejects a transaction older than the payment window', async () => {
      runOCR.mockResolvedValue({ text: receiptText({ amount: 120, date: line(45) }), confidence: 90 });
      const v = await verify({ amount: 120, serverTime: new Date() });
      expect(v.outcome).toBe('REJECTED');
      expect(v.approved).toBe(false);
      expect(v.details?.variant).toBe('INVALID_PAYMENT_DATE_TOO_OLD');
    });
  });

  describe('engine: receiver / identity gates', () => {
    it('rejects a wrong receiver name', async () => {
      runOCR.mockResolvedValue({ text: receiptText({ amount: 120, receiver: 'Someone Else' }), confidence: 90 });
      const v = await verify({ amount: 120 });
      expect(v.outcome).toBe('REJECTED');
      expect(v.reason).toBe('RECEIVER_NAME_MISMATCH');
    });

    it('never approves when the receiver name is unreadable', async () => {
      runOCR.mockResolvedValue({ text: receiptText({ amount: 120, receiver: '' }), confidence: 90 });
      const v = await verify({ amount: 120 });
      expect(v.approved).toBe(false);
      expect(v.inconclusive).toBe(true);
      expect(v.outcome).toBe('PENDING_VERIFICATION');
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
