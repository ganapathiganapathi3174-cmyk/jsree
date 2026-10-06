import sharp from 'sharp';
import { runScreenshotVerification } from './src/services/verificationService.js';

const UPI = process.env.ADMIN_UPI_ID || 'jayarajj126-3@okicici';
const NOW = () => new Date();

function svg(body) {
  return Buffer.from(`<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
<rect width="1080" height="1920" fill="white"/>${body}</svg>`);
}
const T = (x) => (x / 1000).toFixed(2) + 's';

// Case A — primary pass reads everything (currency + label present)
const imgA = svg(`
<text x="60" y="160" font-family="Arial" font-size="72" font-weight="bold">Payment Successful</text>
<text x="60" y="300" font-family="Arial" font-size="80">&#8377;120</text>
<text x="60" y="420" font-family="Arial" font-size="54">To Jayaraj</text>
<text x="60" y="500" font-family="Arial" font-size="54">UPI ID: ${UPI}</text>
<text x="60" y="620" font-family="Arial" font-size="48">Date: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(',', '')}</text>
<text x="60" y="700" font-family="Arial" font-size="48">UPI transaction ID: T7GHD240824</text>`);

// Case B — bare number, no currency/label => primary cannot extract amount => recovery storms
const imgB = svg(`
<text x="60" y="160" font-family="Arial" font-size="72" font-weight="bold">Payment Successful</text>
<text x="60" y="300" font-family="Arial" font-size="80">120</text>
<text x="60" y="420" font-family="Arial" font-size="54">To Jayaraj</text>
<text x="60" y="500" font-family="Arial" font-size="54">UPI ID: ${UPI}</text>
<text x="60" y="620" font-family="Arial" font-size="48">Date: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(',', '')}</text>
<text x="60" y="700" font-family="Arial" font-size="48">UPI transaction ID: T7GHD240824</text>`);

async function run(label, svgBuf) {
  const buffer = await sharp(svgBuf).png().toBuffer();
  const t0 = Date.now();
  const { verificationResult: v } = await runScreenshotVerification({
    imageBuffer: buffer, expectedAmount: 120, receiverUpi: UPI, now: NOW(),
  });
  console.log(`${label}: ${T(Date.now() - t0)}  decision=${v.decision} reason=${v.reason} amountMatch=${v.amountMatch} recovered=${v.recoveredFromBands} passes=${v.ocrPassInfo.additionalPassesRun}`);
}

const tInit = Date.now();
await run('[warm-up: worker init]', imgA);
console.log(`  (first call includes worker init + language load)`);
await run('[A: primary reads all]', imgA);
await run('[B: primary misses amount]', imgB);
await run('[A again]', imgA);
process.exit(0);
