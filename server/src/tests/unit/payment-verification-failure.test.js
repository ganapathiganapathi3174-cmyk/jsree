import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────
// Regression: an upload whose verification never reaches a decision.
//
// Production symptom (payment c48bdfa8-b5e6-408d-8771-dbf0c156e4fa):
//   status=pending, verification_result=NULL, screenshot saved,
//   no `verify_payment` audit row, and the user only ever saw "pending".
//
// runScreenshotVerification threw (or the host was killed mid-OCR), so
// verifyPayment never committed a status. The controller swallowed the error
// and replied 200, leaving an orphaned pending row with no record of why.
// ─────────────────────────────────────────────────────────────

const service = vi.hoisted(() => ({
  uploadScreenshot: vi.fn(),
  verifyPayment: vi.fn(),
  recordVerificationFailure: vi.fn(),
  createPayment: vi.fn(),
  getPaymentStatus: vi.fn(),
  getUserPayments: vi.fn()
}));
vi.mock('../../services/paymentService.js', () => service);

import * as paymentController from '../../controllers/paymentController.js';

const OCR_FAILURE = {
  message: 'OCR processing failed',
  code: 'OCR_FAILED',
  details: 'worker out of memory'
};

function mockRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

function uploadReq() {
  return {
    params: { paymentId: 'pay-1' },
    user: { id: 'user-1' },
    file: { buffer: Buffer.from('png'), originalname: 's.png', mimetype: 'image/png' }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  service.uploadScreenshot.mockResolvedValue({ paymentId: 'pay-1', screenshotUrl: 'https://x/s.png' });
});

describe('paymentController.uploadScreenshot - verification produced no decision', () => {
  it('persists a fail-closed record instead of silently dropping the error', async () => {
    service.verifyPayment.mockRejectedValue(OCR_FAILURE);
    service.recordVerificationFailure.mockResolvedValue({
      decision: null, inconclusive: true, reason: 'OCR_FAILED'
    });

    const res = mockRes();
    await paymentController.uploadScreenshot(uploadReq(), res);

    expect(service.recordVerificationFailure).toHaveBeenCalledWith('pay-1', OCR_FAILURE);
  });

  it('never reports an approval to the client', async () => {
    service.verifyPayment.mockRejectedValue(OCR_FAILURE);
    service.recordVerificationFailure.mockResolvedValue({
      decision: null, inconclusive: true, reason: 'OCR_FAILED'
    });

    const res = mockRes();
    await paymentController.uploadScreenshot(uploadReq(), res);

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true); // the upload itself did succeed
    expect(body.data.verification.status).toBeUndefined();
    expect(body.data.verification.status).not.toBe('approved');
    expect(body.data.verification.decision).toBeNull();
  });

  it('surfaces the original error code to the client', async () => {
    service.verifyPayment.mockRejectedValue(OCR_FAILURE);
    service.recordVerificationFailure.mockResolvedValue({
      decision: null, inconclusive: true, reason: 'OCR_FAILED', error: 'OCR processing failed'
    });

    const res = mockRes();
    await paymentController.uploadScreenshot(uploadReq(), res);

    expect(res.json.mock.calls[0][0].data.verification.reason).toBe('OCR_FAILED');
  });

  it('still returns a usable payload if persisting the failure itself fails', async () => {
    service.verifyPayment.mockRejectedValue(OCR_FAILURE);
    service.recordVerificationFailure.mockRejectedValue(new Error('db down'));

    const res = mockRes();
    await paymentController.uploadScreenshot(uploadReq(), res);

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.verification.code).toBe('OCR_FAILED');
  });

  it('does not touch the failure path when verification succeeds', async () => {
    service.verifyPayment.mockResolvedValue({ status: 'approved', decision: 'approved' });

    const res = mockRes();
    await paymentController.uploadScreenshot(uploadReq(), res);

    expect(service.recordVerificationFailure).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data.verification.status).toBe('approved');
  });
});