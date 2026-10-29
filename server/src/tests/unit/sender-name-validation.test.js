import { describe, it, expect } from 'vitest';
import {
  extractSenderNames,
  extractReceiverNames,
  matchSenderName,
} from '../../services/ocrService.js';
import { validateSender } from '../../services/paymentValidation/stageValidation.js';

// ─────────────────────────────────────────────────────────────
// Rule B — sender (payer) name extraction + validation.
// The sender gate is ADVISORY: unreadable/partial reads never block; only a
// complete, clearly different payer name can trigger review/reject.
// ─────────────────────────────────────────────────────────────

describe('extractSenderNames', () => {
  it('reads a labelled "From" payer line', () => {
    const names = extractSenderNames('Payment Successful\nFrom\nRAVI KUMAR\nTo\nJAYARAJ\n₹120');
    expect(names).toContain('RAVI KUMAR');
  });

  it('reads "Paid from" with an inline name', () => {
    const names = extractSenderNames('Paid from: Ravi Kumar\n₹120');
    expect(names).toContain('Ravi Kumar');
  });

  it('reads "Sender name" label', () => {
    const names = extractSenderNames('Sender name: RAVI K');
    expect(names).toContain('RAVI K');
  });

  it('never treats a payee ("To ...") line as the sender', () => {
    const names = extractSenderNames('To JAYARAJ ALAGAR\njayarajj126-3@okicici\n₹120');
    expect(names).toEqual([]);
  });

  it('rejects UPI IDs appearing after the From label', () => {
    const names = extractSenderNames('From ravi@okaxis');
    expect(names).toEqual([]);
  });

  it('rejects digit-heavy values after the From label', () => {
    const names = extractSenderNames('From 9876543210');
    expect(names).toEqual([]);
  });

  it('returns empty for empty input', () => {
    expect(extractSenderNames('')).toEqual([]);
    expect(extractSenderNames(null)).toEqual([]);
  });
});

describe('matchSenderName', () => {
  it('matches case/spacing/punctuation differences exactly', () => {
    const r = matchSenderName(['ravi  kumar'], 'Ravi Kumar');
    expect(r.match).toBe(true);
    expect(r.method).toBe('exact');
  });

  it('matches token superset (receipt shows at least the expected name)', () => {
    const r = matchSenderName(['Ravi Kumar Reddy'], 'Ravi Kumar');
    expect(r.match).toBe(true);
    expect(r.method).toBe('token_subset');
  });

  it('returns partial for an incomplete shared token', () => {
    const r = matchSenderName(['Ravi'], 'Ravi Kumar');
    expect(r.match).toBe(false);
    expect(r.partial).toBe(true);
  });

  it('returns mismatch for a complete but different name', () => {
    const r = matchSenderName(['Amit Shah'], 'Ravi Kumar');
    expect(r.match).toBe(false);
    expect(r.method).toBe('mismatch');
  });
});

describe('validateSender', () => {
  it('is disabled when no expected payer is configured', () => {
    const r = validateSender(['Ravi Kumar'], null, 'review');
    expect(r.applicable).toBe(false);
    expect(r.passed).toBeNull();
  });

  it('is disabled under policy off even with an expected name', () => {
    const r = validateSender(['Amit Shah'], 'Ravi Kumar', 'off');
    expect(r.applicable).toBe(false);
  });

  it('passes when the payer name matches', () => {
    const r = validateSender(['ravi kumar'], 'Ravi Kumar', 'review');
    expect(r.applicable).toBe(true);
    expect(r.passed).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('is advisory (passed:null) when the sender line is unreadable', () => {
    const r = validateSender([], 'Ravi Kumar', 'review');
    expect(r.passed).toBeNull();
    expect(r.reason).toBe('SENDER_NAME_UNREADABLE');
  });

  it('is advisory for a partial/truncated sender read', () => {
    const r = validateSender(['Ravi'], 'Ravi Kumar', 'review');
    expect(r.passed).toBeNull();
    expect(r.reason).toBe('SENDER_NAME_UNREADABLE');
  });

  it('fails with SENDER_NAME_MISMATCH on a complete different name', () => {
    const r = validateSender(['Amit Shah'], 'Ravi Kumar', 'review');
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('SENDER_NAME_MISMATCH');
    expect(r.policy).toBe('review');
  });

  it('keeps the policy value on the result for the decision engine', () => {
    const r = validateSender(['Amit Shah'], 'Ravi Kumar', 'reject');
    expect(r.reason).toBe('SENDER_NAME_MISMATCH');
    expect(r.policy).toBe('reject');
  });
});

describe('sender vs receiver label disjointness', () => {
  it('the same receipt text yields disjoint sender and receiver sets', () => {
    const text = 'Payment Successful\nFrom Ravi Kumar\nTo Jayaraj\n₹120';
    const senders = extractSenderNames(text);
    const receivers = extractReceiverNames(text);
    expect(senders).toContain('Ravi Kumar');
    expect(receivers).toContain('Jayaraj');
    expect(senders).not.toContain('Jayaraj');
    expect(receivers).not.toContain('Ravi Kumar');
  });
});
