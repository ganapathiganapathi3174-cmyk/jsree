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

// ─────────────────────────────────────────────────────────────
// English word → number parser (covers plan amount range 0–9999).
//
// Real Paytm receipts display the amount as "Rupees One Hundred Twenty
// Only" — Tesseract drops the stylised numeric amount entirely.  This
// parser converts the English words to an integer so extractAmounts()
// can recognise it.
//
// Only an allowlist of number words is accepted; random OCR garbage
// that happens to resemble a word is silently ignored.
// ─────────────────────────────────────────────────────────────
const WORD_VALUES = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};
const WORD_MULTIPLIERS = { hundred: 100, thousand: 1000 };

export function wordToNumber(words) {
  if (!words) return 0;
  const tokens = words.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/);
  let total = 0;
  let current = 0;
  for (const t of tokens) {
    if (WORD_VALUES[t] !== undefined) {
      current += WORD_VALUES[t];
    } else if (t === 'hundred') {
      current = current === 0 ? 100 : current * 100;
    } else if (t === 'thousand') {
      total += (current === 0 ? 1 : current) * 1000;
      current = 0;
    } else {
      return 0;
    }
  }
  return total + current;
}

// ─────────────────────────────────────────────────────────────
// Amount extraction — context-aware, noise-resistant.
//
// Priority order:
//   1. Currency-prefixed values (₹120, Rs. 120, INR 120)
//   2. Currency-suffixed values (120₹, 120 Rs.)
//   3. Label-anchored values ("Amount: 120", "You paid 120")
//   4. English word amounts ("Rupees One Hundred Twenty Only")
//
// The numeric fallback is REMOVED from the main extractor: bare digits
// are never treated as payment amounts because they produce false matches
// against year (2026), time (56), phone numbers, UTRs, and other receipt
// noise.  (The recovery-OCR path in runAmountRecoveryOCR uses its own
// narrow fallback — see that function.)
// ─────────────────────────────────────────────────────────────
export function extractAmounts(text) {
  const NUM = '(\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?)';
  const CURRENCY = '(?:₹|Rs\\.?|INR)';
  const LABEL = '(?:you\\s+paid|payment\\s+(?:of|amount|made)?|amount(?:\\s+paid)?|paid|sent|total|debit(?:ed)?|transferred|credited)';

  const patterns = [
    // Currency prefix: ₹120, Rs. 120, INR 120.00
    new RegExp(`${CURRENCY}\\s*${NUM}`, 'gi'),
    // Currency suffix: 120₹, 120 Rs., 120 INR
    new RegExp(`${NUM}\\s*${CURRENCY}`, 'gi'),
    // Label-anchored: "Amount: ₹120", "Paid 120", "You paid ₹120.00"
    new RegExp(`${LABEL}\\s*[:\\-]?\\s*${CURRENCY}?\\s*${NUM}`, 'gi'),
  ];

  const amounts = [];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const v = parseFloat(m[1].replace(/,/g, ''));
      if (v > 0 && v < 100000) amounts.push(v);
    }
  }

  // 4. English word amounts: "Rupees One Hundred Twenty Only" → 120.
  //    Only matches when preceded by a currency-word prefix (Rupees, INR, Rs.)
  //    to avoid extracting random English text as amounts.
  //    [^\n] prevents crossing line boundaries.
  const WORD_AMOUNT_RE = /(?:rupees|inr|rs\.?)\s+(([a-z][^\n]*)+)/gi;
  let wm;
  while ((wm = WORD_AMOUNT_RE.exec(text)) !== null) {
    const phrase = wm[1].replace(/\bonly\b/gi, '').trim();
    const v = wordToNumber(phrase);
    if (v > 0 && v < 100000) amounts.push(v);
  }

  return amounts;
}

// ─────────────────────────────────────────────────────────────
// UPI extraction — context-aware, OCR-artifact resilient.
//
// Priority order:
//   1. Label-anchored extraction (most reliable):
//      "UPI ID: user@bank", "To: user@bank", "VPA: user@bank"
//   2. Global pattern scan on space-fixed text.
//
// Common OCR artifacts handled:
//   - spaces inserted before/after @
//   - newline splits the UPI across lines
//   - trailing character loss on the domain (e.g. "okicic" for "okicici")
//   - visually confused characters (0/O, 1/l/I) are NOT silently
//     corrected — the caller decides on exact match.
// ─────────────────────────────────────────────────────────────
export function extractUPIs(text) {
  if (!text) return [];
  const upis = new Set();

  // 1. Label-anchored: extract UPI from structured receipt labels.
  //    These are the most reliable because the label constrains context.
  const lines = text.split(/\r?\n/);
  const UPI_LABEL_RE = /(?:to|vpa|upi\s*id|receiver|beneficiary|paid\s+to)\s*[:\-]?\s*([a-zA-Z0-9._+-]+\s*@\s*[a-zA-Z0-9]+)/i;
  for (const line of lines) {
    const m = line.match(UPI_LABEL_RE);
    if (m) {
      const cleaned = m[1].replace(/\s+/g, '').trim();
      if (cleaned.includes('@')) upis.add(normalizeUPI(cleaned));
    }
  }

  // 2. Global scan with aggressive space-artifact cleanup.
  //    Collapse whitespace around @, across the entire text.
  const spaceFixed = text
    .replace(/(\w)\s+(@\w)/g, '$1$2')
    .replace(/(\w-?\w*)\s+(@\w)/g, '$1$2')
    .replace(/(\w{2,})\s+(\d{2,}-?\d+@\w+)/g, '$1$2')
    .replace(/\s+@\s+/g, '@')
    .replace(/@\s+/g, '@');

  const upiRe = /([a-zA-Z0-9._+-]+@[a-zA-Z0-9]+)/gi;
  let m;
  while ((m = upiRe.exec(spaceFixed)) !== null) {
    const cleaned = m[1].replace(/\s+/g, '').trim();
    if (cleaned.includes('@') && cleaned.length > 3) {
      upis.add(normalizeUPI(cleaned));
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
  // Join OCR-split digit pairs WITHOUT crossing line breaks (a newline is
  // also \s — joining across it glued the UTR to the next line's date).
  const spaceNormalized = text.replace(/(\d)[ \t]+(\d)/g, '$1$2');
  const labeled = [];
  // Longest-first label alternatives + trailing \b so a short label like
  // "Ref" can never terminate inside "Reference" (which previously let the
  // capture swallow label letters, e.g. extracting "ERENCE").
  const labeledRe = /\b(upi\s*transaction\s*(?:id|ref(?:erence)?(?:\s*(?:no|number))?|ref(?:\s*(?:no|number))?)|transaction\s*(?:id|reference(?:\s*(?:no|number))?|ref(?:\s*(?:no|number))?)|upi\s*ref(?:erence)?(?:\s*(?:no|number))?|bank\s*ref(?:erence)?(?:\s*(?:no|number))?|payment\s*ref(?:erence)?(?:\s*(?:no|number))?|reference\s*(?:no|number|id)|ref(?:erence)?\s*(?:no|number|id)|order\s*id|utr(?:\s*(?:no|number|id))?|ref(?:erence)?(?=\s*[:\-]))\b\s*[:\-]?\s*([A-Za-z0-9_]{6,30})/gi;
  let m;
  while ((m = labeledRe.exec(spaceNormalized)) !== null) {
    const v = normalizeUTR(m[2]).toUpperCase();
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

// Time-before-date regex — Paytm displays "7:50 PM, 26/8/2026" where
// the time component precedes the date.  The standard DATE_TIME_DDMMYYYY
// regex expects date-first and fails to match this format, causing the
// time to be silently lost.
const TIME_BEFORE_DATE_DDMMYYYY = new RegExp(
  String.raw`(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\s*,?\s*(\d{1,2})\s*[\/\-\.]\s*(\d{1,2})\s*[\/\-\.]\s*(\d{2,4})`, 'i'
);

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
    // Paytm time-before-date format: "7:50 PM, 26/8/2026"
    let m = line.match(TIME_BEFORE_DATE_DDMMYYYY);
    if (m && !/@/.test(line)) {
      const entry = buildDateTimeEntry(line,
        parseInt(m[5], 10), parseInt(m[6], 10), parseInt(m[7], 10),
        m[1] !== undefined ? parseInt(m[1], 10) : null,
        m[2] !== undefined ? parseInt(m[2], 10) : null,
        m[3] !== undefined ? parseInt(m[3], 10) : null,
        m[4] || null, m[1] !== undefined);
      results.push(entry);
      lastDateEntry = entry.hasTime ? null : entry;
      continue;
    }

    m = line.match(DATE_TIME_DDMMYYYY);
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
// or unrelated words are treated as unknown — the verification engine
// rejects unknown status as TRANSACTION_FAILED.
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
//
// The strip OCR output may contain bare numbers without currency
// symbols (e.g. just "120" instead of "₹120").  A narrow fallback
// is applied ONLY here — it is tighter than the old broad fallback:
//   - Must be 1–10000 range
//   - Must NOT be a 4-digit year (1900–2099)
//   - Must NOT be in a line containing time patterns (HH:MM)
//   - Must NOT be in a line containing date patterns (DD/MM/YYYY)
//   - Must be ≥ 50 to avoid day/month/hour components
// ─────────────────────────────────────────────────────────────
function extractAmountsFromStrips(text) {
  // First try the standard extraction (currency-prefixed / label-anchored).
  const primary = extractAmounts(text);
  if (primary.length > 0) return primary;

  // Narrow fallback for bare numbers in image strips.
  // Filter at the line level to avoid picking up time/date/UTR noise.
  const lines = text.split(/\r?\n/);
  const results = [];
  for (const line of lines) {
    // Skip lines containing time patterns (HH:MM or H:MM)
    if (/\d{1,2}:\d{2}/.test(line)) continue;
    // Skip lines that are clearly dates (DD/MM/YYYY or DD-MM-YYYY etc.)
    if (/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/.test(line)) continue;
    // Skip lines that look like month-name dates
    if (/\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(line)) continue;
    // Skip lines that look like UTR/reference labels followed by digits
    if (/\b(?:UTR|Ref|Transaction|Reference)\b.*\d/i.test(line)) continue;

    const nums = line.match(/\b(\d+(?:\.\d{1,2})?)\b/g);
    if (!nums) continue;
    for (const p of nums) {
      const v = parseFloat(p);
      if (v <= 0 || v > 10000) continue;
      // Reject 4-digit years (1900–2099)
      if (v >= 1900 && v <= 2099) continue;
      // Reject small integers that are likely day/month/hour components.
      // Payment amounts on our plans are ≥ 120, so anything < 50 is noise.
      if (v >= 1 && v < 50) continue;
      results.push(v);
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
// Additional OCR preprocessing passes.
//
// Tesseract's default segmentation can drop large-font text
// (amounts, UPI IDs) depending on preprocessing. Running extra
// passes with different preprocessing pipelines increases recall
// while keeping false positives low (the strict verification
// gates handle those).
//
// Pass A — Upscaled (2×): better for small labels, UTRs.
// Pass B — Thresholded: isolates high-contrast text, better for
//          large-font amounts that standard preprocessing merges.
//
// Both run in parallel to minimize latency.
// ─────────────────────────────────────────────────────────────
export async function runAdditionalOCRPasses(imageBuffer) {
  const { default: Tesseract } = await import('tesseract.js');

  const [upscaledBuf, thresholdBuf] = await Promise.all([
    sharp(imageBuffer)
      .resize({ width: 2400, withoutEnlargement: false })
      .grayscale()
      .normalize()
      .toBuffer(),
    sharp(imageBuffer)
      .resize({ width: 1200, withoutEnlargement: true })
      .grayscale()
      .normalize()
      .threshold(145)
      .toBuffer(),
  ]);

  const [upscaledResult, thresholdResult] = await Promise.all([
    Tesseract.recognize(upscaledBuf, 'eng'),
    Tesseract.recognize(thresholdBuf, 'eng'),
  ]);

  return [
    { text: upscaledResult.data.text || '', confidence: upscaledResult.data.confidence || 0, pass: 'upscaled' },
    { text: thresholdResult.data.text || '', confidence: thresholdResult.data.confidence || 0, pass: 'thresholded' },
  ];
}

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
  return extractAmountsFromStrips(recovered.join('\n'));
}

// ─────────────────────────────────────────────────────────────
// Demo/screenshot-authenticity detection.
//
// Screenshots containing demo/test markers are NOT genuine payment
// receipts and must be rejected outright.
// ─────────────────────────────────────────────────────────────
const DEMO_MARKERS = /\b(demo|sample|specimen|test\s+payment|mock|simulation|placeholder|example|dummy|fake|not\s+a\s+real|this\s+is\s+not|do\s+not\s+use|for\s+testing|test\s+only|test\s+purpose|screenshot\s+for|payment\s+demo|upi\s+demo)\b/i;

export function isDemoScreenshot(ocrText) {
  if (!ocrText) return false;
  return DEMO_MARKERS.test(ocrText);
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

export function matchUPI(extractedUPIs, receiverUPI) {
  const norm = normalizeUPI(receiverUPI);
  return extractedUPIs.some(u => normalizeUPI(u) === norm);
}

// ─────────────────────────────────────────────────────────────
// UPI matching with OCR-truncation recovery.
//
// Tesseract commonly drops trailing characters from VPA domains
// (e.g. "jayarajj126-3@okicici" → "jayarajj126-3@okicic").
//
// Recovery strategy — deliberately conservative:
//   1. Exact normalized match → high confidence
//   2. Candidate is a strict prefix of expected (missing 1–2 trailing
//      chars) → high confidence (truncation recovery)
//   3. Everything else → no match
//
// Substitutions, transpositions, mid-string errors are NEVER recovered.
// The expected UPI is the authoritative reference; only when the OCR
// evidence is overwhelmingly close (same prefix, trailing loss) do we
// accept the candidate.
// ─────────────────────────────────────────────────────────────
export function matchUPIWithRecovery(extractedUPIs, receiverUPI) {
  const norm = normalizeUPI(receiverUPI);
  const allCandidates = extractedUPIs.map(u => normalizeUPI(u)).filter(Boolean);

  // 1. Exact match (strongest evidence)
  for (const c of allCandidates) {
    if (c === norm) {
      return {
        match: true, method: 'exact', confidence: 'high',
        candidate: c, allCandidates, originalCandidates: extractedUPIs,
      };
    }
  }

  // 2. OCR recovery: trailing-character truncation
  //    Candidate must be a perfect prefix of expected, missing 1–2 chars.
  for (const c of allCandidates) {
    if (!c || c.length < 5) continue;
    const missing = norm.length - c.length;
    if (missing >= 1 && missing <= 2 && norm.startsWith(c)) {
      return {
        match: true, method: 'ocr_recovery_truncation', confidence: 'high',
        candidate: c, allCandidates, originalCandidates: extractedUPIs,
      };
    }
  }

  return {
    match: false, method: 'none', confidence: 'none',
    candidate: null, allCandidates, originalCandidates: extractedUPIs,
  };
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