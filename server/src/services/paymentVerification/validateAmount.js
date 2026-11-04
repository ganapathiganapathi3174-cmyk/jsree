/**
 * Check A — AMOUNT validation.
 *
 * The expected amount is ALWAYS the server-resolved value stored on the
 * payment/top-up record; a browser-supplied amount is never an input here.
 * OCR readings are untrusted claims compared against that expectation:
 *   - exact match (or the documented ₹→"2" Tesseract corruption of the SOLE
 *     distinct reading)  -> valid
 *   - confident mismatch / conflicting distinct readings -> definitive reject
 *   - nothing read       -> AMOUNT_NOT_DETECTED (inconclusive; never approve)
 */
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
