import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const T = (l, t0) => console.log(`${l.padEnd(42)} ${(Date.now() - t0) / 1000}s`);

const Tesseract = (await import('tesseract.js')).default;

// ── 1. worker init: default (CDN language download) ──
let t = Date.now();
const w1 = await Tesseract.createWorker('eng');
T('createWorker(default -> jsdelivr CDN)', t);

t = Date.now();
await w1.setParameters({ tessedit_pageseg_mode: '1' });
T('setParameters', t);

// ── 2. sample receipt image ──
const svg = `<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
<rect width="1080" height="1920" fill="white"/>
<text x="60" y="160" font-family="Arial" font-size="72" font-weight="bold">Payment Successful</text>
<text x="60" y="300" font-family="Arial" font-size="96">&#8377;120</text>
<text x="60" y="420" font-family="Arial" font-size="54">To Jayaraj</text>
<text x="60" y="500" font-family="Arial" font-size="54">jayarajj126-3@okicici</text>
<text x="60" y="620" font-family="Arial" font-size="48">Date: 04/10/2026, 10:31 PM</text>
<text x="60" y="700" font-family="Arial" font-size="48">UPI transaction ID: T7GHD240824</text>
</svg>`;
const png = await sharp(Buffer.from(svg)).png().toBuffer();

t = Date.now();
const processed = await sharp(png).resize({ width: 1200, withoutEnlargement: true }).grayscale().normalize().sharpen().toBuffer();
T('preprocessImage (sharp)', t);

t = Date.now();
const r1 = await w1.recognize(processed);
T('recognize pass #1 (primary)', t);
console.log('   confidence', r1.data.confidence, '| textLen', r1.data.text.length);

t = Date.now();
const r2 = await w1.recognize(processed);
T('recognize pass #2 (additional upscaled)', t);

t = Date.now();
const r3 = await w1.recognize(processed);
T('recognize pass #3 (additional thresholded)', t);

// ── 3. strip recovery shape (4 recognitions per strip) ──
t = Date.now();
const meta = await sharp(processed).metadata();
const W = meta.width, H = meta.height;
const STRIP_H = 220, OVERLAP = 110;
let strips = 0;
for (let y = 0; y < H; y += STRIP_H - OVERLAP) {
  const h = Math.min(STRIP_H, H - y);
  const strip = await sharp(processed).extract({ left: 0, top: y, width: W, height: h }).png().toBuffer();
  await w1.recognize(strip);              // variant 1
  strips++;
}
T(`strip recovery: ${strips} strips x1 recognize`, t);
console.log('   => x4 variants/strip ≈', ((Date.now() - t) / 1000 * 4).toFixed(1) + 's');

// ── 4. second worker init with LOCAL traineddata ──
t = Date.now();
const w2 = await Tesseract.createWorker('eng', 1, { langPath: path.join(__dir), gzip: false });
T('createWorker(local eng.traineddata)', t);
const r4 = await w2.recognize(processed);
console.log('   local model confidence', r4.data.confidence, '| textLen', r4.data.text.length);
console.log('   text identical to CDN model:', r1.data.text === r4.data.text);

await w1.terminate();
await w2.terminate();
process.exit(0);
