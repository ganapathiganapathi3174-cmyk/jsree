/**
 * Check C — TRANSACTION DATE/TIME validation.
 *
 * Parses the transaction timestamp claimed by the screenshot and compares it
 * against the SERVER-generated upload/verification instant:
 *   - timezone: configured payment timezone, default Asia/Kolkata (the OCR
 *     wall clock is always interpreted as IST — never the host timezone)
 *   - window:   0 <= uploadReference - transactionTime <= windowMinutes
 *               (default 30 min; PAYMENT_TIME_WINDOW_MINUTES)
 *   - future:   a timestamp beyond the configured clock-skew tolerance
 *               (PAYMENT_CLOCK_SKEW_TOLERANCE_SECONDS, default 120s) is a
 *               definitive rejection — real payments happen BEFORE upload
 *   - complete timestamp required: a date-only reading can never auto-approve
 *
 * The upload reference (`receivedAt`) is server-generated ONCE when the
 * backend receives the proof and is never reset by retries, OCR passes or
 * recovery stages — a retry cannot widen the window.
 *
 * Failure codes (reason = legacy-stable code, code = prompt-facing alias):
 *   too old   -> reason INVALID_PAYMENT_DATE_TOO_OLD, code TRANSACTION_TOO_OLD
 *   future    -> reason INVALID_PAYMENT_DATE_FUTURE,  code FUTURE_TRANSACTION_TIMESTAMP
 */
import { PAYMENT_TIME_WINDOW_MINUTES, PAYMENT_CLOCK_SKEW_TOLERANCE_SECONDS, TIMEZONE } from '../../config/paymentConfig.js';
import { istCalendarDayDiff } from '../../utils/paymentNormalize.js';
import { dateTimeEntryToDate } from '../ocrService.js';

export function validateDateTime(dateTimeEntry, receivedAt) {
  if (!dateTimeEntry) {
    return { valid: false, reason: 'PAYMENT_DATE_NOT_DETECTED', code: 'PAYMENT_DATE_NOT_DETECTED' };
  }

  try {
    // Resolve the OCR entry to an absolute instant through the SHARED
    // dateTimeEntryToDate() helper (ocrService) — it converts 12-hour AM/PM
    // readings to 24-hour (2:51 PM -> 14:51, 12:00 AM -> 00:00) and
    // interprets the wall clock as Asia/Kolkata, so validation never depends
    // on the server's local timezone. Null means structurally unparseable.
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

    // Future beyond the configured clock-skew tolerance -> definitive reject.
    const skewToleranceMs = PAYMENT_CLOCK_SKEW_TOLERANCE_SECONDS * 1000;
    if (txDate.getTime() > uploadTime.getTime() + skewToleranceMs) {
      return {
        valid: false,
        reason: 'INVALID_PAYMENT_DATE_FUTURE',
        code: 'FUTURE_TRANSACTION_TIMESTAMP',
        transactionDate: txDate,
        timezone: TIMEZONE,
        skewToleranceSeconds: PAYMENT_CLOCK_SKEW_TOLERANCE_SECONDS,
      };
    }

    // Freshness window: transaction must not be older than the window.
    const diffMs = uploadTime.getTime() - txDate.getTime();
    const diffMinutes = diffMs / (1000 * 60);

    if (diffMinutes > PAYMENT_TIME_WINDOW_MINUTES) {
      return {
        valid: false,
        reason: 'INVALID_PAYMENT_DATE_TOO_OLD',
        code: 'TRANSACTION_TOO_OLD',
        transactionDate: txDate,
        diffMinutes,
        windowMinutes: PAYMENT_TIME_WINDOW_MINUTES,
        timezone: TIMEZONE,
      };
    }

    // Same India calendar day (midnight straddle allowed when inside window).
    const dayDiff = istCalendarDayDiff(txDate, uploadTime);
    if (dayDiff !== 0 && !(dayDiff === -1 && diffMinutes <= PAYMENT_TIME_WINDOW_MINUTES)) {
      return {
        valid: false,
        reason: 'INVALID_PAYMENT_DATE_NOT_TODAY',
        code: 'TRANSACTION_TOO_OLD',
        transactionDate: txDate,
        diffMinutes,
        calendarDayDiff: dayDiff,
        timezone: TIMEZONE,
      };
    }

    if (!dateTimeEntry.hasTime) {
      return {
        valid: false,
        reason: 'PAYMENT_TIME_NOT_DETECTED',
        code: 'PAYMENT_TIME_NOT_DETECTED',
        transactionDate: txDate,
      };
    }

    return { valid: true, transactionDate: txDate, diffMinutes, timezone: TIMEZONE };
  } catch (error) {
    return { valid: false, reason: 'INVALID_PAYMENT_DATE', code: 'INVALID_PAYMENT_DATE' };
  }
}
