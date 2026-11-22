/**
 * Check B — RECEIVER (payee) NAME validation. INFORMATIONAL ONLY.
 *
 * The expected receiver name comes from SERVER-side configuration only
 * (payment_config.receiver_name, env ADMIN_RECEIVER_NAME fallback) — never
 * from the browser. Case, whitespace, punctuation and harmless OCR spacing
 * differences are normalized by the shared matcher (including split forms
 * like "JAYA RAJ" for "Jayaraj" and additional names like "Jayaraj
 * Alagar"). The result is recorded as an advisory check for the admin UI:
 * a mismatch or unreadable name NEVER rejects, parks, or approves a
 * payment on its own — approval requires the mandatory gates PLUS the
 * payment-provider confirmation policy.
 */
import { matchReceiverName } from './ocrExtraction.js';

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
