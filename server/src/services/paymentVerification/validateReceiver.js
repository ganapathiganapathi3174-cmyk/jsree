/**
 * Check B — RECEIVER (payee) NAME validation.
 *
 * The expected receiver name comes from SERVER-side configuration only
 * (payment_config.receiver_name, env ADMIN_RECEIVER_NAME fallback) — never
 * from the browser. Case, whitespace and harmless OCR formatting differences
 * are normalized by the shared matcher; only a carefully reviewed set of
 * legitimate variants (token-subset/compact forms of the SAME configured
 * name) can match. An unrelated payee is rejected even when the amount
 * matches. Missing/ambiguous evidence is inconclusive (manual review), never
 * an approval.
 */
import { matchReceiverName } from '../ocrService.js';

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
