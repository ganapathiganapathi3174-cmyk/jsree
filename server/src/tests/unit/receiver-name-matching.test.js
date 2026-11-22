import { describe, it, expect } from 'vitest';
import { matchReceiverName, matchSenderName, normalizeName } from '../../services/paymentVerificationV2/ocrExtraction.js';
import { validateReceiver } from '../../services/paymentVerificationV2/receiverValidation.js';
import { decidePaymentVerification } from '../../services/paymentVerificationV2/decisionEngine.js';

// Expected receiver name for this deployment: "Jayaraj".
// The receiver-name result is INFORMATIONAL — the matcher must recognize
// spelling/spacing/case variants reliably, and the decision engine must
// never reject or park a payment on the name alone.

describe('matchReceiverName — Jayaraj variants', () => {
  const match = candidates => matchReceiverName(candidates, 'Jayaraj');

  it('matches the exact name', () => {
    const r = match(['Jayaraj']);
    expect(r.match).toBe(true);
    expect(r.method).toBe('exact');
  });

  it('matches uppercase / lowercase (case-insensitive)', () => {
    expect(match(['JAYARAJ']).match).toBe(true);
    expect(match(['jayaraj']).match).toBe(true);
    expect(match(['JaYaRaJ']).match).toBe(true);
  });

  it('matches split OCR spacing: "Jaya Raj" for "Jayaraj"', () => {
    const r = match(['Jaya Raj']);
    expect(r.match).toBe(true);
    expect(r.method).toBe('exact_compact');
  });

  it('matches odd spacing variants', () => {
    expect(match(['JAYA  RAJ']).match).toBe(true);   // double space (normalized)
    expect(match(['JAYA RAJ ']).match).toBe(true);   // trailing space
    expect(match([' jayaraj']).match).toBe(true);    // leading space
    expect(match(['Jayaraj.']).match).toBe(true);    // trailing punctuation
    expect(match(['Jayaraj,']).match).toBe(true);
    expect(match(['Mr. Jayaraj']).match).toBe(true); // honorific stripped
    expect(match(['Shri Jayaraj']).match).toBe(true);
  });

  it('matches with additional names present: "Jayaraj Alagar"', () => {
    const r = match(['Jayaraj Alagar']);
    expect(r.match).toBe(true);
    expect(['token_subset', 'token_run']).toContain(r.method);
  });

  it('matches full variants: "JAYA RAJ ALAGAR" for "Jayaraj"', () => {
    const r = match(['JAYA RAJ ALAGAR']);
    expect(r.match).toBe(true);
    expect(r.method).toBe('token_run');
  });

  it('matches when an initial precedes the name: "S Jayaraj Alagar"', () => {
    expect(match(['S Jayaraj Alagar']).match).toBe(true);
  });

  it('does NOT match unrelated names (false positives)', () => {
    expect(match(['Ramesh Kumar']).match).toBe(false);
    expect(match(['Vijayaraj']).match).toBe(false);   // contains "jayaraj" only as substring
    expect(match(['Kavitha Raj']).match).toBe(false);
    expect(match(['Someone Else']).match).toBe(false);
    expect(match(['Jaya']).match).toBe(false);
    expect(match(['Raj']).match).toBe(false);
    expect(match(['']).match).toBe(false);
    expect(match([]).method).toBe('not_found');
  });

  it('handles multi-word configured names: "Jaya Raj" config', () => {
    expect(matchReceiverName(['Jayaraj'], 'Jaya Raj').match).toBe(true);        // compact
    expect(matchReceiverName(['Jayaraj Alagar'], 'Jaya Raj').match).toBe(true); // token run
    expect(matchReceiverName(['JAYA RAJ ALAGAR'], 'Jaya Raj').match).toBe(true);
    expect(matchReceiverName(['Ramesh Kumar'], 'Jaya Raj').match).toBe(false);
  });

  it('reports partial (not a match) when the receipt shows only part of a longer configured name', () => {
    const r = matchReceiverName(['Jayaraj'], 'Jayaraj Alagar');
    expect(r.match).toBe(false);
    expect(r.partial).toBe(true);
    expect(r.method).toBe('partial');
  });

  it('flags a confidently different payee as mismatch', () => {
    const r = match(['Someone Else']);
    expect(r.match).toBe(false);
    expect(r.method).toBe('mismatch');
  });

  it('keeps sender-name matching on the unchanged (non-token-run) rules', () => {
    // Sender keeps legacy behaviour: split-form equivalence stays excluded.
    expect(matchSenderName(['Jayaraj Alagar'], 'Jayaraj').match).toBe(true);   // token_subset (unchanged)
    expect(matchSenderName(['Ramesh Kumar'], 'Jayaraj').match).toBe(false);
  });

  it('normalizeName erases case / spacing / punctuation / honorifics only', () => {
    expect(normalizeName('JAYA  RAJ')).toBe('jaya raj');
    expect(normalizeName('Mr. Jayaraj')).toBe('jayaraj');
    expect(normalizeName('Vijayaraj')).toBe('vijayaraj');
  });
});

describe('validateReceiver — informational outcomes', () => {
  it('reports a match with method', () => {
    const v = validateReceiver(['Jayaraj Alagar'], 'Jayaraj');
    expect(v.valid).toBe(true);
    expect(v.matchedName).toBe('jayaraj alagar');
    expect(v.method).toBeTruthy();
  });

  it('reports mismatch without throwing', () => {
    const v = validateReceiver(['Someone Else'], 'Jayaraj');
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('RECEIVER_NAME_MISMATCH');
    expect(v.detected).toEqual(['Someone Else']);
  });

  it('reports unreadable when nothing was read', () => {
    const v = validateReceiver([], 'Jayaraj');
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('RECEIVER_NAME_UNREADABLE');
  });

  it('reports not-configured when no server name is set', () => {
    const v = validateReceiver(['Jayaraj'], '');
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('RECEIVER_NAME_NOT_CONFIGURED');
  });
});

describe('decision engine — receiver name never rejects or parks', () => {
  const base = {
    upiMatch: true, amountMatch: true, dateValid: true, utrPresent: true,
    transactionStatusOk: true, ocrConfidence: 90,
    receiverName: 'Jayaraj', nameConfigured: true,
  };

  it('approves on name mismatch (informational only)', () => {
    expect(decidePaymentVerification({ ...base, nameMatch: false, nameFound: true }))
      .toEqual({ decision: 'approved', reason: null });
  });

  it('approves on unreadable name (informational only)', () => {
    expect(decidePaymentVerification({ ...base, nameMatch: false, nameFound: false }))
      .toEqual({ decision: 'approved', reason: null });
  });

  it('approves on partial name (informational only)', () => {
    expect(decidePaymentVerification({ ...base, nameMatch: false, nameFound: true, namePartial: true }))
      .toEqual({ decision: 'approved', reason: null });
  });

  it('approves on name match', () => {
    expect(decidePaymentVerification({ ...base, nameMatch: true, nameFound: true }))
      .toEqual({ decision: 'approved', reason: null });
  });

  it('still enforces the mandatory gates regardless of the name', () => {
    expect(decidePaymentVerification({ ...base, nameMatch: true, nameFound: true, amountMatch: false, amountDetected: true }).reason)
      .toBe('AMOUNT_MISMATCH');
    expect(decidePaymentVerification({ ...base, nameMatch: false, nameFound: true, utrPresent: false }).reason)
      .toBe('MISSING_UTR');
    expect(decidePaymentVerification({ ...base, nameMatch: false, nameFound: true, dateValid: false }).reason)
      .toBe('INVALID_PAYMENT_DATE');
  });

  it('receiver UPI mismatch is also informational — never rejects', () => {
    expect(decidePaymentVerification({ ...base, nameMatch: false, nameFound: true, upiMatch: false }))
      .toEqual({ decision: 'approved', reason: null });
  });
});
