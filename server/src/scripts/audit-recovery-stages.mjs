// Per-stage recovery-success + cost matrix.
//
//   node src/scripts/audit-recovery-stages.mjs
//
// For every synthetic receipt variant it runs each amount-recovery stage in
// ISOLATION and reports whether that stage alone recovered the expected
// amount, plus the OCR job count and wall-clock cost. The matrix is the
// evidence used to size the recovery budgets (OCR_AMOUNT_RECOVERY_BUDGET_MS /
// OCR_RECOVERY_STAGE_BUDGET_MS) and to decide which stages must be kept.
import sharp from 'sharp';
import {
  runAmountRecoveryOCR,
  runDeepAmountRecovery,
  verifyAmountWithCurrencyRecovery,
  closeOCRWorkers,
} from '../services/ocrService.js';

const W = 967, H = 1627;
const EXPECTED = 120;

function build({ amountText, size = 90, y = 400, fill = 'black', font = 'Arial', stroke = null, blur = 0 }) {
  const lines = [
    { text: 'To Jayaraj Alagar', x: 388, y: 190, size: 40, bold: true },
    { text: amountText, x: 372, y, size, bold: true },
    { text: 'Completed', x: 390, y: 610, size: 32 },
    { text: '8 Oct 2026, 4:40 pm', x: 330, y: 710, size: 30 },
    { text: 'UPI transaction ID', x: 174, y: 950, size: 28 },
    { text: 'X12345', x: 174, y: 1000, size: 30, bold: true },
    { text: 'jayarajj126-3@okicici', x: 174, y: 1120, size: 28 },
  ];
  let s = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/>`;
  for (const l of lines) {
    const extra = l.text === amountText && stroke ? ` stroke="white" stroke-width="${stroke}"` : '';
    s += `<text x="${l.x}" y="${l.y}" font-family="${font}" font-size="${l.size}" font-weight="${l.bold ? 'bold' : 'normal'}" fill="${fill}"${extra}>${l.text}</text>`;
  }
  s += '</svg>';
  return sharp(Buffer.from(s)).png().toBuffer();
}

const variants = [
  { label: 'plain 90',            buf: await build({ amountText: '\u20B9120' }) },
  { label: 'plain 150',           buf: await build({ amountText: '\u20B9120', size: 150, y: 430 }) },
  { label: 'grey 150 (corrupt)',  buf: await build({ amountText: '\u20B9120', size: 150, y: 430, fill: '#808080' }) },
  { label: 'lightgrey 150',       buf: await build({ amountText: '\u20B9120', size: 150, y: 430, fill: '#c8c8c8' }) },
  { label: 'stroked 150',         buf: await build({ amountText: '\u20B9120', size: 150, y: 430, stroke: 6 }) },
  { label: 'DejaVu 150',          buf: await build({ amountText: '\u20B9120', size: 150, y: 430, font: 'DejaVu Sans' }) },
  { label: 'small 48',            buf: await build({ amountText: '\u20B9120', size: 48 }) },
  { label: 'bold 150 offset',     buf: await build({ amountText: '\u20B9120', size: 150, y: 300 }) },
];

const has = (list) => list.some(a => Math.abs(a - EXPECTED) < 0.01);

async function runStage(name, fn, buf) {
  globalThis.__OCRSTATS = [];
  const t0 = Date.now();
  let recovered = false;
  try {
    if (name === 'probe') recovered = has(await fn(buf, EXPECTED, { scan: 'probe' }));
    else if (name === 'full_scan') recovered = has(await fn(buf, EXPECTED, { scan: 'full' }));
    else if (name === 'deep') recovered = has(await fn(buf, EXPECTED));
    else recovered = (await fn(buf, EXPECTED)).verified;
  } catch (e) {
    return { name, jobs: globalThis.__OCRSTATS.length, ms: Date.now() - t0, recovered: false, error: e?.code || e?.message };
  }
  return { name, jobs: globalThis.__OCRSTATS.length, ms: Date.now() - t0, recovered };
}

const stages = [
  ['probe', (b, e, o) => runAmountRecoveryOCR(b, e, o)],
  ['deep', (b, e) => runDeepAmountRecovery(b, e)],
  ['currency', (b, e) => verifyAmountWithCurrencyRecovery(b, e)],
  ['full_scan', (b, e, o) => runAmountRecoveryOCR(b, e, o)],
];

const totals = Object.fromEntries(stages.map(([n]) => [n, { jobs: 0, ms: 0, hits: 0 }]));
console.log('variant                 | probe        | deep         | currency     | full_scan');
console.log('------------------------+--------------+--------------+--------------+--------------');

for (const v of variants) {
  const row = [];
  for (const [name, fn] of stages) {
    const r = await runStage(name, fn, v.buf);
    totals[name].jobs += r.jobs;
    totals[name].ms += r.ms;
    if (r.recovered) totals[name].hits += 1;
    row.push(`${String(r.jobs).padStart(3)}j ${String(r.ms).padStart(5)}ms ${r.recovered ? 'HIT ' : 'miss'}`);
  }
  console.log(`${v.label.padEnd(24)}| ${row.map(r => r.padEnd(12)).join('| ')}`);
}

console.log('\nstage totals over', variants.length, 'variants:');
for (const [n] of stages) {
  const t = totals[n];
  console.log(`  ${n.padEnd(10)} hits=${t.hits}/${variants.length}  jobs=${t.jobs}  ms=${t.ms}  (worst single stage measured below)`);
}

await closeOCRWorkers();
process.exit(0);
