// ─────────────────────────────────────────────────────────────
// Screenshot-verification latency audit.
//
// Runs the REAL OCR pipeline (no mocks) over a synthetic UPI receipt and
// prints a per-stage breakdown, so the effect of an OCR optimization can be
// measured instead of guessed.
//
//   node src/scripts/audit-latency.mjs            # default receipt
//   node src/scripts/audit-latency.mjs --json     # machine-readable output
//
// Stages measured:
//   preprocess      sharp resize/grayscale/normalize/sharpen
//   primary_ocr     full-page Tesseract pass
//   additional_ocr  upscaled + thresholded passes
//   strip_recovery  amount-recovery strip scan
//   deep_recovery   currency-corruption region strategies
//   currency_recovery  targeted ₹-symbol region strategies
//   total           end-to-end runScreenshotVerification wall clock
//
// Nothing here touches the database, storage or any payment record.
// ─────────────────────────────────────────────────────────────

import sharp from 'sharp';
import { runScreenshotVerification } from '../services/verificationService.js';
import { closeOCRWorkers } from '../services/ocrService.js';

const JSON_OUT = process.argv.includes('--json');
const SCENARIO = (process.argv.find(a => a.startsWith('--scenario=')) || '--scenario=complete').split('=')[1];

// A synthetic receipt shaped like a Google Pay / Paytm confirmation screen.
async function makeReceipt({ amount = '\u20B9120', name = 'To Jayaraj Alagar', hidePaidLine = false, hideDigits = false } = {}) {
  const width = 967, height = 1627;
  const lines = [
    { text: 'Google Pay', x: 388, y: 120, fontSize: 34, bold: true },
    { text: name, x: 388, y: 190, fontSize: 40, bold: true },
    { text: '+91 xxxxxx 4780', x: 340, y: 250, fontSize: 30, bold: false },
    { text: amount, x: 380, y: 400, fontSize: 90, bold: true },
    { text: 'Paid Rs.120 successfully', x: 250, y: 470, fontSize: 34, bold: false },
    { text: 'Completed', x: 390, y: 610, fontSize: 32, bold: false },
    { text: '8 Oct 2026, 4:40 pm', x: 330, y: 710, fontSize: 30, bold: false },
    { text: 'Canara Bank 8619', x: 190, y: 830, fontSize: 28, bold: false },
    { text: 'UPI transaction ID', x: 174, y: 950, fontSize: 28, bold: false },
    { text: 'X12345', x: 174, y: 1000, fontSize: 30, bold: true },
    { text: 'jayarajj126-3@okicici', x: 174, y: 1120, fontSize: 28, bold: false },
  ];
  let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/>`;
  for (const l of lines) {
    if (hidePaidLine && l.text.startsWith('Paid Rs')) continue;
    // "unreadable" — strip every digit so NO amount can be extracted at all.
    const text = hideDigits ? l.text.replace(/[0-9]/g, 'x') : l.text;
    svg += `<text x="${l.x}" y="${l.y}" font-family="Arial" font-size="${l.fontSize}" font-weight="${l.bold ? 'bold' : 'normal'}" fill="black">${text}</text>`;
  }
  svg += '</svg>';
  return await sharp(Buffer.from(svg)).png().toBuffer();
}

const receipt = await makeReceipt({
  // "none"  — no amount on the receipt at all: forces the FULL recovery chain
  //            (probe -> deep region strategies -> currency region
  //            strategies -> full-height sweep). This is the pathological
  //            case that used to burn the whole HTTP timeout budget.
  // "complete" — the normal case: the primary OCR pass reads everything and
  //            the recovery chain is skipped.
  // "unreadable" — the same receipt WITHOUT any digits anywhere (no amount,
  //            no bank digits, no UTR digits): nothing can be read at all,
  //            so the amount stays unreadable and the recovery budget can
  //            stop the expensive full-height sweep.
  amount: SCENARIO === 'complete' ? '\u20B9120' : '',
  hidePaidLine: SCENARIO !== 'complete',
  hideDigits: SCENARIO === 'unreadable',
});

// Capture the structured per-phase timings the verification engine already
// logs, so the audit reports the SAME numbers the production logs show.
const phases = [];
const originalLog = console.log;
console.log = (...args) => {
  const first = args[0];
  if (first === '[VERIFICATION TIMING]') {
    try { phases.push(JSON.parse(args[1])); } catch { /* ignore */ }
    return;
  }
  originalLog(...args);
};

const t0 = Date.now();
let result;
let error = null;
try {
  const out = await runScreenshotVerification({
    imageBuffer: receipt,
    expectedAmount: 120,
    receiverUpi: 'jayarajj126-3@okicici',
    receiverName: 'Jayaraj Alagar',
  });
  result = out.verificationResult;
} catch (e) {
  error = { code: e?.code || null, message: e?.message || String(e) };
}
const totalMs = Date.now() - t0;

console.log = originalLog;

const byPhase = {};
for (const p of phases) {
  if (p.skipped) { byPhase[p.phase] = { durationMs: 0, skipped: true }; continue; }
  byPhase[p.phase] = { durationMs: p.durationMs, ...(p.candidatesFound !== undefined ? { candidatesFound: p.candidatesFound } : {}) };
}

const summary = {
  scenario: SCENARIO,
  totalMs,
  phases: byPhase,
  ocrJobs: (globalThis.__OCRSTATS || []).length,
  decision: result?.decision ?? null,
  reason: result?.reason ?? null,
  error,
};

if (JSON_OUT) {
  originalLog(JSON.stringify(summary, null, 2));
} else {
  originalLog('\n=== Screenshot verification latency (real OCR) ===');
  originalLog(`scenario:           ${summary.scenario}`);
  originalLog(`total:              ${summary.totalMs} ms`);
  for (const [phase, info] of Object.entries(byPhase)) {
    originalLog(`${phase.padEnd(20)} ${info.skipped ? 'skipped' : info.durationMs + ' ms'}`);
  }
  originalLog(`ocr jobs:           ${summary.ocrJobs}`);
  originalLog(`decision:           ${summary.decision} ${summary.reason || ''}`);
  if (summary.error) originalLog(`error:              ${summary.error.code} ${summary.error.message}`);
  originalLog('');
}

await closeOCRWorkers();
process.exit(0);
