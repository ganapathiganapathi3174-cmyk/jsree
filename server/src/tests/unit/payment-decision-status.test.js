import { describe, it, expect, beforeEach, vi } from 'vitest';

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

import {
  ValidationDecisionEngine,
  statusForOutcome,
} from '../../services/paymentValidation/decisionEngine.js';
import {
  validateAmount,
  validateReceiver,
  validateDateTime,
  validateTransactionId,
  validateSender,
} from '../../services/paymentValidation/stageValidation.js';

const RECEIVER_UPI = 'jayarajj126-3@okicici';
const RECEIVER_NAME = 'Jayaraj';

function dateEntry(minutesBefore = 2) {
  const d = new Date(Date.now() - minutesBefore * 60000);
  return {
    year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
    hour: d.getHours(), minute: d.getMinutes(), second: 0, hasTime: true,
  };
}

const baseExtraction = (over = {}) => ({
  success: true,
  unreadable: false,
  ocrText: 'Payment Successful\n₹120\nTo Jayaraj\n' + RECEIVER_UPI,
  ocrConfidence: 90,
  extractedAmounts: ['120'],
  extractedUPIs: [RECEIVER_UPI],
  extractedUTRs: ['TTEST123456'],
  extractedDateTimes: [dateEntry()],
  extractedReceiverNames: ['Jayaraj'],
  extractedSenderNames: [],
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
    senderValidation: 'senderValidation' in overrides ? overrides.senderValidation : null,
    paymentRequest,
  });
}

beforeEach(() => {
  db.state.results = {};
});

// ─────────────────────────────────────────────────────────────
// Public four-state outcome contract
// ─────────────────────────────────────────────────────────────
describe('statusForOutcome', () => {
  it('maps the four terminal states', () => {
    expect(statusForOutcome({ approved: true })).toBe('APPROVED');
    expect(statusForOutcome({ approved: false, review: true })).toBe('MANUAL_REVIEW');
    expect(statusForOutcome({ approved: false, inconclusive: true })).toBe('PENDING_VERIFICATION');
    expect(statusForOutcome({ approved: false })).toBe('REJECTED');
  });
});

describe('decision status tagging', () => {
  it('an approved decision carries status APPROVED', async () => {
    const r = await decideWith();
    expect(r.approved).toBe(true);
    expect(r.status).toBe('APPROVED');
  });

  it('a definitive rejection carries status REJECTED', async () => {
    const r = await decideWith({ extraction: baseExtraction({ extractedAmounts: ['500'] }) });
    expect(r.approved).toBe(false);
    expect(r.inconclusive).toBe(false);
    expect(r.reason).toBe('AMOUNT_MISMATCH');
    expect(r.status).toBe('REJECTED');
  });

  it('an unreadable amount is PENDING_VERIFICATION (inconclusive), never a rejection', async () => {
    const r = await decideWith({ extraction: baseExtraction({ extractedAmounts: [] }) });
    expect(r.inconclusive).toBe(true);
    expect(r.status).toBe('PENDING_VERIFICATION');
  });
});

// ─────────────────────────────────────────────────────────────
// Gate 7b — sender (payer) name
// ─────────────────────────────────────────────────────────────
describe('decision engine sender gate', () => {
  it('a matching sender is supporting evidence and still approves', async () => {
    const senderValidation = validateSender(['ravi kumar'], 'Ravi Kumar', 'review');
    const r = await decideWith({ senderValidation });
    expect(r.approved).toBe(true);
    expect(r.checks.senderName.passed).toBe(true);
  });

  it('an unreadable sender never blocks the payment', async () => {
    const senderValidation = validateSender([], 'Ravi Kumar', 'review');
    const r = await decideWith({ senderValidation });
    expect(r.approved).toBe(true);
    expect(r.checks.senderName.passed).toBeNull();
    expect(r.checks.senderName.reason).toBe('SENDER_NAME_UNREADABLE');
  });

  it('a complete payer-name mismatch routes to MANUAL_REVIEW under policy review', async () => {
    const senderValidation = validateSender(['Amit Shah'], 'Ravi Kumar', 'review');
    const r = await decideWith({ senderValidation });
    expect(r.approved).toBe(false);
    expect(r.inconclusive).toBe(false);
    expect(r.review).toBe(true);
    expect(r.status).toBe('MANUAL_REVIEW');
    expect(r.reason).toBe('SENDER_NAME_MISMATCH');
  });

  it('a complete payer-name mismatch REJECTS under policy reject', async () => {
    const senderValidation = validateSender(['Amit Shah'], 'Ravi Kumar', 'reject');
    const r = await decideWith({ senderValidation });
    expect(r.approved).toBe(false);
    expect(r.review).not.toBe(true);
    expect(r.status).toBe('REJECTED');
    expect(r.reason).toBe('SENDER_NAME_MISMATCH');
  });

  it('sender validation is skipped entirely when not applicable', async () => {
    const senderValidation = validateSender(['Amit Shah'], null, 'review');
    const r = await decideWith({ senderValidation });
    expect(r.approved).toBe(true);
    expect(r.checks.senderName).toBeUndefined();
  });

  it('sender gate runs AFTER the mandatory gates — a wrong amount still rejects first', async () => {
    const senderValidation = validateSender(['Amit Shah'], 'Ravi Kumar', 'review');
    const r = await decideWith({
      extraction: baseExtraction({ extractedAmounts: ['500'] }),
      senderValidation,
    });
    expect(r.reason).toBe('AMOUNT_MISMATCH');
    expect(r.status).toBe('REJECTED');
  });
});
