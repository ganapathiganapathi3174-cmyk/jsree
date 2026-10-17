import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractReceiverNames,
  normalizeName,
  matchReceiverName,
} from '../../services/ocrService.js';
import {
  runScreenshotVerification,
  decidePaymentVerification,
} from '../../services/verificationService.js';

// ─────────────────────────────────────────────────────────────
// Admin UPI recipient-name verification.
// Covers the OCR name extraction helpers, the pure decision gate and
// the full engine path (with mocked OCR). The name gate is OPTIONAL at
// the engine level: passing `receiverName === undefined` disables it so
// existing/direct callers keep their prior behavior.
// ─────────────────────────────────────────────────────────────

const { runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses } = vi.hoisted(() => ({
  runOCR: vi.fn(),
  runAmountRecoveryOCR: vi.fn(),
  runAdditionalOCRPasses: vi.fn(),
}));

// Keep the real OCR helpers (extractReceiverNames/normalizeName/…) and only
// stub the expensive tesseract entry points.
vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses };
});

const RECEIVER_UPI = 'jayarajj126-3@okicici';
const NOW = new Date('2026-08-24T07:30:00.000Z'); // 13:00 IST

function istLine(d) {
  const ist = new Date(d.getTime() + 5.5 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  let h = ist.getUTCHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${pad(ist.getUTCDate())}/${pad(ist.getUTCMonth() + 1)}/${ist.getUTCFullYear()}, ${h}:${pad(ist.getUTCMinutes())} ${ap}`;
}

function receipt(overrides = {}) {
  const {
    provider = 'Google Pay',
    status = 'Payment Successful',
    amount = '\u20B9120',
    nameLine = 'To Jayaraj',
    upi = RECEIVER_UPI,
    utr = 'UPI transaction ID: T7NAME0001',
    dateLine = `Date: ${istLine(NOW)}`,
  } = overrides;
  return [provider, status, amount, nameLine, upi, dateLine, utr].join('\n');
}

beforeEach(() => {
  vi.clearAllMocks();
  runOCR.mockResolvedValue({ text: receipt(), confidence: 90 });
  runAmountRecoveryOCR.mockResolvedValue([]);
  runAdditionalOCRPasses.mockResolvedValue([]);
});

// ─────────────────────────────────────────────────────────────
// extractReceiverNames — only "To <name>" labels, never a UPI/VPA.
// ─────────────────────────────────────────────────────────────
describe('extractReceiverNames', () => {
  it('reads a plain payee name after "To"', () => {
    expect(extractReceiverNames('Payment Successful\nTo Jayaraj')).toEqual(['Jayaraj']);
  });

  it('reads a name after "Paid to"', () => {
    expect(extractReceiverNames('Paid to Jayaraj')).toEqual(['Jayaraj']);
  });

  it('reads the name from the following line when the label is alone', () => {
    expect(extractReceiverNames('To\nJAYARAJ ALAGAR')).toEqual(['JAYARAJ ALAGAR']);
  });

  it('never mistakes a UPI/VPA for a name', () => {
    expect(extractReceiverNames(`To: ${RECEIVER_UPI}`)).toEqual([]);
    expect(extractReceiverNames(`Paid to ${RECEIVER_UPI}`)).toEqual([]);
    expect(extractReceiverNames(`Sent to ${RECEIVER_UPI}`)).toEqual([]);
  });

  it('collects names across multiple label lines (deduplicated)', () => {
    const text = ['To: jayarajj126-3@okicici', 'To Jayaraj', 'To Jayaraj'].join('\n');
    expect(extractReceiverNames(text)).toEqual(['Jayaraj']);
  });

  it('returns [] for empty input', () => {
    expect(extractReceiverNames('')).toEqual([]);
    expect(extractReceiverNames(null)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// normalizeName — conservative cosmetic normalization only.
// ─────────────────────────────────────────────────────────────
describe('normalizeName', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalizeName('  JAYARAJ   ALAGAR. ')).toBe('jayaraj alagar');
  });

  it('drops common honorifics', () => {
    expect(normalizeName('Mr. Jayaraj')).toBe('jayaraj');
  });

  it('returns null for empty/missing input', () => {
    expect(normalizeName('')).toBe(null);
    expect(normalizeName(null)).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────
// matchReceiverName — exact + token_subset, never fuzzy guessing.
// ─────────────────────────────────────────────────────────────
describe('matchReceiverName', () => {
  it('matches an exact (normalized) name', () => {
    expect(matchReceiverName(['JAYARAJ ALAGAR'], 'jayaraj alagar').match).toBe(true);
    expect(matchReceiverName(['JAYARAJ ALAGAR'], 'jayaraj alagar').method).toBe('exact');
  });

  it('matches when the shorter name is a token-subset of the longer one', () => {
    const r = matchReceiverName(['Jayaraj'], 'JAYARAJ ALAGAR');
    expect(r.match).toBe(true);
    expect(r.method).toBe('token_subset');
  });

  it('matches when the configured name is the shorter one', () => {
    expect(matchReceiverName(['JAYARAJ ALAGAR'], 'Jayaraj').match).toBe(true);
  });

  it('does not match a genuinely different name', () => {
    expect(matchReceiverName(['Raj'], 'Jayaraj').match).toBe(false);
  });

  it('reports no_config when no receiver name is configured', () => {
    const r = matchReceiverName(['Jayaraj'], '');
    expect(r.match).toBe(false);
    expect(r.method).toBe('no_config');
  });

  it('reports not_found when no candidate name was extracted', () => {
    const r = matchReceiverName([], 'Jayaraj');
    expect(r.match).toBe(false);
    expect(r.method).toBe('not_found');
  });
});

// ─────────────────────────────────────────────────────────────
// decidePaymentVerification — Gate 7 semantics (pure function).
// ─────────────────────────────────────────────────────────────
describe('decidePaymentVerification — recipient-name gate', () => {
  const base = {
    upiMatch: true, amountMatch: true, dateValid: true,
    utrPresent: true, transactionStatusOk: true, ocrConfidence: 90,
  };

  it('disables the gate when receiverName is undefined (back-compat)', () => {
    expect(decidePaymentVerification({ ...base })).toEqual({ decision: 'approved', reason: null });
  });

  it('fails safe to manual_review when no name is configured', () => {
    expect(decidePaymentVerification({ ...base, receiverName: '', nameConfigured: false }))
      .toEqual({ decision: 'manual_review', reason: 'RECEIVER_NAME_NOT_CONFIGURED' });
  });

  it('hard-rejects a readable but different payee name', () => {
    expect(decidePaymentVerification({ ...base, receiverName: 'Jayaraj', nameConfigured: true, nameMatch: false, nameFound: true }))
      .toEqual({ decision: 'rejected', reason: 'RECEIVER_NAME_MISMATCH' });
  });

  it('routes an unreadable name to manual_review', () => {
    expect(decidePaymentVerification({ ...base, receiverName: 'Jayaraj', nameConfigured: true, nameMatch: false, nameFound: false }))
      .toEqual({ decision: 'manual_review', reason: 'RECEIVER_NAME_UNREADABLE' });
  });

  it('approves when the name matches', () => {
    expect(decidePaymentVerification({ ...base, receiverName: 'Jayaraj', nameConfigured: true, nameMatch: true, nameFound: true }))
      .toEqual({ decision: 'approved', reason: null });
  });

  it('evaluates the name gate only after all other gates pass', () => {
    // A UPI mismatch must win over the name gate.
    expect(decidePaymentVerification({ ...base, upiMatch: false, receiverName: '', nameConfigured: false }).reason)
      .toBe('UPI_MISMATCH');
  });
});

// ─────────────────────────────────────────────────────────────
// Full engine path with mocked OCR.
// ─────────────────────────────────────────────────────────────
describe('runScreenshotVerification — recipient-name gate (end to end)', () => {
  const verify = (receiverName, text) => {
    if (text !== undefined) runOCR.mockResolvedValue({ text, confidence: 90 });
    return runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      receiverName,
      now: NOW,
    });
  };

  it('approves a receipt whose payee name matches the configured name', async () => {
    const { verificationResult } = await verify('Jayaraj');
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.checks.receiverName.passed).toBe(true);
    expect(verificationResult.fieldConfidence.receiverName.confidence).toBe('high');
    expect(verificationResult.detected.receiverNames).toContain('Jayaraj');
  });

  it('approves a token-subset match (extra middle/last name)', async () => {
    const { verificationResult } = await verify('JAYARAJ ALAGAR');
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.nameDiagnostics.matchMethod).toBe('token_subset');
  });

  it('rejects a readable but different payee name', async () => {
    const { verificationResult } = await verify('Jayaraj', receipt({ nameLine: 'To Someone Else' }));
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('RECEIVER_NAME_MISMATCH');
  });

  it('routes a receipt with no readable name to manual_review', async () => {
    const { verificationResult } = await verify('Jayaraj', receipt({ nameLine: `To: ${RECEIVER_UPI}` }));
    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('RECEIVER_NAME_UNREADABLE');
  });

  it('fails safe to manual_review when no receiver name is configured', async () => {
    const { verificationResult } = await verify('');
    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('RECEIVER_NAME_NOT_CONFIGURED');
  });

  it('disables the gate when receiverName is undefined (legacy behavior)', async () => {
    const { verificationResult } = await verify(undefined, receipt({ nameLine: `To: ${RECEIVER_UPI}` }));
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.checks.receiverName.enabled).toBe(false);
  });
});
