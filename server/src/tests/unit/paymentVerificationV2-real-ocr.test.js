import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';

const { supabaseMock, ocrState } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn() },
  ocrState: { text: '', confidence: 90 },
}));

vi.mock('../../db/supabase.js', () => ({ supabase: supabaseMock }));
vi.mock('tesseract.js', () => ({
  default: {
    createScheduler: () => ({
      addWorker: () => {},
      addJob: async () => ({ data: { text: ocrState.text, confidence: ocrState.confidence } }),
      workers: [],
      close: async () => {},
    }),
    createWorker: async () => ({}),
  },
}));

import sharpLib from 'sharp';
import { paymentVerificationEngine } from '../../services/paymentVerificationV2/index.js';
import { preprocessImage } from '../../services/paymentVerificationV2/ocrExtraction.js';

const RECEIVER_UPI = 'jayarajj126-3@okicici';
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function makeChain(result) {
  const obj = {};
  for (const m of ['select', 'eq', 'neq', 'in', 'order', 'update', 'delete', 'insert']) obj[m] = vi.fn(() => obj);
  obj.limit = vi.fn(async () => ({ data: result, error: null }));
  obj.single = vi.fn(async () => ({ data: result, error: null }));
  obj.maybeSingle = vi.fn(async () => ({ data: result?.data ?? null, error: result?.error ?? null }));
  return obj;
}

function istDateString(d) {
  const pad = n => String(n).padStart(2, '0');
  const h24 = d.getUTCHours();
  const h = h24 % 12 || 12;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}, ${h}:${pad(d.getUTCMinutes())} ${ampm}`;
}

async function renderReceiptPng({ amount = 120, upi = RECEIVER_UPI, utr = 'UTR123456', receiver = 'Jayaraj', status = 'success', date } = {}) {
  const lines = ['Payment Successful', `Rs. ${amount}`, `To ${receiver}`, upi, `Date: ${date || istDateString(new Date(Date.now() + 5.5 * 3600000 + 2 * 60000))}`, `UPI transaction ID: ${utr}`];
  if (status === 'failed') lines[0] = 'Payment Failed';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><rect width="800" height="1200" fill="#ffffff"/><text x="40" y="80" font-size="48" fill="#000000" font-family="sans-serif">${lines.join('\n')}</text></svg>`;
  const buf = await sharpLib(Buffer.from(svg)).png().toBuffer();
  return buf;
}

async function verify(overrides = {}) {
  const result = await paymentVerificationEngine.verify({
    imageBuffer: overrides.imageBuffer,
    purpose: 'topup',
    paymentRequest: {
      type: 'topup',
      expectedAmount: overrides.amount ?? 120,
      paymentId: 'topup-1',
      userId: 'user-1',
      receiverName: 'Jayaraj',
      receiverUpi: RECEIVER_UPI,
      expectedPayerName: null,
      senderPolicy: 'off',
    },
    serverTime: overrides.serverTime,
    timeoutMs: 60000,
    skipIntegrityCheck: overrides.skipIntegrityCheck ?? false,
  });
  return result;
}

describe('paymentVerificationV2 real OCR (sharp render + mocked tesseract worker)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ocrState.text = '';
    ocrState.confidence = 90;
    supabaseMock.from.mockImplementation(() => makeChain([]));
  });

  it('preprocesses a rendered receipt into a PNG buffer via sharp', async () => {
    const png = await renderReceiptPng({ amount: 120 });
    expect(png.length).toBeGreaterThan(100);
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe('png');
    const out = await preprocessImage(png);
    expect(Buffer.isBuffer(out)).toBe(true);
    const meta2 = await sharp(out).metadata();
    expect(meta2.format).toBe('png');
  });

  it('extracts amount / UPI / UTR through the real OCR pipeline', async () => {
    const png = await renderReceiptPng({ amount: 120, utr: 'UTR123456' });
    const serverTime = new Date(Date.now() + 2 * 60000);
    const ocrDateStr = istDateString(new Date(serverTime.getTime() + 5.5 * 3600000));
    ocrState.text = `Payment Successful\nRs. 120\nTo Jayaraj\n${RECEIVER_UPI}\nDate: ${ocrDateStr}\nUPI transaction ID: UTR123456`;
    ocrState.confidence = 92;
    const v = await verify({ imageBuffer: png, amount: 120, serverTime });
    console.log('REALOCR_REASON', v.reason, v.code, JSON.stringify(v.verificationResult));
    expect(v.outcome).toBe('APPROVED');
    expect(v.approved).toBe(true);
  });
});
