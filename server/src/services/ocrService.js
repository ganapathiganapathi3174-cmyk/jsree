import sharp from 'sharp';
import {
  normalizeAmount as _normalizeAmount,
  normalizeUpiId,
  normalizeUtrValue,
  buildIstDate,
  monthNumber,
} from '../utils/paymentNormalize.js';
import { TIMEZONE as _TIMEZONE, IST_UTC_OFFSET_MS } from '../config/paymentConfig.js';

export const IST_TIMEZONE = _TIMEZONE;

export async function preprocessImage(buffer) {
  return sharp(buffer)
    .resize({ width: 1200, withoutEnlargement: true })
    .grayscale()
    .normalize()
    .sharpen()
    .toBuffer();
}

export function normalizeAmount(text) {
  return _normalizeAmount(text);
}

export function normalizeUPI(upi) {
  return normalizeUpiId(upi);
}

// Case-preserving, space-stripped (legacy OCR display form).
export function normalizeUTR(utr) {
  if (!utr) return null;
  return utr.replace(/\s+/g, '').trim();
}

// Canonical UTR form used for dedup/duplicate comparisons.
export const normalizeUTRValue = normalizeUtrValue;

export function parsePaymentDate(dateStr) {
  if (!dateStr) return null;
  const cleaned = dateStr.replace(/[.\-]/g, '/').trim();
  const dateMatch = cleaned.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!dateMatch) return null;
  let [, day, month, year] = dateMatch;
  if (year.length === 2) year = (parseInt(year) > 50 ? '19' : '20') + year;
  day = parseInt(day);
  month = parseInt(month) - 1;
  year = parseInt(year);

  let hour = 0, minute = 0, second = 0;
  const timeMatch = cleaned.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (timeMatch) {
    hour = parseInt(timeMatch[1]);
    minute = parseInt(timeMatch[2]);
    if (timeMatch[3]) second = parseInt(timeMatch[3]);
    const ampm = timeMatch[4]?.toUpperCase();
    if (ampm === 'PM' && hour !== 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
  }

  // The UPI screenshot timestamp is an India/IST wall-clock reading.
  // Treat the parsed components as Asia/Kolkata (UTC+05:30) and convert to
  // the correct absolute UTC instant; never compare IST wall-clock vs UTC.
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (day < 1 || day > 31 || month < 0 || month > 11) return null;
  // Build the intended absolute instant by interpreting the wall clock as IST.
  const d = buildIstDate({ day, month: month + 1, year, hour, minute, second });
  if (!d) return null;
  // Structural guard: the UTC wall-clock of the intended instant must round-trip
  // to the same year/month when shifted back by +05:30.
  const utcRoundTrip = new Date(d.getTime() + IST_UTC_OFFSET_MS);
  if (utcRoundTrip.getUTCFullYear() !== year || utcRoundTrip.getUTCMonth() !== month || utcRoundTrip.getUTCDate() !== day) return null;
  return d;
}

export function extractAmounts(text) {
  const patterns = [
    /(?:₹|Rs\.?|INR)\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)/gi,
    /(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:₹|Rs\.?|INR)/gi,
    /(?:you\s+paid|payment\s+(?:of|amount)?|amount|paid|sent|total|debit(?:ed)?|transferred)\s*[:\-]?\s*(?:₹|Rs\.?|INR)?\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)/gi,
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

// ─────────────────────────────────────────────────────────────
// UTR extraction.
//
// Label-anchored UTRs ("UTR:", "UPI transaction ID:") come FIRST and are
// the most reliable. Bare 10-14 digit numbers (which on receipts can be
// phone/bank numbers) are only used when no labelled UTR was found, and are
// ordered by length so longer UTR-like values win over short phone digits.
// Results use the canonical uppercase form (see normalizeUTRValue).
// ─────────────────────────────────────────────────────────────
export function extractUTRs(text) {
  const spaceNormalized = text.replace(/(\d)\s+(\d)/g, '$1$2');
  const labeled = [];
  const labeledRe = /(?:utr|txn|transaction|ref(?:erence)?|upi\s*ref(?:\s*no)?|transaction\s*id|bank\s*ref|payment\s*ref|order\s*id|reference\s*number)\s*(?:no|num|id|#|number)?\s*[:\-]?\s*([A-Za-z0-9_]{6,30})/gi;
  let m;
  while ((m = labeledRe.exec(spaceNormalized)) !== null) {
    const v = normalizeUTR(m[1]).toUpperCase();
    if (v && v.length >= 6 && v.length <= 30) labeled.push(v);
  }

  if (labeled.length > 0) return [...new Set(labeled)];

  const bare = [];
  const bareRe = /(?:\b(\d{10,14})\b|\b([A-Za-z]{2,4}\d{8,12})\b)/g;
  let b;
  while ((b = bareRe.exec(spaceNormalized)) !== null) {
    const v = normalizeUTR(b[1] || b[2]).toUpperCase();
    if (v && v.length >= 6 && v.length <= 30) bare.push(v);
  }

  bare.sort((a, b) => b.length - a.length);
  return [...new Set(bare)];
}

export function extractDates(text) {
  const patterns = [
    /(\d{1,2})\s*[\/\-\.]\s*(\d{1,2})\s*[\/\-\.]\s*(\d{2,4})\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?/gi,
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{2,4})/gi,
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2}),?\s+(\d{2,4})/gi,
  ];
  const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const dates = [];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      let dateStr;
      const monthNameIdx = months[(m[2] || m[1] || '').toLowerCase()];
      if (m[4] !== undefined) {
        dateStr = `${m[1]}/${m[2]}/${m[3]} ${m[4] || ''}`.trim();
      } else if (m[2] && monthNameIdx !== undefined) {
        // Pattern 2: "19 Aug 2026" -> m[1]=day, m[2]=month, m[3]=year
        dateStr = `${m[1]}/${monthNameIdx + 1}/${m[3]}`;
      } else if (m[1] && months[m[1].toLowerCase()] !== undefined && m[2] && m[3]) {
        // Pattern 3: "Aug 19, 2026" -> m[1]=month, m[2]=day, m[3]=year
        dateStr = `${m[2]}/${months[m[1].toLowerCase()] + 1}/${m[3]}`;
      } else {
        dateStr = `${m[1]}/${m[2]}/${m[3]}`;
      }
      const d = parsePaymentDate(dateStr);
      if (d) dates.push(d);
    }
  }
  return dates;
}

// ─────────────────────────────────────────────────────────────
// Line-aware date/time extraction.
//
// UPI receipts render the payment timestamp on its own line and commonly
// use formats full-page regexes mishandle:
//   "19/08/2026, 7:39 AM"     (comma before the time)
//   "8 Oct 2026, 4:40 pm"     (month name + am/pm)
// extractDateTimes() keeps the raw wall-clock entries (day/month/year/hour/
// minute + hasTime flag) so the decision engine can distinguish "exact time
// on the receipt" from "date only seen" instead of losing the time entirely.
// ─────────────────────────────────────────────────────────────
const TIME_SUFFIX = String.raw`\s*[,]?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?`;

// Date-only regexes (no time required) — used to detect date-only lines
// so cross-line time pairing works.
const DATE_ONLY_DDMMYYYY = /(\d{1,2})\s*[\/\-\.]\s*(\d{1,2})\s*[\/\-\.]\s*(\d{2,4})/i;
const DATE_ONLY_MONTHNAME = /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{2,4})/i;
const DATE_ONLY_US = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2}),?\s+(\d{2,4})/i;

// Date+time regexes (time required) — used to extract full date+time from
// a single line.
const DATE_TIME_DDMMYYYY = new RegExp(String.raw`(\d{1,2})\s*[\/\-\.]\s*(\d{1,2})\s*[\/\-\.]\s*(\d{2,4})` + TIME_SUFFIX, 'i');
const DATE_TIME_MONTHNAME = new RegExp(String.raw`(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{2,4})` + TIME_SUFFIX, 'i');
const DATE_TIME_US = new RegExp(String.raw`(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2}),?\s+(\d{2,4})` + TIME_SUFFIX, 'i');

function buildDateTimeEntry(raw, day, month, year, hour, minute, second, ampm, hasTime) {
  return { raw, day, month, year, hour, minute, second, ampm, hasTime };
}

export function extractDateTimes(text) {
  if (!text) return [];
  const results = [];
  const lines = String(text).split(/\r?\n/);

  let lastDateEntry = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Try date+time patterns first (time on same line).
    let m = line.match(DATE_TIME_DDMMYYYY);
    if (m && !/@/.test(line)) {
      const entry = buildDateTimeEntry(line,
        parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10),
        m[4] !== undefined ? parseInt(m[4], 10) : null,
        m[5] !== undefined ? parseInt(m[5], 10) : null,
        m[6] !== undefined ? parseInt(m[6], 10) : null,
        m[7] || null, m[4] !== undefined);
      results.push(entry);
      lastDateEntry = entry.hasTime ? null : entry;
      continue;
    }

    m = line.match(DATE_TIME_MONTHNAME);
    if (m) {
      const entry = buildDateTimeEntry(line,
        parseInt(m[1], 10), monthNumber(m[2]), parseInt(m[3], 10),
        m[4] !== undefined ? parseInt(m[4], 10) : null,
        m[5] !== undefined ? parseInt(m[5], 10) : null,
        m[6] !== undefined ? parseInt(m[6], 10) : null,
        m[7] || null, m[4] !== undefined);
      results.push(entry);
      lastDateEntry = entry.hasTime ? null : entry;
      continue;
    }

    m = line.match(DATE_TIME_US);
    if (m) {
      const entry = buildDateTimeEntry(line,
        parseInt(m[2], 10), monthNumber(m[1]), parseInt(m[3], 10),
        m[4] !== undefined ? parseInt(m[4], 10) : null,
        m[5] !== undefined ? parseInt(m[5], 10) : null,
        m[6] !== undefined ? parseInt(m[6], 10) : null,
        m[7] || null, m[4] !== undefined);
      results.push(entry);
      lastDateEntry = entry.hasTime ? null : entry;
      continue;
    }

    // Date-only patterns (no time) — record for cross-line pairing.
    m = line.match(DATE_ONLY_DDMMYYYY);
    if (m && !/@/.test(line)) {
      const entry = buildDateTimeEntry(line,
        parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10),
        null, null, null, null, false);
      results.push(entry);
      lastDateEntry = entry;
      continue;
    }

    m = line.match(DATE_ONLY_MONTHNAME);
    if (m) {
      const entry = buildDateTimeEntry(line,
        parseInt(m[1], 10), monthNumber(m[2]), parseInt(m[3], 10),
        null, null, null, null, false);
      results.push(entry);
      lastDateEntry = entry;
      continue;
    }

    m = line.match(DATE_ONLY_US);
    if (m) {
      const entry = buildDateTimeEntry(line,
        parseInt(m[2], 10), monthNumber(m[1]), parseInt(m[3], 10),
        null, null, null, null, false);
      results.push(entry);
      lastDateEntry = entry;
      continue;
    }

    // Standalone time-only line — pair with the most recent date-only entry.
    if (lastDateEntry && !lastDateEntry.hasTime) {
      const timeOnly = line.match(new RegExp(String.raw`^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$`, 'i'));
      if (timeOnly) {
        const hour = parseInt(timeOnly[1], 10);
        const minute = parseInt(timeOnly[2], 10);
        const second = timeOnly[3] !== undefined ? parseInt(timeOnly[3], 10) : 0;
        const ampm = timeOnly[4] || null;
        if (hour <= 23 && minute <= 59 && second <= 59) {
          const paired = buildDateTimeEntry(
            `${lastDateEntry.raw} ${line}`,
            lastDateEntry.day, lastDateEntry.month, lastDateEntry.year,
            hour, minute, second, ampm, true);
          results.push(paired);
          // Update the date-only entry to reflect the paired time.
          lastDateEntry.hasTime = true;
          lastDateEntry.hour = hour;
          lastDateEntry.minute = minute;
          lastDateEntry.second = second;
          lastDateEntry.ampm = ampm;
          lastDateEntry = null;
        }
      }
    }
  }
  return results;
}

// Convert an extractDateTimes() entry to an absolute Date (IST wall clock).
// Returns null for invalid entries.
export function dateTimeEntryToDate(entry) {
  if (!entry || !entry.day || !entry.month || !entry.year) return null;
  if (entry.hasTime) {
    let hour = entry.hour;
    let minute = entry.minute;
    const second = entry.second || 0;
    const ampm = entry.ampm ? String(entry.ampm).toUpperCase() : null;
    if (ampm === 'PM' && hour !== 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    if (minute === null || hour === null) return null;
    return buildIstDate({ day: entry.day, month: entry.month, year: entry.year, hour, minute, second });
  }
  return buildIstDate({ day: entry.day, month: entry.month, year: entry.year });
}

// Whether two instants fall on the same IST calendar day.
export function isSameIstDay(dateA, dateB) {
  if (!dateA || !dateB) return false;
  const a = new Date(dateA.getTime() + IST_UTC_OFFSET_MS);
  const b = new Date(dateB.getTime() + IST_UTC_OFFSET_MS);
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

// ─────────────────────────────────────────────────────────────
// Transaction-status text detection.
//
// Conservative: returns 'success' / 'failed' / null. Only explicit
// receipt wording counts ("Completed", "Failed", "Declined"). Ambiguous
// or unrelated words are treated as unknown so we never block a genuine
// approval on OCR noise — a detected failure routes to manual review.
// ─────────────────────────────────────────────────────────────
export function extractTransactionStatus(text) {
  if (!text) return null;
  const lower = String(text).toLowerCase();
  const successRe = /\b(completed|success(?:ful|fully)?|paid|money\s*sent|sent\s+successfully|payment\s+successful|transaction\s+successful|transferred)\b/;
  const failedRe = /\b(failed|declined|reversed|unsuccessful|not\s+completed|cancelled?|pending|processing)\b/;
  const success = lower.match(successRe);
  const failed = lower.match(failedRe);
  if (failed) return { status: 'failed', matched: failed[0] };
  if (success) return { status: 'success', matched: success[0] };
  return null;
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
  const dateTimes = extractDateTimes(ocrText);
  const transactionStatus = extractTransactionStatus(ocrText);
  return { amounts, upis, utrs, dates, dateTimes, transactionStatus, rawText: ocrText };
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
  const bound = windowMinutes * 60 * 1000;
  return diff >= -bound && diff <= bound;
}

// Forward-only time window: transaction must be >= serverTime AND
// <= serverTime + windowMinutes.  Past transactions (even 1 second ago)
// do NOT pass.  Used by the verification layer to enforce:
//   "transactionDateTime >= serverCurrentDateTime
//    AND transactionDateTime <= serverCurrentDateTime + 30 minutes"
export function isWithinForwardWindow(date, now, windowMinutes) {
  if (!date) return false;
  const diff = date.getTime() - now.getTime();
  const bound = windowMinutes * 60 * 1000;
  return diff >= 0 && diff <= bound;
}

export { IST_UTC_OFFSET_MS, IST_TIMEZONE as TIMEZONE };