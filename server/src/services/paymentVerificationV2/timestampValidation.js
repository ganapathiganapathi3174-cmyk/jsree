/**
 * Check C — TRANSACTION DATE validation (date-only, current IST day).
 *
 * Parses the transaction date claimed by the screenshot and compares it
 * against the CURRENT Indian calendar date (Asia/Kolkata) at the server
 * verification instant:
 *   - timezone: configured payment timezone, default Asia/Kolkata (the OCR
 *     wall clock is always interpreted as IST — never the host timezone)
 *   - same IST calendar day  -> valid
 *   - any other IST calendar day (past OR future) -> definitive rejection
 *
 * Transaction TIME is NEVER validated: no hour/minute/second checks, no
 * freshness window, no future clock-skew tolerance. A receipt that prints
 * only the date (no time) is fully acceptable — the date alone is the
 * OCR evidence that matters, and even that can never prove settlement by
 * itself (provider confirmation remains mandatory for approval).
 *
 * Failure codes (reason = stable code):
 *   no date on the receipt -> PAYMENT_DATE_NOT_DETECTED
 *   structurally unparseable date -> INVALID_PAYMENT_DATE
 *   different IST calendar day    -> INVALID_PAYMENT_DATE_NOT_TODAY
 *     (collapsed to INVALID_PAYMENT_DATE by the decision engine; the
 *     variant is preserved in details.variant)
 */
import { TIMEZONE } from '../../config/paymentConfig.js';
import { istCalendarDayDiff } from '../../utils/paymentNormalize.js';
import { dateTimeEntryToDate } from './ocrExtraction.js';

export function validateDateTime(dateTimeEntry, receivedAt) {
  if (!dateTimeEntry) {
    return { valid: false, reason: 'PAYMENT_DATE_NOT_DETECTED', code: 'PAYMENT_DATE_NOT_DETECTED' };
  }

  try {
    // Resolve the OCR entry to an absolute instant through the SHARED
    // dateTimeEntryToDate() helper (ocrService) — it converts 12-hour AM/PM
    // readings to 24-hour (2:51 PM -> 14:51, 12:00 AM -> 00:00) and
    // interprets the wall clock as Asia/Kolkata, so validation never depends
    // on the server's local timezone. Date-only entries resolve to IST
    // midnight of the printed day. Null means structurally unparseable.
    const timePresent = dateTimeEntry.hasTime === true
      || dateTimeEntry.hour != null
      || dateTimeEntry.minute != null;
    const txDate = dateTimeEntryToDate(
      timePresent ? { ...dateTimeEntry, hasTime: true } : dateTimeEntry
    );

    if (!txDate || isNaN(txDate.getTime())) {
      return { valid: false, reason: 'INVALID_PAYMENT_DATE', code: 'INVALID_PAYMENT_DATE' };
    }

    const uploadTime = receivedAt instanceof Date ? receivedAt : new Date();

    // The receipt date must be the CURRENT India calendar day. Time of day
    // (hour / minute / second, or a timestamp "in the future" within the
    // same day) is deliberately never checked.
    const dayDiff = istCalendarDayDiff(txDate, uploadTime);
    if (dayDiff !== 0) {
      return {
        valid: false,
        reason: 'INVALID_PAYMENT_DATE_NOT_TODAY',
        code: 'INVALID_PAYMENT_DATE',
        transactionDate: txDate,
        calendarDayDiff: dayDiff,
        timezone: TIMEZONE,
      };
    }

    return { valid: true, transactionDate: txDate, timezone: TIMEZONE };
  } catch (error) {
    return { valid: false, reason: 'INVALID_PAYMENT_DATE', code: 'INVALID_PAYMENT_DATE' };
  }
}
