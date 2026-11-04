/**
 * Rule B — sender (payer) name validation (advisory identity signal).
 *
 * Runs behind the receiver-UPI / receiver-name / amount gates:
 *   no expected name / policy 'off' -> applicable:false (gate disabled)
 *   exact / compact / token_subset  -> passed:true (supporting evidence)
 *   partial or unreadable          -> passed:null, SENDER_NAME_UNREADABLE
 *                                     (advisory — NEVER blocks the payment)
 *   complete but different name    -> passed:false, SENDER_NAME_MISMATCH
 *                                     (decisionEngine routes per policy:
 *                                      review -> MANUAL_REVIEW, reject ->
 *                                      definitive rejection)
 *
 * A sender match is NEVER sufficient to approve a payment on its own, and a
 * fuzzy/partial sender match never authorizes anything.
 */
import { matchSenderName } from '../ocrService.js';

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
