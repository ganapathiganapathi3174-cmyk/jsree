/**
 * Stage 6-9: Validation Rules
 *
 * Reason codes mirror the legacy verificationService gate semantics exactly:
 *   - NOT_DETECTED / UNREADABLE / INCOMPLETE / NOT_CONFIGURED  -> inconclusive
 *   - MISMATCH / CONFLICT / INVALID_* / MISSING_*              -> definitive
 * (The conclusive/inconclusive classification happens in decisionEngine.)
 */
import { PAYMENT_TIME_WINDOW_MINUTES } from '../../config/paymentConfig.js';
import { istCalendarDayDiff } from '../../utils/paymentNormalize.js';
import { matchReceiverName, matchSenderName, dateTimeEntryToDate } from '../ocrService.js';

export function normalizeAmountStrict(amount) {
  if (!amount && amount !== 0) return null;
  // Remove currency symbols, commas, spaces
  const cleaned = String(amount).replace(/[₹$€£\s,]/g, '').trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return num;
}

// Documented OCR corruption: Tesseract reads the ₹ glyph on the large-font
// Google Pay amount as a leading "2" (₹120 -> "2120"). Evidence is preferred
// (the recovery passes re-read the amount region first); this rule only stops
// the conflict gate from rejecting a receipt whose SOLE distinct reading is
// that corruption. It can only accept a value STRICTLY LARGER than expected,
// so it is never an underpayment vector, and any other distinct candidate
// still rejects.
function isCurrencyCorruption(candidate, expected) {
  return Number.isInteger(expected) && candidate === Number(`2${expected}`);
}

export function validateAmount(extractedAmounts, expectedAmount) {
  if (!expectedAmount && expectedAmount !== 0) {
    return { valid: false, reason: 'MISSING_EXPECTED_AMOUNT', detected: extractedAmounts };
  }

  if (!extractedAmounts || extractedAmounts.length === 0) {
    return { valid: false, reason: 'AMOUNT_NOT_DETECTED', detected: [] };
  }

  const expected = Number(expectedAmount);
  // Check for exact match
  for (const amt of extractedAmounts) {
    const normalized = normalizeAmountStrict(amt);
    if (normalized === expected) {
      return { valid: true, matchedAmount: normalized, method: 'exact', detected: extractedAmounts };
    }
  }

  const normalized = extractedAmounts.map(a => normalizeAmountStrict(a)).filter(n => n !== null);
  const unique = [...new Set(normalized)];

  // Sole reading is the documented ₹->"2" corruption: accept as the
  // expected amount (recovery passes already ran without contradicting it).
  if (unique.length === 1 && isCurrencyCorruption(unique[0], expected)) {
    return {
      valid: true,
      matchedAmount: expected,
      method: 'currency_corruption',
      detected: extractedAmounts,
    };
  }

  // Conflicting distinct readings with no exact match -> definitive reject.
  if (unique.length > 1) {
    return { valid: false, reason: 'CONFLICTING_AMOUNTS', detected: extractedAmounts };
  }

  return { valid: false, reason: 'AMOUNT_MISMATCH', detected: extractedAmounts, expected };
}

export function validateReceiver(extractedReceiverNames, configuredReceiverName) {
  if (!configuredReceiverName || configuredReceiverName.trim() === '') {
    return { valid: false, reason: 'RECEIVER_NAME_NOT_CONFIGURED', detected: extractedReceiverNames };
  }

  // Shared matcher: exact / compact / token-subset accept; partial read and
  // unreadable are distinct inconclusive outcomes; a confidently different
  // payee is a definitive reject.
  const result = matchReceiverName(extractedReceiverNames, configuredReceiverName);

  if (result.match) {
    return {
      valid: true,
      matchedName: result.matched,
      method: result.method,
      detected: extractedReceiverNames,
    };
  }
  if (result.method === 'no_config') {
    return { valid: false, reason: 'RECEIVER_NAME_NOT_CONFIGURED', detected: extractedReceiverNames };
  }
  if (result.method === 'not_found') {
    return { valid: false, reason: 'RECEIVER_NAME_UNREADABLE', detected: extractedReceiverNames };
  }
  if (result.partial === true) {
    return {
      valid: false,
      reason: 'RECEIVER_NAME_INCOMPLETE',
      detected: extractedReceiverNames,
      matched: result.matched,
    };
  }
  return { valid: false, reason: 'RECEIVER_NAME_MISMATCH', detected: extractedReceiverNames };
}

export function validateDateTime(dateTimeEntry, receivedAt) {
  if (!dateTimeEntry) {
    return { valid: false, reason: 'PAYMENT_DATE_NOT_DETECTED' };
  }

  try {
    // Resolve the OCR entry to an absolute instant through the SHARED
    // dateTimeEntryToDate() helper (ocrService) — the SAME conversion the
    // legacy pipeline uses. It converts 12-hour AM/PM readings to 24-hour
    // (2:51 PM -> 14:51, 12:00 AM -> 00:00) and interprets the wall clock
    // as Asia/Kolkata, so validation never depends on the server's local
    // timezone. Null means the entry is structurally unparseable.
    //
    // The helper keys off `hasTime`; this gate's historical contract also
    // honours any time-of-day fields present on the entry, so pass a
    // time-bearing view whenever a clock reading exists. Date-only entries
    // (no hour/minute) still resolve to IST midnight exactly as before and
    // fall through to the explicit `!hasTime` check below.
    const timePresent = dateTimeEntry.hasTime === true
      || dateTimeEntry.hour != null
      || dateTimeEntry.minute != null;
    const txDate = dateTimeEntryToDate(
      timePresent ? { ...dateTimeEntry, hasTime: true } : dateTimeEntry
    );

    if (!txDate || isNaN(txDate.getTime())) {
      return { valid: false, reason: 'INVALID_PAYMENT_DATE' };
    }

    const uploadTime = receivedAt instanceof Date ? receivedAt : new Date();

    // Must not be in future
    if (txDate > uploadTime) {
      return { valid: false, reason: 'INVALID_PAYMENT_DATE_FUTURE' };
    }

    // Check if within 30 minutes
    const diffMs = uploadTime.getTime() - txDate.getTime();
    const diffMinutes = diffMs / (1000 * 60);

    if (diffMinutes > PAYMENT_TIME_WINDOW_MINUTES) {
      return { valid: false, reason: 'INVALID_PAYMENT_DATE_TOO_OLD' };
    }

    if (diffMinutes < 0) {
      return { valid: false, reason: 'INVALID_PAYMENT_DATE_FUTURE' };
    }

    // Check if same calendar day in IST
    const dayDiff = istCalendarDayDiff(txDate, uploadTime);
    if (dayDiff !== 0 && !(dayDiff === -1 && diffMinutes <= PAYMENT_TIME_WINDOW_MINUTES)) {
      // Allow midnight straddle
      if (!(dayDiff === -1 && diffMinutes <= PAYMENT_TIME_WINDOW_MINUTES)) {
        return { valid: false, reason: 'INVALID_PAYMENT_DATE_NOT_TODAY' };
      }
    }

    if (!dateTimeEntry.hasTime) {
      return { valid: false, reason: 'PAYMENT_TIME_NOT_DETECTED' };
    }

    return { valid: true, transactionDate: txDate, diffMinutes };
  } catch (error) {
    return { valid: false, reason: 'INVALID_PAYMENT_DATE' };
  }
}

export function validateTransactionId(utrs) {
  if (!utrs || utrs.length === 0) {
    return { valid: false, reason: 'MISSING_UTR', detected: [] };
  }

  // Get the first valid-looking UTR
  for (const utr of utrs) {
    const normalized = String(utr).replace(/\s+/g, '').trim();
    if (normalized && normalized.length >= 6) { // UPI refs are usually longer
      return { valid: true, transactionId: normalized, raw: utr };
    }
  }

  return { valid: false, reason: 'MISSING_UTR', detected: utrs };
}

// ─────────────────────────────────────────────────────────────
// Rule B — sender (payer) name validation.
//
// ADVISORY identity signal behind the receiver-UPI / receiver-name / amount
// gates. Semantics (policy = off | review | reject, default review):
//
//   no expected name / policy 'off' -> applicable:false (gate disabled)
//   exact / compact / token_subset  -> passed:true (supporting evidence)
//   partial or unreadable          -> passed:null, SENDER_NAME_UNREADABLE
//                                     (advisory — NEVER blocks the payment)
//   complete but different name    -> passed:false, SENDER_NAME_MISMATCH
//                                     (decisionEngine routes per policy:
//                                      review -> MANUAL_REVIEW, reject ->
//                                      definitive rejection)
//
// A sender match is NEVER sufficient to approve a payment on its own, and a
// fuzzy/partial sender match never authorizes anything.
// ─────────────────────────────────────────────────────────────
export function validateSender(extractedSenderNames, expectedPayerName, policy = 'review') {
  if (policy === 'off' || !expectedPayerName || String(expectedPayerName).trim() === '') {
    return { applicable: false, passed: null, reason: null, method: 'disabled', policy };
  }

  const detected = extractedSenderNames || [];
  const result = matchSenderName(detected, expectedPayerName);
  const base = { applicable: true, policy, expected: expectedPayerName, detected, method: result.method };

  if (result.match) {
    return { ...base, passed: true, reason: null, matched: result.matched };
  }
  if (result.method === 'partial' || result.method === 'not_found' || result.method === 'no_config') {
    // Incomplete/unreadable evidence — advisory only.
    return { ...base, passed: null, reason: 'SENDER_NAME_UNREADABLE', matched: result.matched || null };
  }
  // A complete but different payer name.
  return { ...base, passed: false, reason: 'SENDER_NAME_MISMATCH', matched: null };
}
