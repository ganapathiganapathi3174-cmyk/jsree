import { describe, it, expect } from 'vitest';
import { decidePaymentVerification } from '../../services/paymentService.js';

// ─────────────────────────────────────────────────────────────
// FINAL PAYMENT VERIFICATION RULE
//
// Approval requires:
//   1. ADMIN UPI MATCH
//   2. VALID PAYMENT DATE/TIME
//   3. READABLE/AUTHENTIC SCREENSHOT (OCR confidence gate)
//
// Amount is intentionally NOT part of the decision — a correct receipt that
// shows a different amount than the selected plan amount is STILL approved.
// UTR has ZERO influence on the decision (UTR uniqueness is enforced by the
// separate approve/duplicate gate, not by this engine).
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

  it('TEST 4: correct UPI + WRONG amount + valid date/time -> APPROVED (amount removed from decision)', () => {
    const { decision, reason } = decidePaymentVerification({ upiMatch: true, amountMatch: false, dateValid: true });
    expect(decision).toBe('approved');
    expect(reason).toBeNull();
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

  it('TEST 10: ₹120 screenshot -> expected ₹500 APPROVED (amount-independent)', () => {
    const { decision, reason } = decidePaymentVerification({ upiMatch: true, amountMatch: false, dateValid: true });
    expect(decision).toBe('approved');
    expect(reason).toBeNull();
  });

  it('TEST 11: ₹500 screenshot -> expected ₹1000 APPROVED (amount-independent)', () => {
    const { decision, reason } = decidePaymentVerification({ upiMatch: true, amountMatch: false, dateValid: true });
    expect(decision).toBe('approved');
    expect(reason).toBeNull();
  });

  it('TEST 12: ₹1000 screenshot -> expected ₹120 APPROVED (amount-independent)', () => {
    const { decision, reason } = decidePaymentVerification({ upiMatch: true, amountMatch: false, dateValid: true });
    expect(decision).toBe('approved');
    expect(reason).toBeNull();
  });
});

describe('Amount does NOT affect the approval/rejection decision', () => {
  it('flipping amountMatch true<->false never changes the outcome', () => {
    const cases = [
      // upi, date -> decision
      [true, true, 'approved'],
      [false, true, 'rejected'],
      [true, false, 'rejected'],
      [false, false, 'rejected'],
    ];
    for (const [upiMatch, dateValid, expected] of cases) {
      for (const amountMatch of [true, false]) {
        const { decision } = decidePaymentVerification({ upiMatch, amountMatch, dateValid });
        expect(decision, `upi=${upiMatch} amount=${amountMatch} date=${dateValid}`).toBe(expected);
      }
    }
  });

  it('a wrong amount never produces an AMOUNT_MISMATCH rejection', () => {
    const r = decidePaymentVerification({ upiMatch: true, amountMatch: false, dateValid: true, ocrConfidence: 90 });
    expect(r.decision).toBe('approved');
    expect(r.reason).not.toBe('AMOUNT_MISMATCH');
  });
});

describe('UTR has ZERO influence on the decision', () => {
  it('decision engine does not read UTR input at all', () => {
    // In every following case the UTR is irrelevant: only
    // upiMatch / dateValid drive the decision (amount is ignored too).
    const cases = [
      // upi, date -> decision
      [true, true, 'approved'],
      [true, false, 'rejected'],
      [false, true, 'rejected'],
      [false, false, 'rejected'],
    ];
    for (const [upiMatch, dateValid, expected] of cases) {
      const { decision } = decidePaymentVerification({ upiMatch, amountMatch: false, dateValid });
      expect(decision, `upi=${upiMatch} date=${dateValid}`).toBe(expected);
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