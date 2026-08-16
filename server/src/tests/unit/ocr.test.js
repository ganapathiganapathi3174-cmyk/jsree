import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  normalizeAmount,
  normalizeUPI,
  normalizeUTR,
  parsePaymentDate,
  extractAmounts,
  extractUPIs,
  extractUTRs,
  extractDates,
  matchAmount,
  matchUPI,
  isWithinTimeWindow,
  runOCR,
  runAmountRecoveryOCR,
} from '../../services/ocrService.js';

describe('OCR Service - Amount Extraction', () => {
  it('extracts amount with ₹ prefix', () => {
    const result = extractAmounts('You paid ₹120 to merchant');
    expect(result).toContain(120);
  });

  it('extracts amount with Rs. prefix', () => {
    const result = extractAmounts('Rs.500 sent successfully');
    expect(result).toContain(500);
  });

  it('extracts amount with INR prefix', () => {
    const result = extractAmounts('INR 1000 debited');
    expect(result).toContain(1000);
  });

  it('extracts amount with ₹ prefix and decimal', () => {
    const result = extractAmounts('₹120.00 paid');
    expect(result).toContain(120);
  });

  it('extracts amount after "amount" keyword', () => {
    const result = extractAmounts('Amount: 500');
    expect(result).toContain(500);
  });

  it('extracts plain number amount between 50-10000', () => {
    const result = extractAmounts('Payment of 750 completed');
    expect(result).toContain(750);
  });

  it('extracts amount with comma separator', () => {
    const result = extractAmounts('₹1,000 paid');
    expect(result).toContain(1000);
  });

  it('returns empty array for no amounts', () => {
    const result = extractAmounts('No payment info here');
    expect(result).toEqual([]);
  });

  it('normalizes amount string to number', () => {
    expect(normalizeAmount('₹120')).toBe(120);
    expect(normalizeAmount('Rs.500')).toBe(500);
    expect(normalizeAmount('1,000')).toBe(1000);
    expect(normalizeAmount('120.50')).toBe(120.5);
  });
});

describe('OCR Service - UPI Extraction', () => {
  it('extracts UPI ID with @ symbol', () => {
    const result = extractUPIs('Paid to jayarajj126-3@okicici');
    expect(result).toContain('jayarajj126-3@okicici');
  });

  it('normalizes UPI to lowercase', () => {
    const result = extractUPIs('JAYARAJJ126-3@OKICICI');
    expect(result).toContain('jayarajj126-3@okicici');
  });

  it('extracts UPI after "to" keyword', () => {
    const result = extractUPIs('Sent to user@upi');
    expect(result).toContain('user@upi');
  });

  it('returns empty for no UPI', () => {
    const result = extractUPIs('No UPI info');
    expect(result).toEqual([]);
  });

  it('normalizes UPI string', () => {
    expect(normalizeUPI('JAYARAJJ126-3@OKICICI')).toBe('jayarajj126-3@okicici');
    expect(normalizeUPI('user @ upi')).toBe('user@upi');
  });
});

describe('OCR Service - UTR Extraction', () => {
  it('extracts UTR after "UTR" keyword', () => {
    const result = extractUTRs('UTR: 123456789012');
    expect(result).toContain('123456789012');
  });

  it('extracts UTR after "Transaction ID"', () => {
    const result = extractUTRs('Transaction ID: TXN9876543210');
    expect(result).toContain('TXN9876543210');
  });

  it('extracts UTR after "Ref No"', () => {
    const result = extractUTRs('Ref No: 1234567890');
    expect(result).toContain('1234567890');
  });

  it('extracts 10-14 digit number as UTR', () => {
    const result = extractUTRs('Payment done 12345678901234');
    expect(result).toContain('12345678901234');
  });

  it('normalizes UTR by removing spaces', () => {
    const result = extractUTRs('UTR: 1234 5678 9012');
    expect(result).toContain('123456789012');
  });

  it('returns empty for no UTR', () => {
    const result = extractUTRs('No transaction info');
    expect(result).toEqual([]);
  });

  it('normalizes UTR string', () => {
    expect(normalizeUTR('1234 5678 9012')).toBe('123456789012');
    expect(normalizeUTR('ABC-123-DEF')).toBe('ABC-123-DEF');
  });
});

describe('OCR Service - Date Extraction', () => {
  it('extracts DD/MM/YYYY format', () => {
    const result = extractDates('Date: 15/06/2025');
    expect(result.length).toBeGreaterThan(0);
    // 15/06/2025 00:00 IST == 2025-06-14T18:30:00Z (read as UTC component-wise).
    expect(result[0].getUTCFullYear()).toBe(2025);
    expect(result[0].getUTCMonth()).toBe(5);
    expect(result[0].toISOString()).toBe('2025-06-14T18:30:00.000Z');
  });

  it('extracts DD-MM-YYYY format', () => {
    const result = extractDates('Date: 15-06-2025');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].toISOString()).toBe('2025-06-14T18:30:00.000Z');
  });

  it('extracts DD.MM.YYYY format', () => {
    const result = extractDates('Date: 15.06.2025');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].toISOString()).toBe('2025-06-14T18:30:00.000Z');
  });

  it('handles 2-digit year', () => {
    const result = extractDates('Date: 15/06/25');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].getUTCFullYear()).toBe(2025);
  });

  it('returns empty for no dates', () => {
    const result = extractDates('No date here');
    expect(result).toEqual([]);
  });

  it('parses Indian DD/MM/YYYY correctly (not MM/DD/YYYY)', () => {
    const result = parsePaymentDate('25/12/2025');
    expect(result).not.toBeNull();
    expect(result.toISOString()).toBe('2025-12-24T18:30:00.000Z');
  });
});

describe('OCR Service - Matching Functions', () => {
  it('matchAmount returns true for matching amounts', () => {
    expect(matchAmount([120, 500], 120)).toBe(true);
    expect(matchAmount([120.0, 500.0], 120)).toBe(true);
  });

  it('matchAmount returns false for non-matching amounts', () => {
    expect(matchAmount([100, 200], 120)).toBe(false);
    expect(matchAmount([], 120)).toBe(false);
  });

  it('matchUPI returns true for matching UPI', () => {
    expect(matchUPI(['jayarajj126-3@okicici'], 'jayarajj126-3@okicici')).toBe(true);
    expect(matchUPI(['JAYARAJJ126-3@OKICICI'], 'jayarajj126-3@okicici')).toBe(true);
  });

  it('matchUPI returns false for non-matching UPI', () => {
    expect(matchUPI(['other@upi'], 'jayarajj126-3@okicici')).toBe(false);
    expect(matchUPI([], 'jayarajj126-3@okicici')).toBe(false);
  });
});

describe('OCR Service - Time Window', () => {
  it('returns true for date within window', () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 5 * 60 * 1000);
    expect(isWithinTimeWindow(recent, now, 30)).toBe(true);
  });

  it('returns false for date outside window', () => {
    const now = new Date();
    const old = new Date(now.getTime() - 60 * 60 * 1000);
    expect(isWithinTimeWindow(old, now, 30)).toBe(false);
  });

  it('returns true for future date within window', () => {
    const now = new Date();
    const future = new Date(now.getTime() + 5 * 60 * 1000);
    expect(isWithinTimeWindow(future, now, 30)).toBe(true);
  });

  it('returns false for future date beyond +30 min', () => {
    const now = new Date();
    const future = new Date(now.getTime() + 31 * 60 * 1000);
    expect(isWithinTimeWindow(future, now, 30)).toBe(false);
  });

  it('returns false for null date', () => {
    expect(isWithinTimeWindow(null, new Date(), 30)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// Regression: ₹120 false AMOUNT_MISMATCH.
// Full-page Tesseract segmentation drops large-font amount lines
// on UPI receipts (amount rendered ~90px tall). The recovery band
// pass must recover the dropped amount so matchAmount() passes,
// while still NOT treating unrelated phone/bank/year digits as the
// amount. This guards against the exact production bug where a
// ₹120 screenshot was rejected as AMOUNT_MISMATCH.
// ─────────────────────────────────────────────────────────────
async function makeGpayStyleReceipt(amountText) {
  const width = 967, height = 1627;
  const lines = [
    { text: 'To Jayaraj', x: 388, y: 190, fontSize: 40, bold: true },
    { text: '+91 xxxxxx 4780', x: 340, y: 250, fontSize: 30, bold: false },
    { text: amountText, x: 355, y: 400, fontSize: 90, bold: true },
    { text: 'Completed', x: 390, y: 610, fontSize: 32, bold: true },
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

describe('Regression: large-font amount recovery (false AMOUNT_MISMATCH)', () => {
  const timeout = 120000;

  it('recovers a dropped ₹120 amount and matches while rejecting 500/1000', async () => {
    const img = await makeGpayStyleReceipt('120');
    const main = await runOCR(img);
    const mainAmounts = extractAmounts(main.text);
    // The large-font amount line is commonly DROPPED by full-page OCR;
    // without recovery the plain fallback picks unrelated digits only.
    expect(mainAmounts).not.toContain(120);

    const recovered = await runAmountRecoveryOCR(img);
    const merged = [...new Set([...mainAmounts, ...recovered])];
    expect(merged).toContain(120);
    expect(matchAmount(merged, 120)).toBe(true);
    // Must not create false matches for other plan amounts.
    expect(matchAmount(merged, 500)).toBe(false);
    expect(matchAmount(merged, 1000)).toBe(false);
  }, timeout);

  for (const amount of ['500', '1000']) {
    it(`recovers a dropped ₹${amount} amount and matches exactly`, async () => {
      const img = await makeGpayStyleReceipt(amount);
      const main = await runOCR(img);
      const mainAmounts = extractAmounts(main.text);
      expect(mainAmounts).not.toContain(parseInt(amount));

      const recovered = await runAmountRecoveryOCR(img);
      const merged = [...new Set([...mainAmounts, ...recovered])];
      expect(merged).toContain(parseInt(amount));
      expect(matchAmount(merged, parseInt(amount))).toBe(true);
    }, timeout);
  }

  it('mismatched screenshot (paid 120, plan 500) still fails the exact comparison', async () => {
    const img = await makeGpayStyleReceipt('120');
    const recovered = await runAmountRecoveryOCR(img);
    const mainAmounts = extractAmounts((await runOCR(img)).text);
    const merged = [...new Set([...mainAmounts, ...recovered])];
    expect(matchAmount(merged, 500)).toBe(false);
  }, timeout);
});
