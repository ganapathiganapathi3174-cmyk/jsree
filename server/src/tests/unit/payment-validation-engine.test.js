import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses, runDeepAmountRecovery } = vi.hoisted(() => {
  if (!process.env.ADMIN_RECEIVER_NAME) {
    process.env.ADMIN_RECEIVER_NAME = 'Jayaraj';
  }
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
  const state = { results: {} };
  const builder = (table) => {
    const p = {
      select: () => p, eq: () => p, neq: () => p, in: () => p, or: () => p, order: () => p,
      limit: () => p, single: () => p, maybeSingle: () => p,
      insert: () => p, update: () => p, delete: () => p,
      then: (res, rej) => Promise.resolve(state.results[table] || { data: [], error: null }).then(res, rej),
      catch: (fn) => p.then(undefined, fn),
    };
    return p;
  };
  return { db: { state, from: (t) => builder(t) } };
});

vi.mock('../../db/supabase.js', () => {
  const client = { from: (t) => db.from(t) };
  return { supabase: client, supabaseAnon: {}, default: client };
});

import { validateImageIntegrity } from '../../services/paymentValidation/stage1Integrity.js';
import {
  validateAmount,
  validateReceiver,
  validateDateTime,
  validateTransactionId,
} from '../../services/paymentValidation/stageValidation.js';
import { checkDuplicateTransaction } from '../../services/paymentValidation/stageDuplicate.js';
import {
  ValidationDecisionEngine,
  isInconclusiveReason,
  codeForInconclusive,
  userMessageFor,
} from '../../services/paymentValidation/decisionEngine.js';
import { paymentValidationEngine } from '../../services/paymentValidationService.js';
import { istWallClockParts } from '../../utils/paymentNormalize.js';

const RECEIVER_UPI = 'jayarajj126-3@okicici';
const RECEIVER_NAME = 'Jayaraj';

const VALID_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function dateEntry(minutesBefore = 2) {
  const d = new Date(Date.now() - minutesBefore * 60000);
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    second: 0,
    hasTime: true,
  };
}

function istDateLine(minutesBefore = 2) {
  const ist = new Date(Date.now() - minutesBefore * 60000 + 5.5 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  let h = ist.getUTCHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${pad(ist.getUTCDate())}/${pad(ist.getUTCMonth() + 1)}/${ist.getUTCFullYear()}, ${h}:${pad(ist.getUTCMinutes())} ${ap}`;
}

function receiptText({ amount = '120', upi = RECEIVER_UPI, name = 'Jayaraj', utr = 'TTEST123456', date = istDateLine(), status = 'Payment Successful', extra = '' } = {}) {
  return [
    status,
    `\u20B9${amount}`,
    `To ${name}`,
    upi,
    `Date: ${date}`,
    `UPI transaction ID: ${utr}`,
    extra,
  ].filter(Boolean).join('\n');
}

const baseExtraction = (over = {}) => ({
  success: true,
  unreadable: false,
  ocrText: receiptText(),
  ocrConfidence: 90,
  extractedAmounts: ['120'],
  extractedUPIs: [RECEIVER_UPI],
  extractedUTRs: ['TTEST123456'],
  extractedDateTimes: [dateEntry()],
  extractedReceiverNames: ['Jayaraj'],
  transactionStatus: { status: 'success', matched: 'Payment Successful' },
  ...over,
});

const basePaymentRequest = (over = {}) => ({
  type: 'registration',
  expectedAmount: 120,
  paymentId: 'pay-1',
  userId: 'user-1',
  receiverName: RECEIVER_NAME,
  receiverUpi: RECEIVER_UPI,
  ...over,
});

async function decideWith(overrides = {}) {
  const extraction = 'extraction' in overrides ? overrides.extraction : baseExtraction();
  const paymentRequest = 'paymentRequest' in overrides ? overrides.paymentRequest : basePaymentRequest();
  const engine = new ValidationDecisionEngine();
  return engine.decide({
    integrity: 'integrity' in overrides ? overrides.integrity : { valid: true, errors: [], warnings: [] },
    extraction,
    amountValidation: 'amountValidation' in overrides
      ? overrides.amountValidation
      : validateAmount(extraction.extractedAmounts, paymentRequest.expectedAmount),
    receiverValidation: 'receiverValidation' in overrides
      ? overrides.receiverValidation
      : validateReceiver(extraction.extractedReceiverNames, paymentRequest.receiverName),
    dateTimeValidation: 'dateTimeValidation' in overrides
      ? overrides.dateTimeValidation
      : validateDateTime(extraction.extractedDateTimes?.[0], new Date()),
    transactionIdValidation: 'transactionIdValidation' in overrides
      ? overrides.transactionIdValidation
      : validateTransactionId(extraction.extractedUTRs),
    duplicateCheck: 'duplicateCheck' in overrides ? overrides.duplicateCheck : { isDuplicate: false },
    paymentRequest,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.state.results = {};
  runOCR.mockResolvedValue({ text: receiptText(), confidence: 90 });
  runAmountRecoveryOCR.mockResolvedValue([]);
  runAdditionalOCRPasses.mockResolvedValue([]);
  runDeepAmountRecovery.mockResolvedValue([]);
});

// ─────────────────────────────────────────────────────────────
// Stage 1: image integrity
// ─────────────────────────────────────────────────────────────
describe('stage1 integrity: magic bytes + decode probe + hash', () => {
  it('valid PNG passes with a sha256 hash and size', async () => {
    const r = await validateImageIntegrity(VALID_IMAGE, { mimetype: 'image/png' });
    expect(r.valid).toBe(true);
    expect(r.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.size).toBe(VALID_IMAGE.length);
  });

  it('non-buffer and empty buffer fail closed', async () => {
    expect((await validateImageIntegrity(null)).valid).toBe(false);
    expect((await validateImageIntegrity(Buffer.alloc(0))).valid).toBe(false);
  });

  it('text masquerading as an image is rejected by magic bytes', async () => {
    const r = await validateImageIntegrity(Buffer.from('definitely not an image'), { mimetype: 'image/png' });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Unsupported or corrupted image format/);
  });

  it('truncated payload with a valid PNG header fails the decode probe', async () => {
    const r = await validateImageIntegrity(VALID_IMAGE.slice(0, 24), { mimetype: 'image/png' });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/could not be decoded/);
  });

  it('oversized uploads are rejected before any decoding', async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0x41);
    const r = await validateImageIntegrity(big, { mimetype: 'image/png' });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/maximum size of 5MB/);
  });
});

// ─────────────────────────────────────────────────────────────
// Content validators
// ─────────────────────────────────────────────────────────────
describe('amount validator: exact, corruption recovery, conflict, missing', () => {
  it('exact match approves', () => {
    const r = validateAmount(['120'], 120);
    expect(r).toMatchObject({ valid: true, method: 'exact', matchedAmount: 120 });
  });

  it('accepts the documented ₹->2 OCR corruption as currency_corruption', () => {
    const r = validateAmount(['2120'], 120);
    expect(r).toMatchObject({ valid: true, method: 'currency_corruption', matchedAmount: 120 });
  });

  it('conflicting distinct readings with no exact match reject CONFLICTING_AMOUNTS', () => {
    const r = validateAmount(['500', '600'], 120);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('CONFLICTING_AMOUNTS');
  });

  it('single wrong reading rejects AMOUNT_MISMATCH', () => {
    expect(validateAmount(['500'], 120)).toMatchObject({ valid: false, reason: 'AMOUNT_MISMATCH' });
  });

  it('no reading is AMOUNT_NOT_DETECTED; no expected amount is a config failure', () => {
    expect(validateAmount([], 120)).toMatchObject({ valid: false, reason: 'AMOUNT_NOT_DETECTED' });
    expect(validateAmount(['120'], undefined)).toMatchObject({ valid: false, reason: 'MISSING_EXPECTED_AMOUNT' });
  });
});

describe('receiver name validator: match, mismatch, unreadable, not configured', () => {
  it('exact/compact match approves', () => {
    expect(validateReceiver(['Jayaraj'], 'Jayaraj')).toMatchObject({ valid: true });
    expect(validateReceiver(['jayaraj'], 'Jayaraj')).toMatchObject({ valid: true });
  });

  it('a confidently different payee rejects RECEIVER_NAME_MISMATCH', () => {
    const r = validateReceiver(['Wrong Person'], 'Jayaraj');
    expect(r).toMatchObject({ valid: false, reason: 'RECEIVER_NAME_MISMATCH' });
  });

  it('no detected name is RECEIVER_NAME_UNREADABLE', () => {
    expect(validateReceiver([], 'Jayaraj')).toMatchObject({ valid: false, reason: 'RECEIVER_NAME_UNREADABLE' });
  });

  it('empty server config is RECEIVER_NAME_NOT_CONFIGURED (never a silent approve)', () => {
    expect(validateReceiver(['Jayaraj'], '')).toMatchObject({ valid: false, reason: 'RECEIVER_NAME_NOT_CONFIGURED' });
  });
});

describe('date/time validator: freshness window + IST calendar day', () => {
  it('a receipt within the window approves', () => {
    expect(validateDateTime(dateEntry(2), new Date())).toMatchObject({ valid: true });
  });

  it('stale receipt is INVALID_PAYMENT_DATE_TOO_OLD', () => {
    expect(validateDateTime(dateEntry(90), new Date())).toMatchObject({ valid: false, reason: 'INVALID_PAYMENT_DATE_TOO_OLD' });
  });

  it('future timestamp is INVALID_PAYMENT_DATE_FUTURE', () => {
    expect(validateDateTime(dateEntry(-5), new Date())).toMatchObject({ valid: false, reason: 'INVALID_PAYMENT_DATE_FUTURE' });
  });

  it('missing date and missing time are distinct inconclusive outcomes', () => {
    expect(validateDateTime(null, new Date())).toMatchObject({ valid: false, reason: 'PAYMENT_DATE_NOT_DETECTED' });
    const noTime = { ...dateEntry(2), hasTime: false };
    expect(validateDateTime(noTime, new Date())).toMatchObject({ valid: false, reason: 'PAYMENT_TIME_NOT_DETECTED' });
  });
});

describe('transaction id validator', () => {
  it('long reference is accepted', () => {
    expect(validateTransactionId(['TTEST123456'])).toMatchObject({ valid: true, transactionId: 'TTEST123456' });
  });

  it('missing or too-short references reject MISSING_UTR', () => {
    expect(validateTransactionId([])).toMatchObject({ valid: false, reason: 'MISSING_UTR' });
    expect(validateTransactionId(['ab'])).toMatchObject({ valid: false, reason: 'MISSING_UTR' });
  });
});

// ─────────────────────────────────────────────────────────────
// Stage 8: duplicate pre-check (advisory; atomic reservation is authoritative)
// ─────────────────────────────────────────────────────────────
describe('duplicate pre-check: cross-flow lookup + fail-reporting', () => {
  it('no transaction id short-circuits to not-duplicate', async () => {
    expect(await checkDuplicateTransaction('', null, null)).toEqual({ isDuplicate: false });
  });

  it('an already-approved UTR is a duplicate', async () => {
    db.state.results.approved_utrs = {
      data: [{ utr: 'TTEST123456', reference_type: 'payment', reference_id: 'pay-OTHER' }],
      error: null,
    };
    const r = await checkDuplicateTransaction('TTEST123456', 'pay-1', null);
    expect(r.isDuplicate).toBe(true);
  });

  it('a lookup failure reports dbError instead of "not a duplicate"', async () => {
    db.state.results.approved_utrs = { data: null, error: { message: 'connection reset' } };
    const r = await checkDuplicateTransaction('TTEST123456', 'pay-1', null);
    expect(r.isDuplicate).toBe(false);
    expect(r.dbError).toBeTruthy();
  });

  it('approved references on payments / top-ups are also duplicates', async () => {
    db.state.results.payments = {
      data: [{ id: 'pay-OTHER', transaction_id: 'TTEST123456', status: 'approved' }],
      error: null,
    };
    const viaPayments = await checkDuplicateTransaction('TTEST123456', 'pay-1', null);
    expect(viaPayments.isDuplicate).toBe(true);

    db.state.results.payments = { data: [], error: null };
    db.state.results.topups = {
      data: [{ id: 'top-OTHER', reference_id: 'TTEST123456', status: 'completed' }],
      error: null,
    };
    const viaTopups = await checkDuplicateTransaction('TTEST123456', null, 'top-1');
    expect(viaTopups.isDuplicate).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Decision engine: gate order + approved/inconclusive/rejected classification
// ─────────────────────────────────────────────────────────────
describe('decision engine: definitive gates', () => {
  it('all gates passed -> approved with the full checks payload', async () => {
    const r = await decideWith();
    expect(r.approved).toBe(true);
    expect(r.inconclusive).toBe(false);
    expect(r.transactionId).toBe('TTEST123456');
    expect(r.checks.amount.passed).toBe(true);
    expect(r.checks.receiverUpi.passed).toBe(true);
    expect(r.checks.transactionStatus.passed).toBe(true);
    expect(r.checks.ocrConfidence.passed).toBe(true);
  });

  it('image integrity failure is rejected BEFORE any content gate', async () => {
    const r = await decideWith({ integrity: { valid: false, errors: ['Unsupported or corrupted image format'] } });
    expect(r).toMatchObject({ approved: false, inconclusive: false, reason: 'IMAGE_INTEGRITY_FAILED' });
    expect(r.checks).toBeUndefined();
  });

  it('demo/sample screenshots reject DEMO_SCREENSHOT before content gates', async () => {
    const extraction = baseExtraction({ ocrText: receiptText({ extra: 'SAMPLE PAYMENT - DO NOT USE' }) });
    const r = await decideWith({ extraction });
    expect(r).toMatchObject({ approved: false, inconclusive: false, reason: 'DEMO_SCREENSHOT' });
  });

  it('wrong receiver UPI rejects UPI_MISMATCH and records the check', async () => {
    const extraction = baseExtraction({ extractedUPIs: ['attacker@paytm'] });
    const r = await decideWith({ extraction });
    expect(r).toMatchObject({ approved: false, inconclusive: false, reason: 'UPI_MISMATCH' });
    expect(r.checks.receiverUpi.passed).toBe(false);
  });

  it('wrong amount rejects AMOUNT_MISMATCH', async () => {
    const extraction = baseExtraction({ extractedAmounts: ['500'] });
    const r = await decideWith({ extraction });
    expect(r).toMatchObject({ approved: false, inconclusive: false, reason: 'AMOUNT_MISMATCH' });
  });

  it('stale date surfaces the legacy INVALID_PAYMENT_DATE reason (variant kept in details)', async () => {
    const extraction = baseExtraction({ extractedDateTimes: [dateEntry(90)] });
    const r = await decideWith({ extraction });
    expect(r).toMatchObject({ approved: false, inconclusive: false, reason: 'INVALID_PAYMENT_DATE' });
    expect(r.details.variant).toBe('INVALID_PAYMENT_DATE_TOO_OLD');
  });

  it('failed transaction status rejects TRANSACTION_FAILED', async () => {
    const extraction = baseExtraction({ transactionStatus: { status: 'failed', matched: 'Payment Failed' } });
    const r = await decideWith({ extraction });
    expect(r).toMatchObject({ approved: false, inconclusive: false, reason: 'TRANSACTION_FAILED' });
  });

  it('missing UTR rejects MISSING_UTR', async () => {
    const extraction = baseExtraction({ extractedUTRs: [] });
    const r = await decideWith({ extraction });
    expect(r).toMatchObject({ approved: false, inconclusive: false, reason: 'MISSING_UTR' });
  });

  it('low or missing OCR confidence rejects LOW_OCR_CONFIDENCE (never inconclusive)', async () => {
    const low = await decideWith({ extraction: baseExtraction({ ocrConfidence: 30 }) });
    expect(low).toMatchObject({ approved: false, inconclusive: false, reason: 'LOW_OCR_CONFIDENCE' });

    const missing = await decideWith({ extraction: baseExtraction({ ocrConfidence: undefined }) });
    expect(missing).toMatchObject({ approved: false, inconclusive: false, reason: 'LOW_OCR_CONFIDENCE' });
  });

  it('different payee name rejects RECEIVER_NAME_MISMATCH', async () => {
    const extraction = baseExtraction({ extractedReceiverNames: ['Wrong Person'] });
    const r = await decideWith({ extraction });
    expect(r).toMatchObject({ approved: false, inconclusive: false, reason: 'RECEIVER_NAME_MISMATCH' });
  });

  it('duplicate reference rejects DUPLICATE_TRANSACTION', async () => {
    const r = await decideWith({ duplicateCheck: { isDuplicate: true, source: 'approved_utrs' } });
    expect(r).toMatchObject({ approved: false, inconclusive: false, reason: 'DUPLICATE_TRANSACTION' });
  });

  it('a duplicate-pre-check DB error does NOT block (atomic reservation is authoritative)', async () => {
    const r = await decideWith({ duplicateCheck: { isDuplicate: false, dbError: 'connection reset' } });
    expect(r.approved).toBe(true);
    expect(r.auditLog.some(entry => entry.stage === 'duplicate')).toBe(true);
  });
});

describe('decision engine: inconclusive (insufficient evidence) never decides', () => {
  it('extraction failure is inconclusive OCR_FAILED', async () => {
    const r = await decideWith({ extraction: baseExtraction({ success: false }) });
    expect(r).toMatchObject({ approved: false, inconclusive: true, reason: 'OCR_FAILED', code: 'OCR_FAILED' });
  });

  it('unreadable screenshot is inconclusive OCR_UNREADABLE', async () => {
    const r = await decideWith({ extraction: baseExtraction({ unreadable: true, ocrText: 'x' }) });
    expect(r).toMatchObject({ approved: false, inconclusive: true, reason: 'OCR_UNREADABLE' });
  });

  it('undetected amount is inconclusive AMOUNT_NOT_DETECTED', async () => {
    const r = await decideWith({ extraction: baseExtraction({ extractedAmounts: [] }) });
    expect(r).toMatchObject({ approved: false, inconclusive: true, reason: 'AMOUNT_NOT_DETECTED', code: 'OCR_UNREADABLE' });
  });

  it('undetected date/time are inconclusive', async () => {
    const noDate = await decideWith({ extraction: baseExtraction({ extractedDateTimes: [] }) });
    expect(noDate).toMatchObject({ approved: false, inconclusive: true, reason: 'PAYMENT_DATE_NOT_DETECTED' });
  });

  it('missing receiver name is inconclusive; missing name config is inconclusive', async () => {
    const unreadable = await decideWith({ extraction: baseExtraction({ extractedReceiverNames: [] }) });
    expect(unreadable).toMatchObject({ approved: false, inconclusive: true, reason: 'RECEIVER_NAME_UNREADABLE' });

    const unconfigured = await decideWith({ paymentRequest: basePaymentRequest({ receiverName: '' }) });
    expect(unconfigured).toMatchObject({ approved: false, inconclusive: true, reason: 'RECEIVER_NAME_NOT_CONFIGURED' });
  });

  it('classification helpers agree with the contract', () => {
    expect(isInconclusiveReason('AMOUNT_NOT_DETECTED')).toBe(true);
    expect(isInconclusiveReason('RECEIVER_NAME_UNREADABLE')).toBe(true);
    expect(isInconclusiveReason('OCR_TIMEOUT')).toBe(false); // engine-level reason
    expect(isInconclusiveReason('AMOUNT_MISMATCH')).toBe(false);
    expect(isInconclusiveReason('LOW_OCR_CONFIDENCE')).toBe(false);
    expect(codeForInconclusive('AMOUNT_NOT_DETECTED')).toBe('OCR_UNREADABLE');
    expect(codeForInconclusive('OCR_TIMEOUT')).toBe('OCR_TIMEOUT');
    expect(userMessageFor('UPI_MISMATCH')).toMatch(/receiver UPI/i);
    expect(userMessageFor('UNKNOWN_REASON')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────
// Engine end-to-end (public entry point)
// ─────────────────────────────────────────────────────────────
describe('paymentValidationEngine.validatePayment: public contract', () => {
  const request = (over = {}) => basePaymentRequest(over);

  it('valid receipt through the full pipeline -> approved with checks and timings', async () => {
    const r = await paymentValidationEngine.validatePayment({
      imageBuffer: VALID_IMAGE,
      paymentRequest: request(),
      serverTime: new Date(),
      timeoutMs: 30000,
    });
    expect(r.success).toBe(true);
    expect(r.approved).toBe(true);
    expect(r.inconclusive).toBe(false);
    expect(r.transactionId).toBe('TTEST123456');
    expect(r.checks.amount.passed).toBe(true);
    expect(r.checks.receiverUpi.passed).toBe(true);
    expect(r.extractedData).toBeTruthy();
    expect(r.timings.total).toBeGreaterThanOrEqual(0);
  });

  it('garbage bytes -> definitive IMAGE_INTEGRITY_FAILED (no OCR attempted)', async () => {
    const r = await paymentValidationEngine.validatePayment({
      imageBuffer: Buffer.from('plainly not an image'),
      paymentRequest: request(),
    });
    expect(r).toMatchObject({ success: false, approved: false, inconclusive: false, reason: 'IMAGE_INTEGRITY_FAILED' });
    expect(runOCR).not.toHaveBeenCalled();
  });

  it('OCR exception -> inconclusive OCR_FAILED with user-facing message', async () => {
    runOCR.mockRejectedValue(new Error('worker crashed'));
    const r = await paymentValidationEngine.validatePayment({ imageBuffer: VALID_IMAGE, paymentRequest: request() });
    expect(r).toMatchObject({ success: false, approved: false, inconclusive: true, reason: 'OCR_FAILED', code: 'OCR_FAILED' });
    expect(r.message).toBeTruthy();
  });

  it('OCR budget overrun -> inconclusive OCR_TIMEOUT', async () => {
    runOCR.mockRejectedValue({ code: 'OCR_TIMEOUT', message: 'budget exhausted' });
    const r = await paymentValidationEngine.validatePayment({ imageBuffer: VALID_IMAGE, paymentRequest: request() });
    expect(r).toMatchObject({ success: false, inconclusive: true, reason: 'OCR_TIMEOUT', code: 'OCR_TIMEOUT' });
  });

  it('empty OCR output -> inconclusive OCR_UNREADABLE', async () => {
    runOCR.mockResolvedValue({ text: '', confidence: 0 });
    const r = await paymentValidationEngine.validatePayment({ imageBuffer: VALID_IMAGE, paymentRequest: request() });
    expect(r).toMatchObject({ approved: false, inconclusive: true, reason: 'OCR_UNREADABLE', code: 'OCR_UNREADABLE' });
  });

  it('wrong payee UPI -> definitive UPI_MISMATCH rejection', async () => {
    runOCR.mockResolvedValue({ text: receiptText({ upi: 'attacker@paytm' }), confidence: 90 });
    const r = await paymentValidationEngine.validatePayment({ imageBuffer: VALID_IMAGE, paymentRequest: request() });
    expect(r).toMatchObject({ success: true, approved: false, inconclusive: false, reason: 'UPI_MISMATCH' });
  });

  it('unreadable amount -> inconclusive AMOUNT_NOT_DETECTED after recovery passes', async () => {
    runOCR.mockResolvedValue({
      text: 'Payment Successful\nTo Jayaraj\njayarajj126-3@okicici\nDate: ' + istDateLine(),
      confidence: 80,
    });
    const r = await paymentValidationEngine.validatePayment({ imageBuffer: VALID_IMAGE, paymentRequest: request() });
    expect(r).toMatchObject({ approved: false, inconclusive: true, reason: 'AMOUNT_NOT_DETECTED' });
    expect(runAmountRecoveryOCR).toHaveBeenCalled();
    expect(runDeepAmountRecovery).toHaveBeenCalled();
  });

  it('stale receipt -> definitive INVALID_PAYMENT_DATE rejection', async () => {
    runOCR.mockResolvedValue({ text: receiptText({ date: istDateLine(90) }), confidence: 90 });
    const r = await paymentValidationEngine.validatePayment({ imageBuffer: VALID_IMAGE, paymentRequest: request() });
    expect(r).toMatchObject({ success: true, approved: false, inconclusive: false, reason: 'INVALID_PAYMENT_DATE' });
  });

  it('low confidence receipt -> definitive LOW_OCR_CONFIDENCE rejection', async () => {
    runOCR.mockResolvedValue({ text: receiptText(), confidence: 30 });
    const r = await paymentValidationEngine.validatePayment({ imageBuffer: VALID_IMAGE, paymentRequest: request() });
    expect(r).toMatchObject({ approved: false, inconclusive: false, reason: 'LOW_OCR_CONFIDENCE' });
  });

  it('demo markers reject DEMO_SCREENSHOT', async () => {
    runOCR.mockResolvedValue({ text: receiptText({ extra: 'SAMPLE PAYMENT - DO NOT USE' }), confidence: 90 });
    const r = await paymentValidationEngine.validatePayment({ imageBuffer: VALID_IMAGE, paymentRequest: request() });
    expect(r).toMatchObject({ approved: false, inconclusive: false, reason: 'DEMO_SCREENSHOT' });
  });

  it('missing server-side expected amount fails safe (inconclusive, never approved)', async () => {
    const r = await paymentValidationEngine.validatePayment({
      imageBuffer: VALID_IMAGE,
      paymentRequest: request({ expectedAmount: undefined }),
    });
    expect(r).toMatchObject({ approved: false, inconclusive: true, reason: 'MISSING_EXPECTED_AMOUNT' });
  });
});

// ─────────────────────────────────────────────────────────────
// AM/PM timestamp conversion — deterministic regression coverage.
// Every clock here is a fixed +05:30 instant: these tests pass (or fail)
// identically regardless of when they run or the machine's timezone.
// Guards the bug where validateDateTime ignored `ampm` and read 2:51 PM
// as 02:51, falsely rejecting every afternoon/evening receipt.
// ─────────────────────────────────────────────────────────────
describe('AM/PM timestamp conversion: validateDateTime (fixed clock)', () => {
  const at = (iso) => new Date(iso);
  const entry = (hour, minute, ampm, { day = 25, month = 10, year = 2026, second = 0 } = {}) => ({
    year, month, day, hour, minute, second, ampm, hasTime: true,
  });

  const CONVERSIONS = [
    { label: '12:00 AM -> 00:00', entry: entry(12, 0, 'AM'), receivedAt: '2026-10-25T00:10:00+05:30', hour: 0, minute: 0 },
    { label: '1:00 AM -> 01:00', entry: entry(1, 0, 'AM'), receivedAt: '2026-10-25T01:05:00+05:30', hour: 1, minute: 0 },
    { label: '11:59 AM -> 11:59', entry: entry(11, 59, 'AM'), receivedAt: '2026-10-25T11:59:30+05:30', hour: 11, minute: 59 },
    { label: '12:00 PM -> 12:00', entry: entry(12, 0, 'PM'), receivedAt: '2026-10-25T12:05:00+05:30', hour: 12, minute: 0 },
    { label: '1:00 PM -> 13:00', entry: entry(1, 0, 'PM'), receivedAt: '2026-10-25T13:05:00+05:30', hour: 13, minute: 0 },
    { label: '2:51 PM -> 14:51', entry: entry(2, 51, 'PM'), receivedAt: '2026-10-25T14:53:00+05:30', hour: 14, minute: 51 },
    { label: '11:59 PM -> 23:59', entry: entry(11, 59, 'PM'), receivedAt: '2026-10-25T23:59:30+05:30', hour: 23, minute: 59 },
  ];

  for (const c of CONVERSIONS) {
    it(`${c.label} resolves to the correct 24-hour IST instant`, () => {
      const r = validateDateTime(c.entry, at(c.receivedAt));
      expect(r.valid).toBe(true);
      const parts = istWallClockParts(r.transactionDate);
      expect(parts.hour).toBe(c.hour);
      expect(parts.minute).toBe(c.minute);
      expect(r.diffMinutes).toBeGreaterThanOrEqual(0);
      expect(r.diffMinutes).toBeLessThanOrEqual(30);
    });
  }

  it('exactly 30 minutes old is still accepted (window boundary inclusive)', () => {
    const r = validateDateTime(entry(2, 25, 'PM'), at('2026-10-25T14:55:00+05:30'));
    expect(r.valid).toBe(true);
    expect(r.diffMinutes).toBe(30);
  });

  it('30 minutes + 1 second old is rejected TOO_OLD', () => {
    const r = validateDateTime(entry(2, 24, 'PM', { second: 59 }), at('2026-10-25T14:55:00+05:30'));
    expect(r).toMatchObject({ valid: false, reason: 'INVALID_PAYMENT_DATE_TOO_OLD' });
  });

  it('afternoon receipt 113 minutes old is rejected TOO_OLD (window not weakened)', () => {
    const r = validateDateTime(entry(1, 0, 'PM'), at('2026-10-25T14:53:00+05:30'));
    expect(r).toMatchObject({ valid: false, reason: 'INVALID_PAYMENT_DATE_TOO_OLD' });
  });

  it('future afternoon timestamp is rejected FUTURE', () => {
    const r = validateDateTime(entry(4, 30, 'PM'), at('2026-10-25T14:53:00+05:30'));
    expect(r).toMatchObject({ valid: false, reason: 'INVALID_PAYMENT_DATE_FUTURE' });
  });

  it('midnight straddle: 11:55 PM previous day accepted within the window', () => {
    const r = validateDateTime(entry(11, 55, 'PM', { day: 24 }), at('2026-10-25T00:02:00+05:30'));
    expect(r.valid).toBe(true);
    expect(r.diffMinutes).toBe(7);
  });

  it('previous-day receipt outside the window is rejected TOO_OLD', () => {
    const r = validateDateTime(entry(10, 0, 'AM', { day: 24 }), at('2026-10-25T10:05:00+05:30'));
    expect(r).toMatchObject({ valid: false, reason: 'INVALID_PAYMENT_DATE_TOO_OLD' });
  });

  it('entries without ampm (24-hour OCR readings) are interpreted as-is', () => {
    const r = validateDateTime(entry(14, 51, null), at('2026-10-25T14:53:00+05:30'));
    expect(r.valid).toBe(true);
    expect(istWallClockParts(r.transactionDate).hour).toBe(14);
  });

  it('structurally invalid entries fail closed as INVALID_PAYMENT_DATE', () => {
    const r = validateDateTime({ year: 2026, month: 10, day: 25, hour: 25, minute: 0, ampm: 'PM', hasTime: true }, at('2026-10-25T14:53:00+05:30'));
    expect(r).toMatchObject({ valid: false, reason: 'INVALID_PAYMENT_DATE' });
  });
});

describe('AM/PM receipts through the full engine pipeline (fixed clock)', () => {
  const run = async (dateLine, serverTimeIso) => {
    runOCR.mockResolvedValue({ text: receiptText({ date: dateLine }), confidence: 90 });
    return paymentValidationEngine.validatePayment({
      imageBuffer: VALID_IMAGE,
      paymentRequest: basePaymentRequest(),
      serverTime: new Date(serverTimeIso),
      timeoutMs: 30000,
    });
  };

  it('2:51 PM receipt approves (afternoon regression — the reported bug)', async () => {
    const r = await run('25/10/2026, 2:51 PM', '2026-10-25T14:53:00+05:30');
    expect(r).toMatchObject({ success: true, approved: true, inconclusive: false });
    expect(r.transactionId).toBe('TTEST123456');
    expect(r.checks.amount.passed).toBe(true);
  });

  it('11:57 AM receipt approves (morning path unaffected)', async () => {
    const r = await run('25/10/2026, 11:57 AM', '2026-10-25T11:59:00+05:30');
    expect(r).toMatchObject({ success: true, approved: true, inconclusive: false });
  });

  it('12:00 PM noon receipt approves', async () => {
    const r = await run('25/10/2026, 12:00 PM', '2026-10-25T12:05:00+05:30');
    expect(r).toMatchObject({ success: true, approved: true, inconclusive: false });
  });

  it('12:08 AM midnight receipt approves within the window', async () => {
    const r = await run('25/10/2026, 12:08 AM', '2026-10-25T00:10:00+05:30');
    expect(r).toMatchObject({ success: true, approved: true, inconclusive: false });
  });

  it('11:58 PM evening receipt approves', async () => {
    const r = await run('25/10/2026, 11:58 PM', '2026-10-25T23:59:00+05:30');
    expect(r).toMatchObject({ success: true, approved: true, inconclusive: false });
  });

  it('1:00 PM receipt older than the window still rejects (validation not weakened)', async () => {
    const r = await run('25/10/2026, 1:00 PM', '2026-10-25T14:53:00+05:30');
    expect(r).toMatchObject({ success: true, approved: false, inconclusive: false, reason: 'INVALID_PAYMENT_DATE' });
    expect(r.details?.variant).toBe('INVALID_PAYMENT_DATE_TOO_OLD');
  });

  it('4:30 PM future receipt still rejects', async () => {
    const r = await run('25/10/2026, 4:30 PM', '2026-10-25T14:53:00+05:30');
    expect(r).toMatchObject({ success: true, approved: false, inconclusive: false, reason: 'INVALID_PAYMENT_DATE' });
    expect(r.details?.variant).toBe('INVALID_PAYMENT_DATE_FUTURE');
  });
});
