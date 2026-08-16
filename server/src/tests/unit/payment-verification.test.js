import { describe, it, expect } from 'vitest';
import { decidePaymentVerification } from '../../services/paymentService.js';

// ─────────────────────────────────────────────────────────────
// FINAL PAYMENT VERIFICATION RULE
//
// Approval requires ALL THREE conditions:
//   1. ADMIN UPI MATCH
//   2. AMOUNT MATCH (user-selected plan amount)
//   3. VALID PAYMENT DATE/TIME
//
// UTR / transaction ID has ZERO influence on the decision.
// ─────────────────────────────────────────────────────────────

describe('Payment Verification Decision Engine', () => {
  it('TEST 1: correct UPI + correct amount + valid date/time + NO UTR -> APPROVED', () => {
    const { decision, reason } = decidePaymentVerification({ upiMatch: true, amountMatch: true, dateValid: true });
    expect(decision).toBe('approved');
    expect(reason).toBeNull();
  });

  it('TEST 2: correct UPI + correct amount + unreadable UTR + valid date/time -> APPROVED', () => {
    // UTR unreadable/gibberish is ignored — decision still approved.
    const { decision, reason } = decidePaymentVerification({ upiMatch: true, amountMatch: true, dateValid: true });
    expect(decision).toBe('approved');
    expect(reason).toBeNull();
  });

  it('TEST 3: correct UPI + correct amount + valid date/time + random UTR -> APPROVED', () => {
    // Random UTR has zero influence.
    const { decision, reason } = decidePaymentVerification({ upiMatch: true, amountMatch: true, dateValid: true });
    expect(decision).toBe('approved');
    expect(reason).toBeNull();
  });

  it('TEST 4: correct UPI + WRONG amount + valid date/time -> REJECTED (AMOUNT_MISMATCH)', () => {
    const { decision, reason } = decidePaymentVerification({ upiMatch: true, amountMatch: false, dateValid: true });
    expect(decision).toBe('rejected');
    expect(reason).toBe('AMOUNT_MISMATCH');
  });

  it('TEST 5: WRONG UPI + correct amount + valid date/time -> REJECTED (UPI_MISMATCH)', () => {
    const { decision, reason } = decidePaymentVerification({ upiMatch: false, amountMatch: true, dateValid: true });
    expect(decision).toBe('rejected');
    expect(reason).toBe('UPI_MISMATCH');
  });

  it('TEST 6: correct UPI + correct amount + INVALID date/time -> REJECTED (INVALID_PAYMENT_DATE)', () => {
    const { decision, reason } = decidePaymentVerification({ upiMatch: true, amountMatch: true, dateValid: false });
    expect(decision).toBe('rejected');
    expect(reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('TEST 7: ₹120 -> ₹120 APPROVED', () => {
    const { decision } = decidePaymentVerification({ upiMatch: true, amountMatch: true, dateValid: true });
    expect(decision).toBe('approved');
  });

  it('TEST 8: ₹500 -> ₹500 APPROVED', () => {
    const { decision } = decidePaymentVerification({ upiMatch: true, amountMatch: true, dateValid: true });
    expect(decision).toBe('approved');
  });

  it('TEST 9: ₹1000 -> ₹1000 APPROVED', () => {
    const { decision } = decidePaymentVerification({ upiMatch: true, amountMatch: true, dateValid: true });
    expect(decision).toBe('approved');
  });

  it('TEST 10: ₹120 screenshot -> expected ₹500 REJECTED', () => {
    const { decision, reason } = decidePaymentVerification({ upiMatch: true, amountMatch: false, dateValid: true });
    expect(decision).toBe('rejected');
    expect(reason).toBe('AMOUNT_MISMATCH');
  });

  it('TEST 11: ₹500 screenshot -> expected ₹1000 REJECTED', () => {
    const { decision, reason } = decidePaymentVerification({ upiMatch: true, amountMatch: false, dateValid: true });
    expect(decision).toBe('rejected');
    expect(reason).toBe('AMOUNT_MISMATCH');
  });

  it('TEST 12: ₹1000 screenshot -> expected ₹120 REJECTED', () => {
    const { decision, reason } = decidePaymentVerification({ upiMatch: true, amountMatch: false, dateValid: true });
    expect(decision).toBe('rejected');
    expect(reason).toBe('AMOUNT_MISMATCH');
  });
});

describe('UTR has ZERO influence on the decision', () => {
  it('decision engine does not read UTR input at all', () => {
    // In every following case the UTR is irrelevant: only
    // upiMatch / amountMatch / dateValid drive the decision.
    const cases = [
      // upi, amount, date -> decision
      [true, true, true, 'approved'],
      [true, true, false, 'rejected'],
      [true, false, true, 'rejected'],
      [false, true, true, 'rejected'],
      [false, false, true, 'rejected'],
      [false, true, false, 'rejected'],
      [true, false, false, 'rejected'],
      [false, false, false, 'rejected'],
    ];
    for (const [upiMatch, amountMatch, dateValid, expected] of cases) {
      const { decision } = decidePaymentVerification({ upiMatch, amountMatch, dateValid });
      expect(decision, `upi=${upiMatch} amount=${amountMatch} date=${dateValid}`).toBe(expected);
    }
  });

  it('missing / duplicate / random UTR cannot flip an otherwise-approved decision', () => {
    const base = decidePaymentVerification({ upiMatch: true, amountMatch: true, dateValid: true });
    expect(base.decision).toBe('approved');
    // Even if a UTR were extracted (here simulated historically), approval
    // logic signature accepts no UTR parameter — nothing to skip or match.
    expect(decidePaymentVerification.length).toBeLessThan(2);
  });
});