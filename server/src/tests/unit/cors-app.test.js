import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { createApp } from '../../app.js';

const { supabaseFrom, supabaseQuery, paymentService } = vi.hoisted(() => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn()
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);

  return {
    supabaseFrom: vi.fn(() => query),
    supabaseQuery: query,
    paymentService: {
      createPayment: vi.fn(),
      uploadScreenshot: vi.fn(),
      verifyPayment: vi.fn(),
      recordVerificationFailure: vi.fn(),
      getPaymentStatus: vi.fn(),
      getUserPayments: vi.fn(),
      requirePaymentOwner: vi.fn()
    }
  };
});

vi.mock('../../db/supabase.js', () => ({
  supabase: { from: supabaseFrom },
  supabaseAnon: {}
}));

vi.mock('../../services/paymentService.js', () => paymentService);

const PROD_ORIGIN = 'https://jsree.vercel.app';
const PAYMENT_ID = 'TEST-ID';
const SCREENSHOT_PATH = `/api/payments/${PAYMENT_ID}/screenshot`;
const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

let server;
let baseUrl;

beforeAll(async () => {
  process.env.JWT_SECRET = 'cors-regression-test-secret';
  server = createApp({ env: { CLIENT_URL: PROD_ORIGIN }, logger }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  supabaseFrom.mockClear();
  supabaseQuery.select.mockClear();
  supabaseQuery.eq.mockClear();
  supabaseQuery.single.mockResolvedValue({
    data: {
      id: 'test-user',
      full_name: 'Test User',
      email: 'test@example.com',
      role: 'user',
      status: 'pending'
    },
    error: null
  });
  vi.clearAllMocks();
  paymentService.uploadScreenshot.mockResolvedValue({ paymentId: PAYMENT_ID });
  paymentService.verifyPayment.mockResolvedValue({ decision: 'manual_review' });
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

function corsHeaders() {
  return {
    Origin: PROD_ORIGIN,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization,content-type'
  };
}

function makeToken() {
  return jwt.sign({ userId: 'test-user' }, process.env.JWT_SECRET);
}

describe('production CORS through the Express app', () => {
  it('answers screenshot OPTIONS with the exact origin, POST, and required headers', async () => {
    const response = await fetch(`${baseUrl}${SCREENSHOT_PATH}`, {
      method: 'OPTIONS',
      headers: corsHeaders()
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(PROD_ORIGIN);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(response.headers.get('access-control-allow-methods')).toMatch(/\bPOST\b/);
    expect(response.headers.get('access-control-allow-headers')).toMatch(/Authorization/i);
    expect(response.headers.get('access-control-allow-headers')).toMatch(/Content-Type/i);
  });

  it('answers register OPTIONS before auth/limiter with the exact origin, POST, and required headers', async () => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'OPTIONS',
      headers: corsHeaders()
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(PROD_ORIGIN);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(response.headers.get('access-control-allow-methods')).toMatch(/\bPOST\b/);
    expect(response.headers.get('access-control-allow-headers')).toMatch(/Authorization/i);
    expect(response.headers.get('access-control-allow-headers')).toMatch(/Content-Type/i);
  });

  it('keeps the local Vite development origin enabled through the actual app', async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'GET'
      }
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('handles preflight for other API routes before authentication', async () => {
    const response = await fetch(`${baseUrl}/api/topups`, {
      method: 'OPTIONS',
      headers: { ...corsHeaders(), 'Access-Control-Request-Method': 'GET' }
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(PROD_ORIGIN);
    expect(response.headers.get('access-control-allow-methods')).toMatch(/\bGET\b/);
  });

  it('preserves authentication for an actual screenshot upload and accepts it with CORS', async () => {
    const form = new FormData();
    form.append('screenshot', new Blob(['test image'], { type: 'image/png' }), 'proof.png');
    const response = await fetch(`${baseUrl}${SCREENSHOT_PATH}`, {
      method: 'POST',
      headers: {
        Origin: PROD_ORIGIN,
        Authorization: `Bearer ${makeToken()}`
      },
      body: form
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(PROD_ORIGIN);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { verification: { decision: 'manual_review' } }
    });
    expect(paymentService.uploadScreenshot).toHaveBeenCalledWith(
      PAYMENT_ID,
      expect.objectContaining({ mimetype: 'image/png' }),
      'test-user'
    );
    expect(paymentService.verifyPayment).toHaveBeenCalledWith(
      PAYMENT_ID,
      Buffer.from('test image')
    );
  });

  it('rejects invalid authentication and a missing screenshot with CORS', async () => {
    const invalidAuthResponse = await fetch(`${baseUrl}${SCREENSHOT_PATH}`, {
      method: 'POST',
      headers: {
        Origin: PROD_ORIGIN,
        Authorization: 'Bearer invalid-test-token'
      }
    });
    expect(invalidAuthResponse.status).toBe(401);
    expect(invalidAuthResponse.headers.get('access-control-allow-origin')).toBe(PROD_ORIGIN);

    const missingScreenshotResponse = await fetch(`${baseUrl}${SCREENSHOT_PATH}`, {
      method: 'POST',
      headers: {
        Origin: PROD_ORIGIN,
        Authorization: `Bearer ${makeToken()}`
      }
    });
    expect(missingScreenshotResponse.status).toBe(400);
    expect((await missingScreenshotResponse.json()).code).toBe('NO_FILE');
    expect(missingScreenshotResponse.headers.get('access-control-allow-origin')).toBe(PROD_ORIGIN);
    expect(paymentService.uploadScreenshot).not.toHaveBeenCalled();
  });

  it('rejects oversized screenshots before invoking payment services', async () => {
    const form = new FormData();
    form.append(
      'screenshot',
      new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' }),
      'oversized.png'
    );
    const response = await fetch(`${baseUrl}${SCREENSHOT_PATH}`, {
      method: 'POST',
      headers: {
        Origin: PROD_ORIGIN,
        Authorization: `Bearer ${makeToken()}`
      },
      body: form
    });

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('FILE_TOO_LARGE');
    expect(response.headers.get('access-control-allow-origin')).toBe(PROD_ORIGIN);
    expect(paymentService.uploadScreenshot).not.toHaveBeenCalled();
  });

  it('returns safe CORS-enabled errors for malformed multipart and payment-service failures', async () => {
    const malformedResponse = await fetch(`${baseUrl}${SCREENSHOT_PATH}`, {
      method: 'POST',
      headers: {
        Origin: PROD_ORIGIN,
        Authorization: `Bearer ${makeToken()}`,
        'Content-Type': 'multipart/form-data; boundary=broken'
      },
      body: '--broken\r\nContent-Disposition: form-data; name="screenshot"; filename="proof.png"\r\nContent-Type: image/png\r\n\r\ntruncated'
    });
    expect(malformedResponse.status).toBe(400);
    expect(malformedResponse.headers.get('access-control-allow-origin')).toBe(PROD_ORIGIN);

    for (const failure of [
      { code: 'PAYMENT_NOT_FOUND', status: 404 },
      { code: 'DUPLICATE_SCREENSHOT', status: 409 },
      { code: 'UPLOAD_FAILED', status: 500 }
    ]) {
      paymentService.uploadScreenshot.mockRejectedValueOnce({
        code: failure.code,
        message: 'Synthetic isolated test failure'
      });
      const form = new FormData();
      form.append('screenshot', new Blob(['test image'], { type: 'image/png' }), 'proof.png');
      const response = await fetch(`${baseUrl}${SCREENSHOT_PATH}`, {
        method: 'POST',
        headers: {
          Origin: PROD_ORIGIN,
          Authorization: `Bearer ${makeToken()}`
        },
        body: form
      });

      expect(response.status).toBe(failure.status);
      expect((await response.json()).code).toBe(failure.code);
      expect(response.headers.get('access-control-allow-origin')).toBe(PROD_ORIGIN);
    }
    expect(paymentService.verifyPayment).not.toHaveBeenCalled();
  });

  it('keeps CORS headers on authentication and upload-validation errors', async () => {
    const authResponse = await fetch(`${baseUrl}${SCREENSHOT_PATH}`, {
      method: 'POST',
      headers: { Origin: PROD_ORIGIN }
    });
    expect(authResponse.status).toBe(401);
    expect(authResponse.headers.get('access-control-allow-origin')).toBe(PROD_ORIGIN);

    const form = new FormData();
    form.append('screenshot', new Blob(['not an image'], { type: 'application/pdf' }), 'proof.pdf');
    const uploadResponse = await fetch(`${baseUrl}${SCREENSHOT_PATH}`, {
      method: 'POST',
      headers: {
        Origin: PROD_ORIGIN,
        Authorization: `Bearer ${makeToken()}`
      },
      body: form
    });
    expect(uploadResponse.status).toBe(400);
    expect(uploadResponse.headers.get('access-control-allow-origin')).toBe(PROD_ORIGIN);
  });

  it('keeps CORS headers on validation and unhandled API errors', async () => {
    const validationResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { Origin: PROD_ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x', email: 'bad', password: '1', plan: '999' })
    });
    expect(validationResponse.status).toBe(400);
    expect((await validationResponse.json()).code).toBe('VALIDATION_ERROR');
    expect(validationResponse.headers.get('access-control-allow-origin')).toBe(PROD_ORIGIN);

    const errorResponse = await fetch(`${baseUrl}${SCREENSHOT_PATH}`, {
      method: 'POST',
      headers: { Origin: PROD_ORIGIN, 'Content-Type': 'application/json' },
      body: '{invalid json'
    });
    expect(errorResponse.status).toBe(400);
    expect((await errorResponse.json()).code).toBe('INVALID_JSON');
    expect(errorResponse.headers.get('access-control-allow-origin')).toBe(PROD_ORIGIN);

    const unexpectedErrorResponse = await fetch(`${baseUrl}${SCREENSHOT_PATH}`, {
      method: 'POST',
      headers: {
        Origin: PROD_ORIGIN,
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip'
      },
      body: '{}'
    });
    expect(unexpectedErrorResponse.status).toBe(500);
    expect((await unexpectedErrorResponse.json()).code).toBe('INTERNAL_ERROR');
    expect(unexpectedErrorResponse.headers.get('access-control-allow-origin')).toBe(PROD_ORIGIN);
  });

  it('does not relax registration validation or top-up authentication', async () => {
    const registrationResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { Origin: PROD_ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Valid Name', email: 'test@example.com', password: 'password' })
    });
    expect(registrationResponse.status).toBe(400);
    expect((await registrationResponse.json()).code).toBe('VALIDATION_ERROR');

    const topupResponse = await fetch(`${baseUrl}/api/topups`, {
      headers: { Origin: PROD_ORIGIN }
    });
    expect(topupResponse.status).toBe(401);
    expect((await topupResponse.json()).code).toBe('TOKEN_REQUIRED');
    expect(topupResponse.headers.get('access-control-allow-origin')).toBe(PROD_ORIGIN);
  });

  it('keeps payment configuration restricted to authenticated administrators', async () => {
    const anonymousResponse = await fetch(`${baseUrl}/api/config`, {
      headers: { Origin: PROD_ORIGIN }
    });
    expect(anonymousResponse.status).toBe(401);
    expect(anonymousResponse.headers.get('access-control-allow-origin')).toBe(PROD_ORIGIN);

    const userResponse = await fetch(`${baseUrl}/api/config`, {
      headers: {
        Origin: PROD_ORIGIN,
        Authorization: `Bearer ${makeToken()}`
      }
    });
    expect(userResponse.status).toBe(403);
    expect((await userResponse.json()).code).toBe('ADMIN_REQUIRED');
    expect(userResponse.headers.get('access-control-allow-origin')).toBe(PROD_ORIGIN);
  });

  it('does not emit allow-origin for a disallowed website', async () => {
    const response = await fetch(`${baseUrl}${SCREENSHOT_PATH}`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://untrusted.example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type'
      }
    });

    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
