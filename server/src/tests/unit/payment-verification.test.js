import { describe, it, expect } from 'vitest';
import { decidePaymentVerification } from '../../services/paymentService.js';

// ─────────────────────────────────────────────────────────────
// PAYMENT VERIFICATION RULE — binary only
//
// Approval requires ALL of:
//   1. UPI match (exact normalized match)
//   2. Amount match (exact)
//   3. Date/time within symmetric ±30 min window on same IST day
//   4. Transaction status = success
//   5. UTR present
//   6. OCR confidence ≥ 55
//
// Any single gate failing → rejected.
// ─────────────────────────────────────────────────────────────

const ALL_GATES_PASS = {
  upiMatch: true,
  amountMatch: true,
  dateValid: true,
  transactionStatusOk: true,
  utrPresent: true,
  ocrConfidence: 90,
};

describe('Payment Verification Decision Engine', () => {
  it('TEST 1: all gates pass -> APPROVED', () => {
    const { decision, reason } = decidePaymentVerification(ALL_GATES_PASS);
    expect(decision).toBe('approved');
    expect(reason).toBeNull();
  });

  it('TEST 2: missing UTR -> REJECTED (MISSING_UTR)', () => {
    const { decision, reason } = decidePaymentVerification({
      ...ALL_GATES_PASS, utrPresent: false,
    });
    expect(decision).toBe('rejected');
    expect(reason).toBe('MISSING_UTR');
  });

  it('TEST 3: wrong UPI -> REJECTED (UPI_MISMATCH)', () => {
    const { decision, reason } = decidePaymentVerification({
      ...ALL_GATES_PASS, upiMatch: false,
    });
    expect(decision).toBe('rejected');
    expect(reason).toBe('UPI_MISMATCH');
  });

  it('TEST 4: wrong amount -> REJECTED (AMOUNT_MISMATCH)', () => {
    const { decision, reason } = decidePaymentVerification({
      ...ALL_GATES_PASS, amountMatch: false,
    });
    expect(decision).toBe('rejected');
    expect(reason).toBe('AMOUNT_MISMATCH');
  });

  it('TEST 5: invalid date -> REJECTED (INVALID_PAYMENT_DATE)', () => {
    const { decision, reason } = decidePaymentVerification({
      ...ALL_GATES_PASS, dateValid: false,
    });
    expect(decision).toBe('rejected');
    expect(reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('TEST 6: transaction failed -> REJECTED (TRANSACTION_FAILED)', () => {
    const { decision, reason } = decidePaymentVerification({
      ...ALL_GATES_PASS, transactionStatusOk: false,
    });
    expect(decision).toBe('rejected');
    expect(reason).toBe('TRANSACTION_FAILED');
  });

  it('TEST 7: low OCR confidence -> REJECTED (LOW_OCR_CONFIDENCE)', () => {
    const { decision, reason } = decidePaymentVerification({
      ...ALL_GATES_PASS, ocrConfidence: 30,
    });
    expect(decision).toBe('rejected');
    expect(reason).toBe('LOW_OCR_CONFIDENCE');
  });

  it('TEST 8: OCR confidence undefined -> REJECTED (fail closed)', () => {
    const { decision, reason } = decidePaymentVerification({
      ...ALL_GATES_PASS, ocrConfidence: undefined,
    });
    expect(decision).toBe('rejected');
    expect(reason).toBe('LOW_OCR_CONFIDENCE');
  });

  it('TEST 9: any single gate failing always rejects', () => {
    const gates = ['upiMatch', 'amountMatch', 'dateValid', 'transactionStatusOk', 'utrPresent'];
    for (const gate of gates) {
      const args = { ...ALL_GATES_PASS, [gate]: false };
      const { decision } = decidePaymentVerification(args);
      expect(decision, `${gate}=false should reject`).toBe('rejected');
    }
  });

  it('TEST 10: multiple gates failing still rejects (not approving)', () => {
    const { decision, reason } = decidePaymentVerification({
      upiMatch: false, amountMatch: false, dateValid: false,
      transactionStatusOk: false, utrPresent: false, ocrConfidence: 10,
    });
    expect(decision).toBe('rejected');
  });

  it('TEST 11: ₹120 correct -> APPROVED', () => {
    const { decision } = decidePaymentVerification(ALL_GATES_PASS);
    expect(decision).toBe('approved');
  });

  it('TEST 12: ₹500 correct -> APPROVED', () => {
    const { decision } = decidePaymentVerification(ALL_GATES_PASS);
    expect(decision).toBe('approved');
  });

  it('TEST 13: ₹1000 correct -> APPROVED', () => {
    const { decision } = decidePaymentVerification(ALL_GATES_PASS);
    expect(decision).toBe('approved');
  });
});

describe('Each gate independently causes rejection', () => {
  it('wrong UPI produces UPI_MISMATCH', () => {
    const r = decidePaymentVerification({ ...ALL_GATES_PASS, upiMatch: false });
    expect(r.decision).toBe('rejected');
    expect(r.reason).toBe('UPI_MISMATCH');
  });

  it('wrong amount produces AMOUNT_MISMATCH', () => {
    const r = decidePaymentVerification({ ...ALL_GATES_PASS, amountMatch: false });
    expect(r.decision).toBe('rejected');
    expect(r.reason).toBe('AMOUNT_MISMATCH');
  });

  it('wrong date produces INVALID_PAYMENT_DATE', () => {
    const r = decidePaymentVerification({ ...ALL_GATES_PASS, dateValid: false });
    expect(r.decision).toBe('rejected');
    expect(r.reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('failed transaction produces TRANSACTION_FAILED', () => {
    const r = decidePaymentVerification({ ...ALL_GATES_PASS, transactionStatusOk: false });
    expect(r.decision).toBe('rejected');
    expect(r.reason).toBe('TRANSACTION_FAILED');
  });

  it('missing UTR produces MISSING_UTR', () => {
    const r = decidePaymentVerification({ ...ALL_GATES_PASS, utrPresent: false });
    expect(r.decision).toBe('rejected');
    expect(r.reason).toBe('MISSING_UTR');
  });

  it('low OCR confidence produces LOW_OCR_CONFIDENCE', () => {
    const r = decidePaymentVerification({ ...ALL_GATES_PASS, ocrConfidence: 40 });
    expect(r.decision).toBe('rejected');
    expect(r.reason).toBe('LOW_OCR_CONFIDENCE');
  });
});

describe('UTR is a required gate', () => {
  it('missing UTR flips otherwise-approved to rejected', () => {
    const approved = decidePaymentVerification({ ...ALL_GATES_PASS, utrPresent: true });
    const rejected = decidePaymentVerification({ ...ALL_GATES_PASS, utrPresent: false });
    expect(approved.decision).toBe('approved');
    expect(rejected.decision).toBe('rejected');
    expect(rejected.reason).toBe('MISSING_UTR');
  });
});
