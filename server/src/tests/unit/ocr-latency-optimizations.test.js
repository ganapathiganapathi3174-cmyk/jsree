import { describe, it, expect, afterAll } from 'vitest';
import sharp from 'sharp';
import {
  preprocessImage,
  runAmountRecoveryOCR,
  verifyAmountWithCurrencyRecovery,
  closeOCRWorkers,
} from '../../services/ocrService.js';

// ─────────────────────────────────────────────────────────────
// OCR-level regression for the screenshot-verification latency work:
//   1. preprocessImage memoization (same Buffer instance → same result)
//   2. strip recovery per-strategy early exit + top-region probe
//   3. currency recovery per-strategy early exit
// Contract for 2/3: the OPTIMIZED path must reach the identical acceptance
// (expected amount recovered / evidence found) while performing STRICTLY
// FEWER OCR jobs than the exhaustive path (expectedAmount = null for strip /
// impossible amount for currency = full-scan behaviour). Job counts come
// from __OCRSTATS, which records every scheduled recognize() call.
// Real OCR on a synthetic receipt — same style as ocr.test.js.
// ─────────────────────────────────────────────────────────────

const TIMEOUT = 120000;

async function makeReceipt() {
  const width = 967, height = 1627;
  const lines = [
    { text: 'To Jayaraj', x: 388, y: 190, fontSize: 40, bold: true },
    { text: '+91 xxxxxx 4780', x: 340, y: 250, fontSize: 30, bold: false },
    { text: '\u20B9120', x: 380, y: 400, fontSize: 90, bold: true },
    { text: 'Paid Rs.120 successfully', x: 250, y: 470, fontSize: 34, bold: false },
    { text: 'Completed', x: 390, y: 610, fontSize: 32, bold: false },
    { text: '8 Oct 2026, 4:40 pm', x: 330, y: 710, fontSize: 30, bold: false },
    { text: 'Canara Bank 8619', x: 190, y: 830, fontSize: 28, bold: false },
    { text: 'UPI transaction ID', x: 174, y: 950, fontSize: 28, bold: false },
    { text: 'X12345', x: 174, y: 1000, fontSize: 30, bold: true },
    { text: 'jayarajj126-3@okicici', x: 174, y: 1120, fontSize: 28, bold: false },
  ];
  let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/>`;
  for (const l of lines) svg += `<text x="${l.x}" y="${l.y}" font-family="Arial" font-size="${l.fontSize}" font-weight="${l.bold ? 'bold' : 'normal'}" fill="black">${l.text}</text>`;
  svg += '</svg>';
  return await sharp(Buffer.from(svg)).png().toBuffer();
}

// Runs fn() and returns its result plus the OCR job count consumed.
async function withJobCount(fn) {
  globalThis.__OCRSTATS = [];
  const out = await fn();
  return { out, jobs: globalThis.__OCRSTATS.length };
}

const receipt = await makeReceipt();

afterAll(async () => {
  await closeOCRWorkers();
});

describe('preprocessImage memoization', () => {
  it('returns the identical buffer for the same Buffer instance (memoized)', async () => {
    const first = await preprocessImage(receipt);
    const second = await preprocessImage(receipt);
    expect(second).toBe(first);
    expect(first.length).toBeGreaterThan(0);
  });

  it('recomputes for a different instance but stays byte-identical (deterministic)', async () => {
    const a = await preprocessImage(receipt);
    const b = await preprocessImage(Buffer.from(receipt));
    expect(b).not.toBe(a);
    expect(b.equals(a)).toBe(true);
  });
});

describe('strip recovery: probe + per-strategy early exit', () => {
  it('recovers the expected amount with STRICTLY fewer OCR jobs than the exhaustive scan', async () => {
    // Exhaustive control: no expectedAmount → full-height, all-variants scan.
    const full = await withJobCount(() => runAmountRecoveryOCR(receipt, null));

    // Optimized: probe + expected-amount early exit must reach the SAME
    // acceptance (the amount is recovered) at a strictly lower job count.
    const fast = await withJobCount(() => runAmountRecoveryOCR(receipt, 120));

    expect(fast.out).toContain(120);
    expect(full.out).toContain(120);
    expect(fast.jobs).toBeLessThan(full.jobs);
  }, TIMEOUT);

  it('full-scan behaviour is preserved for a non-matching amount (no false match)', async () => {
    const { out } = await withJobCount(() => runAmountRecoveryOCR(receipt, 999999));
    expect(out).not.toContain(999999);
    expect(out).toContain(120); // the real amount is still extracted
  }, TIMEOUT);
});

describe('currency recovery: per-strategy early exit', () => {
  it('finds currency-adjacent evidence with STRICTLY fewer OCR jobs than a no-match run', async () => {
    // No-match control: impossible amount → all 12 region strategies + all
    // strip-region variants run (exhaustive).
    const exhaustive = await withJobCount(() => verifyAmountWithCurrencyRecovery(receipt, 999999));
    expect(exhaustive.out.verified).toBe(false);

    // Optimized: first strategy with evidence returns immediately.
    const match = await withJobCount(() => verifyAmountWithCurrencyRecovery(receipt, 120));
    expect(match.out.verified).toBe(true);
    expect(match.out.evidence).toMatch(/(?:\u20B9|Rs\.?|INR)\s*120\b/i);
    expect(match.jobs).toBeLessThan(exhaustive.jobs);
  }, TIMEOUT);
});
