/**
 * OCR execution primitives for the payment verification engine.
 *
 * Thin wrappers over ocrService (the shared Tesseract/sharp worker layer)
 * so every engine stage consumes OCR through ONE module. Budget/deadline
 * handling is owned by the caller (extractFields) — a deadline overrun
 * always surfaces as OCR_TIMEOUT, which the engine maps to an
 * INCONCLUSIVE outcome (never a decision, never an approval).
 *
 * Tests mock `../ocrService.js`; those mocks apply here because this module
 * only delegates.
 */
import {
  preprocessImage,
  runOCR,
  runAdditionalOCRPasses,
  runAmountRecoveryOCR,
  runDeepAmountRecovery,
} from '../ocrService.js';

export async function preprocessForOCR(buffer) {
  try {
    const processed = await preprocessImage(buffer);
    return { success: true, buffer: processed };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function runOcrPrimary(buffer, { deadline = null } = {}) {
  return runOCR(buffer, { deadline });
}

export async function runOcrAdditionalPasses(buffer, { deadline = null } = {}) {
  return runAdditionalOCRPasses(buffer, { deadline });
}

export async function runAmountRecoveryProbe(buffer, expectedAmount, { deadline = null, softDeadline = null } = {}) {
  return runAmountRecoveryOCR(buffer, expectedAmount, { deadline, softDeadline, scan: 'probe' });
}

export async function runAmountRecoveryDeep(buffer, expectedAmount, { deadline = null, softDeadline = null } = {}) {
  return runDeepAmountRecovery(buffer, expectedAmount, { deadline, softDeadline });
}
