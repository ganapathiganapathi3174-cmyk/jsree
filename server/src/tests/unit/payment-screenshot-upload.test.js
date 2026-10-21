import { beforeEach, describe, expect, it, vi } from 'vitest';

const { supabaseMock, storageUpload, logAction } = vi.hoisted(() => ({
  supabaseMock: {
    from: vi.fn(),
    storage: { from: vi.fn() }
  },
  storageUpload: vi.fn(),
  logAction: vi.fn()
}));

vi.mock('../../db/supabase.js', () => ({
  supabase: supabaseMock,
  supabaseAnon: {}
}));

vi.mock('../../services/auditService.js', () => ({ logAction }));

import { uploadScreenshot } from '../../services/paymentService.js';

const PAYMENT_ID = 'test-payment';
const USER_ID = 'test-user';
const FILE = {
  buffer: Buffer.from('synthetic screenshot bytes'),
  originalname: 'proof.png',
  mimetype: 'image/png'
};

function paymentLookup(result) {
  const query = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.single = vi.fn().mockResolvedValue(result);
  return query;
}

function approvedScreenshotLookup(result) {
  const query = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.neq = vi.fn(() => query);
  query.limit = vi.fn().mockResolvedValue(result);
  return query;
}

function activePayment(overrides = {}) {
  return {
    data: {
      id: PAYMENT_ID,
      user_id: USER_ID,
      status: 'pending',
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      ...overrides
    },
    error: null
  };
}

function queuePaymentAndDuplicateLookups(duplicateResult = { data: [], error: null }) {
  supabaseMock.from
    .mockReturnValueOnce(paymentLookup(activePayment()))
    .mockReturnValueOnce(approvedScreenshotLookup(duplicateResult));
}

beforeEach(() => {
  vi.clearAllMocks();
  storageUpload.mockResolvedValue({ error: null });
  supabaseMock.storage.from.mockReturnValue({
    upload: storageUpload,
    getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://storage.example/proof.png' } }))
  });
});

describe('payment screenshot upload service', () => {
  it('rejects a screenshot already attached to another approved payment', async () => {
    queuePaymentAndDuplicateLookups({ data: [{ id: 'previous-approved-payment' }], error: null });

    await expect(uploadScreenshot(PAYMENT_ID, FILE, USER_ID))
      .rejects.toMatchObject({ code: 'DUPLICATE_SCREENSHOT' });

    const duplicateLookup = supabaseMock.from.mock.results[1].value;
    expect(duplicateLookup.eq).toHaveBeenCalledWith(
      'screenshot_hash',
      expect.stringMatching(/^[a-f0-9]{64}$/)
    );
    expect(supabaseMock.storage.from).not.toHaveBeenCalled();
    expect(storageUpload).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it('continues to reject repeated attempts to reuse the same approved screenshot', async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      queuePaymentAndDuplicateLookups({ data: [{ id: 'previous-approved-payment' }], error: null });
      await expect(uploadScreenshot(PAYMENT_ID, FILE, USER_ID))
        .rejects.toMatchObject({ code: 'DUPLICATE_SCREENSHOT' });
    }

    expect(supabaseMock.from).toHaveBeenCalledTimes(4);
    expect(supabaseMock.storage.from).not.toHaveBeenCalled();
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('does not let a different user upload to the payment', async () => {
    supabaseMock.from.mockReturnValueOnce(paymentLookup(activePayment()));

    await expect(uploadScreenshot(PAYMENT_ID, FILE, 'different-user'))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
    expect(supabaseMock.storage.from).not.toHaveBeenCalled();
  });
});
