// Finds a rendering of the amount that the plain OCR passes read as a
// CORRUPTED number ("2120" instead of "₹120") but that aggressive
// thresholding (the deep-recovery stage) reads correctly. Used to measure
// the recovery-stage reorder: with the old order the full-height scan ran
// BEFORE deep recovery, so the amount was only found after ~60 wasted jobs.
//
//   node src/scripts/audit-recovery-order.mjs
import sharp from 'sharp';
import {
  runAmountRecoveryOCR,
  runDeepAmountRecovery,
  verifyAmountWithCurrencyRecovery,
  closeOCRWorkers,
} from '../services/ocrService.js';

const W = 967, H = 1627;

function svg(amountText, opts = {}) {
  const lines = [
    { text: 'To Jayaraj Alagar', x: 388, y: 190, size: 40, bold: true },
    { text: amountText, x: opts.x ?? 380, y: opts.y ?? 400, size: opts.size ?? 90, bold: opts.bold ?? true },
    { text: 'Completed', x: 390, y: 610, size: 32 },
    { text: '8 Oct 2026, 4:40 pm', x: 330, y: 710, size: 30 },
    { text: 'UPI transaction ID', x: 174, y: 950, size: 28 },
    { text: 'X12345', x: 174, y: 1000, size: 30, bold: true },
    { text: 'jayarajj126-3@okicici', x: 174, y: 1120, size: 28 },
  ];
  let s = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/>`;
  for (const l of lines) {
    s += `<text x="${l.x}" y="${l.y}" font-family="${opts.font ?? 'Arial'}" font-size="${l.size}" font-weight="${l.bold ? 'bold' : 'normal'}" fill="${opts.fill ?? 'black'}">${l.text}</text>`;
  }
  return s + '</svg>';
}

const render = (s) => sharp(Buffer.from(s)).png().toBuffer();

function found(list, exp) { return list.some(a => Math.abs(a - exp) < 0.01); }

// ── 1. Look for a corrupted rendering ─────────────────────────────
const variants = [
  { label: 'Arial 90 bold', s: svg('\u20B9120') },
  { label: 'Arial 120 bold', s: svg('\u20B9120', { size: 120, y: 420 }) },
  { label: 'Arial 150 bold', s: svg('\u20B9120', { size: 150, y: 430 }) },
  { label: 'DejaVu 150 bold', s: svg('\u20B9120', { size: 150, y: 430, font: 'DejaVu Sans' }) },
  { label: 'Arial 150 bold grey', s: svg('\u20B9120', { size: 150, y: 430, fill: '#808080' }) },
  { label: 'Arial 150 bold + stroke', s: svg('\u20B9120', { size: 150, y: 430 }).replace('</svg>', '<text x="360" y="430" font-family="Arial" font-size="150" font-weight="bold" fill="none" stroke="white" stroke-width="3">\u20B9120</text></svg>') },
];

const corrupted = [];
for (const v of variants) {
  const buf = await render(v.s);
  globalThis.__OCRSTATS = [];
  const probe = await runAmountRecoveryOCR(buf, 120, { scan: 'probe' });
  const deep = await runDeepAmountRecovery(buf, 120);
  const probeHit = found(probe, 120);
  const deepHit = found(deep, 120);
  console.log(`${v.label.padEnd(24)} probe=${JSON.stringify(probe).slice(0, 60).padEnd(62)} probeHit=${probeHit} deepHit=${deepHit}`);
  if (!probeHit && deepHit) corrupted.push({ label: v.label, buf });
}

if (!corrupted.length) {
  console.log('\nNo corrupted rendering reproduced on this machine — the reorder cannot be measured directly here.');
  await closeOCRWorkers();
  process.exit(0);
}

const target = corrupted[0];
console.log(`\nUsing corrupted rendering: ${target.label}\n`);

async function measure(label, fn) {
  globalThis.__OCRSTATS = [];
  const t0 = Date.now();
  const hit = await fn();
  const ms = Date.now() - t0;
  console.log(`${label.padEnd(30)} jobs=${String(globalThis.__OCRSTATS.length).padStart(4)}  ${String(ms).padStart(6)} ms  recovered=${hit ? 'YES' : 'no'}`);
  return { jobs: globalThis.__OCRSTATS.length, ms, hit };
}

// OLD order: full-height scan first, deep recovery second.
const oldOrder = await measure('OLD order (full scan first)', async () => {
  const scan = await runAmountRecoveryOCR(target.buf, 120, { scan: 'full' });
  if (found(scan, 120)) return true;
  const deep = await runDeepAmountRecovery(target.buf, 120);
  return found(deep, 120);
});

// NEW order: cheap top-region probe, then the deep region strategies.
const newOrder = await measure('NEW order (region first)', async () => {
  const probe = await runAmountRecoveryOCR(target.buf, 120, { scan: 'probe' });
  if (found(probe, 120)) return true;
  const deep = await runDeepAmountRecovery(target.buf, 120);
  if (found(deep, 120)) return true;
  const cur = await verifyAmountWithCurrencyRecovery(target.buf, 120);
  return cur.verified;
});

console.log(`\nsaving: ${oldOrder.jobs - newOrder.jobs} OCR jobs (${oldOrder.ms - newOrder.ms} ms)`);
await closeOCRWorkers();
process.exit(0);
