import sharp from 'sharp';

export async function preprocessImage(buffer) {
  return sharp(buffer)
    .resize({ width: 1200, withoutEnlargement: true })
    .grayscale()
    .normalize()
    .sharpen()
    .toBuffer();
}

export function normalizeAmount(text) {
  if (!text) return null;
  const cleaned = text.replace(/[,\s]/g, '').trim();
  const match = cleaned.match(/(\d+(?:\.\d{1,2})?)/);
  if (!match) return null;
  return parseFloat(match[1]);
}

export function normalizeUPI(upi) {
  if (!upi) return null;
  return upi.replace(/\s+/g, '').toLowerCase().trim();
}

export function normalizeUTR(utr) {
  if (!utr) return null;
  return utr.replace(/\s+/g, '').trim();
}

export function parsePaymentDate(dateStr) {
  if (!dateStr) return null;
  const cleaned = dateStr.replace(/[.\-]/g, '/').trim();
  const match = cleaned.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return null;
  let [, day, month, year] = match;
  if (year.length === 2) year = (parseInt(year) > 50 ? '19' : '20') + year;
  const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  if (isNaN(d.getTime())) return null;
  if (d.getFullYear() !== parseInt(year) || d.getMonth() !== parseInt(month) - 1 || d.getDate() !== parseInt(day)) return null;
  return d;
}

export function extractAmounts(text) {
  const patterns = [
    /(?:₹|Rs\.?|INR)\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)/gi,
    /(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:₹|Rs\.?|INR)/gi,
    /(?:amount|paid|sent|total|debit(?:ed)?)\s*[:\-]?\s*(?:₹|Rs\.?|INR)?\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)/gi,
  ];
  const amounts = [];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const v = parseFloat(m[1].replace(/,/g, ''));
      if (v > 0 && v < 100000) amounts.push(v);
    }
  }
  if (amounts.length === 0) {
    const plain = text.match(/\b(\d+(?:\.\d{1,2})?)\b/g);
    if (plain) {
      for (const p of plain) {
        const v = parseFloat(p);
        if (v >= 50 && v <= 10000) amounts.push(v);
      }
    }
  }
  return amounts;
}

export function extractUPIs(text) {
  const spaceFixed = text.replace(/(\w)\s+(@\w)/g, '$1$2').replace(/(\w-?\w*)\s+(@\w)/g, '$1$2').replace(/(\w{2,})\s+(\d{2,}-?\d+@\w+)/g, '$1$2');
  const patterns = [
    /([a-zA-Z0-9._-]+@[a-zA-Z0-9]+)/gi,
    /(?:to|vpa|upi\s*id)\s*[:\-]?\s*([a-zA-Z0-9._-]+@[a-zA-Z0-9]+)/gi,
  ];
  const upis = new Set();
  for (const re of patterns) {
    let m;
    while ((m = re.exec(spaceFixed)) !== null) {
      upis.add(normalizeUPI(m[1]));
    }
  }
  return [...upis];
}

export function extractUTRs(text) {
  const spaceNormalized = text.replace(/(\d)\s+(\d)/g, '$1$2');
  const patterns = [
    /(?:utr|txn|transaction|ref(?:erence)?|upi\s*ref)\s*(?:no|num|id|#)?\s*[:\-]?\s*([A-Za-z0-9_]{6,30})/gi,
    /\b(\d{10,14})\b/g,
    /\b([A-Za-z]{2,4}\d{8,12})\b/g,
  ];
  const utrs = [];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(spaceNormalized)) !== null) {
      const v = normalizeUTR(m[1]);
      if (v && v.length >= 6 && v.length <= 30) utrs.push(v);
    }
  }
  return [...new Set(utrs)];
}

export function extractDates(text) {
  const patterns = [
    /(\d{1,2})\s*[\/\-\.]\s*(\d{1,2})\s*[\/\-\.]\s*(\d{2,4})\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?/gi,
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{2,4})/gi,
  ];
  const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const dates = [];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const d = parsePaymentDate(`${m[1]}/${m[2]}/${m[3]}`);
      if (d) dates.push(d);
    }
  }
  return dates;
}

export async function runOCR(imageBuffer) {
  const { default: Tesseract } = await import('tesseract.js');
  const processed = await preprocessImage(imageBuffer);
  const result = await Tesseract.recognize(processed, 'eng');
  return { text: result.data.text || '', confidence: result.data.confidence || 0 };
}

// ─────────────────────────────────────────────────────────────
// Amount-recovery OCR pass.
//
// Full-page Tesseract segmentation can silently drop large-font
// amount lines (common on UPI payment receipts, e.g. Google Pay),
// which produced false AMOUNT_MISMATCH rejections even though the
// screenshot clearly shows the correct amount.
//
// This pass re-runs OCR over overlapping horizontal strips — which
// reliably reads the dropped amount text — and returns ONLY the
// extra amount tokens. It deliberately does not return UPI/UTR/date
// data so the rest of the verification pipeline is untouched.
// ─────────────────────────────────────────────────────────────
export async function runAmountRecoveryOCR(imageBuffer) {
  const { default: Tesseract } = await import('tesseract.js');
  const processed = await preprocessImage(imageBuffer);
  const meta = await sharp(processed).metadata();
  const W = meta.width, H = meta.height;
  const STRIP_H = 220;
  const OVERLAP = 110;
  const recovered = [];
  for (let y = 0; y < H; y += (STRIP_H - OVERLAP)) {
    const h = Math.min(STRIP_H, H - y);
    const strip = await sharp(processed)
      .extract({ left: 0, top: y, width: W, height: h })
      .png()
      .toBuffer();
    const r = await Tesseract.recognize(strip, 'eng', {});
    if (r.data.text) recovered.push(r.data.text);
  }
  return extractAmounts(recovered.join('\n'));
}

export function extractPaymentData(ocrText) {
  const amounts = extractAmounts(ocrText);
  const upis = extractUPIs(ocrText);
  const utrs = extractUTRs(ocrText);
  const dates = extractDates(ocrText);
  return { amounts, upis, utrs, dates, rawText: ocrText };
}

export function matchAmount(extractedAmounts, expectedAmount) {
  return extractedAmounts.some(a => Math.abs(a - expectedAmount) < 0.01);
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0));
  return dp[m][n];
}

export function matchUPI(extractedUPIs, receiverUPI) {
  const norm = normalizeUPI(receiverUPI);
  return extractedUPIs.some(u => {
    const nu = normalizeUPI(u);
    if (nu === norm) return true;
    const maxDist = Math.max(1, Math.floor(norm.length * 0.15));
    return levenshtein(nu, norm) <= maxDist;
  });
}

export function isWithinTimeWindow(date, now, windowMinutes) {
  if (!date) return false;
  const diff = now.getTime() - date.getTime();
  if (diff < 0) return false;
  return diff <= windowMinutes * 60 * 1000;
}
