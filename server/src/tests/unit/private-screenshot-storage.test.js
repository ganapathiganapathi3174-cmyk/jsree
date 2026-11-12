import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────
// Private-bucket screenshot storage (021 remediation):
//   * uploads store a PRIVATE object URL (no /public/ segment)
//   * getPublicUrl is never called for payment proofs
//   * verifyPayment reads bytes via storage.download (service role),
//     never via a direct fetch of the stored URL
//   * the path parser accepts BOTH legacy public URLs and new private
//     URLs so pre-migration rows keep working through the proxy
// ─────────────────────────────────────────────────────────────

const { supabaseMock, storageUpload, storageDownload, logAction } = vi.hoisted(() => {
  process.env.SENDER_NAME_POLICY = 'off';
  return {
    supabaseMock: { from: vi.fn(), storage: { from: vi.fn() } },
    storageUpload: vi.fn(),
    storageDownload: vi.fn(),
    logAction: vi.fn(),
  };
});

vi.mock('../../db/supabase.js', () => ({ supabase: supabaseMock, supabaseAnon: {} }));
vi.mock('../../services/auditService.js', () => ({ logAction }));
vi.mock('../../services/referralService.js', () => ({ checkAndDeactivateReferrer: vi.fn() }));
vi.mock('../../services/notificationService.js', () => ({ default: { notify: vi.fn() } }));
vi.mock('../../services/walletService.js', () => ({ default: {} }));
vi.mock('../../services/referralTierService.js', () => ({ default: {} }));
vi.mock('../../services/configService.js', () => ({
  getPaymentConfig: vi.fn(),
  resolveReceiverIdentity: vi.fn(async () => ({
    receiverName: 'Test Receiver',
    receiverUpi: 'receiver@okicici',
    nameConfigured: true,
    upiConfigured: true,
  })),
}));
vi.mock('../../services/paymentVerification/index.js', () => ({
  ENGINE_ID: 'paymentVerificationEngine/test',
  paymentVerificationEngine: { verify: vi.fn() },
  recordVerificationAttempt: vi.fn(async () => null),
  listVerificationHistory: vi.fn(async () => []),
  deriveOutcomeStatus: vi.fn(() => 'PENDING_VERIFICATION'),
  decidePaymentVerification: vi.fn(),
  reserveApprovedUtr: vi.fn(),
  releaseApprovedUtr: vi.fn(),
}));

import { uploadScreenshot, streamPaymentScreenshot, verifyPayment } from '../../services/paymentService.js';
import { paymentVerificationEngine } from '../../services/paymentVerification/index.js';

const PAYMENT_ID = 'pay-1';
const USER_ID = 'user-1';
const FILE = { buffer: Buffer.from('png-bytes'), originalname: 'p.png', mimetype: 'image/png' };

function chain(result) {
  const q = {};
  q.select = vi.fn(() => q);
  q.eq = vi.fn(() => q);
  q.neq = vi.fn(() => q);
  q.update = vi.fn(() => q);
  q.insert = vi.fn(() => q);
  q.limit = vi.fn().mockResolvedValue(result);
  q.single = vi.fn().mockResolvedValue(result);
  return q;
}

function activePayment() {
  return {
    data: {
      id: PAYMENT_ID, user_id: USER_ID, status: 'pending', expected_amount: 120,
      selected_plan: '120', expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      screenshot_url: null, transaction_id: 'T1', payment_request_created_at: null,
    },
    error: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = 'https://proj.supabase.co';
  storageUpload.mockResolvedValue({ error: null });
  storageDownload.mockResolvedValue({
    data: { arrayBuffer: async () => new Uint8Array([9, 9, 9]).buffer, type: 'image/png' },
    error: null,
  });
  supabaseMock.storage.from.mockReturnValue({
    upload: storageUpload,
    download: storageDownload,
    getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://proj.supabase.co/storage/v1/object/public/payments/x.png' } })),
  });
});

describe('private payment screenshot storage', () => {
  it('uploadScreenshot stores a private object URL and never calls getPublicUrl', async () => {
    supabaseMock.from
      .mockReturnValueOnce(chain(activePayment()))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }));

    const result = await uploadScreenshot(PAYMENT_ID, FILE, USER_ID);

    expect(result.screenshotUrl).toMatch(/^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/payments\//);
    expect(result.screenshotUrl).not.toContain('/object/public/');
    const updateQuery = supabaseMock.from.mock.results[2].value;
    expect(updateQuery.eq).toHaveBeenCalledWith('id', PAYMENT_ID);
  });

  it('verifyPayment downloads bytes via storage API (direct URL fetch is never used)', async () => {
    const storedUrl = 'https://proj.supabase.co/storage/v1/object/payments/pay-1/a.png';
    supabaseMock.from.mockReturnValueOnce(chain({ ...activePayment(), data: { ...activePayment().data, screenshot_url: storedUrl } }));

    storageDownload.mockResolvedValue({
      data: { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, type: 'image/png' },
      error: null,
    });
    paymentVerificationEngine.verify.mockResolvedValue({ inconclusive: true, reason: 'OCR_TIMEOUT' });

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(verifyPayment(PAYMENT_ID, null)).rejects.toMatchObject({
      message: 'Screenshot verification did not complete',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storageDownload).toHaveBeenCalledWith('pay-1/a.png');
    fetchSpy.mockRestore();
  });

  it('streamPaymentScreenshot resolves BOTH legacy public and new private URL shapes', async () => {
    const shapes = [
      'https://proj.supabase.co/storage/v1/object/public/payments/pay-1/old.png',
      'https://proj.supabase.co/storage/v1/object/payments/pay-1/new.png',
    ];
    for (const url of shapes) {
      supabaseMock.from.mockReturnValueOnce(chain({ data: { user_id: USER_ID, screenshot_url: url }, error: null }));
      storageDownload.mockResolvedValueOnce({
        data: { arrayBuffer: async () => new Uint8Array([9]).buffer, type: 'image/png' },
        error: null,
      });
      const out = await streamPaymentScreenshot(PAYMENT_ID, { id: USER_ID, role: 'user' });
      expect(out.buffer).toBeInstanceOf(Buffer);
      expect(storageDownload).toHaveBeenLastCalledWith('pay-1/old.png'.replace('old', url.includes('/public/') ? 'old' : 'new'));
    }
  });

  it('denies cross-user access and unauthenticated-style requests to the proxy', async () => {
    supabaseMock.from.mockReturnValueOnce(chain({ data: { user_id: 'someone-else', screenshot_url: 'https://x/storage/v1/object/payments/p/f.png' }, error: null }));
    await expect(streamPaymentScreenshot(PAYMENT_ID, { id: USER_ID, role: 'user' }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    supabaseMock.from.mockReturnValueOnce(chain({ data: { user_id: 'someone-else', screenshot_url: 'https://x/storage/v1/object/payments/p/f.png' }, error: null }));
    await expect(streamPaymentScreenshot(PAYMENT_ID, { id: USER_ID, role: 'admin' })).resolves.toBeTruthy();
  });
});
