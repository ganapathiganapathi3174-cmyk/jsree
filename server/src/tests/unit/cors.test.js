import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import cors from 'cors';
import { buildCorsOptions, buildAllowedOrigins, isOriginAllowed, normalizeOrigin } from '../../config/cors.js';

// The exact production frontend origin and the endpoint that was reported as
// failing (Register payment screenshot upload).
const PROD_ORIGIN = 'https://jsree.vercel.app';
const SCREENSHOT_PATH = '/api/payments/c48bdfa8-b5e6-408d-8771-dbf0c156e4fa/screenshot';

const silentLogger = { warn() {} };

// Boots a throwaway app wired exactly like server/src/index.js (cors mounted
// before the routes) so preflight is answered by the CORS middleware and not
// by a route's implicit OPTIONS handler.
function createServer(env) {
  const app = express();
  const { options } = buildCorsOptions({ env, logger: silentLogger });
  app.use(cors(options));
  app.post(SCREENSHOT_PATH, (req, res) => res.json({ success: true }));
  app.get('/api/health', (req, res) => res.json({ success: true }));
  return app;
}

let server;
let baseUrl;

beforeAll(async () => {
  server = createServer({ CLIENT_URL: PROD_ORIGIN }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

// A real browser preflight for the screenshot upload: axios sends
// Authorization, and multipart/form-data is CORS-safelisted so it is not
// listed in Access-Control-Request-Headers.
function preflight(origin, path = SCREENSHOT_PATH) {
  return fetch(`${baseUrl}${path}`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization'
    }
  });
}

describe('CORS: production frontend preflight', () => {
  it('answers the screenshot preflight for https://jsree.vercel.app with credentialed CORS headers', async () => {
    const res = await preflight(PROD_ORIGIN);

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(PROD_ORIGIN);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-allow-methods')).toMatch(/\bPOST\b/);
    expect(res.headers.get('access-control-allow-headers')).toMatch(/Authorization/i);
    expect(res.headers.get('access-control-allow-headers')).toMatch(/Content-Type/i);
  });

  it('never returns the * wildcard, which is illegal with credentials', async () => {
    const res = await preflight(PROD_ORIGIN);
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
    expect(res.headers.get('access-control-allow-origin')).toBe(PROD_ORIGIN);
  });

  it('sends CORS headers on the actual (non-preflight) credentialed request too', async () => {
    const res = await fetch(`${baseUrl}${SCREENSHOT_PATH}`, {
      method: 'POST',
      headers: { Origin: PROD_ORIGIN, Authorization: 'Bearer test-token' }
    });

    expect(res.headers.get('access-control-allow-origin')).toBe(PROD_ORIGIN);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('applies the same policy to every API route, not just payments', async () => {
    const res = await preflight(PROD_ORIGIN, '/api/health');
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(PROD_ORIGIN);
  });
});

describe('CORS: origin restrictions are not weakened', () => {
  it('sends no allow-origin header for a disallowed origin', async () => {
    const res = await preflight('https://evil.example.com');

    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('rejects an origin that merely looks like the production domain', async () => {
    for (const origin of [
      'https://jsree.vercel.app.evil.example.com',
      'https://evilvercel.app',
      'https://jsree.vercel.app.co',
      'http://jsree.vercel.app' // scheme downgrade must not ride the preview rule
    ]) {
      const res = await preflight(origin);
      expect(res.headers.get('access-control-allow-origin'), origin).toBeNull();
    }
  });
});

describe('CORS: allow-list resolution', () => {
  it('always allows the production frontend even when env points at localhost only', () => {
    // Regression: a mistyped/left-as-localhost CLIENT_URL on the host must not
    // strip the production origin, which caused the preflight failure.
    const allowed = buildAllowedOrigins({ CLIENT_URL: 'http://localhost:5173' });
    expect(allowed).toContain(PROD_ORIGIN);
  });

  it('always allows the production frontend when the env var is blank or malformed', () => {
    for (const env of [{}, { CLIENT_URL: '' }, { CLIENT_URL: '   ' }, { CLIENT_URLS: 'not a url' }]) {
      expect(buildAllowedOrigins(env), JSON.stringify(env)).toContain(PROD_ORIGIN);
    }
  });

  it('preserves the localhost development origins', () => {
    const allowed = buildAllowedOrigins({});
    expect(allowed).toContain('http://localhost:5173');
    expect(allowed).toContain('http://localhost:3000');
  });

  it('supports comma-separated CLIENT_URL / CLIENT_URLS lists and trailing slashes', () => {
    const allowed = buildAllowedOrigins({
      CLIENT_URLS: 'https://a.example.com , https://b.example.com/ ,'
    });
    expect(allowed).toContain('https://a.example.com');
    expect(allowed).toContain('https://b.example.com');
  });

  it('prefers CLIENT_URLS over CLIENT_URL over FRONTEND_URL', () => {
    const allowed = buildAllowedOrigins({
      CLIENT_URLS: 'https://first.example.com',
      CLIENT_URL: 'https://second.example.com',
      FRONTEND_URL: 'https://third.example.com'
    });
    expect(allowed).toContain('https://first.example.com');
    expect(allowed).not.toContain('https://second.example.com');
    expect(allowed).not.toContain('https://third.example.com');
  });

  it('normalizes case and trailing slashes', () => {
    expect(normalizeOrigin('https://JSREE.Vercel.App/')).toBe(PROD_ORIGIN);
    expect(isOriginAllowed('https://JSREE.vercel.app/', buildAllowedOrigins({}))).toBe(true);
  });
});

describe('CORS: request handling edge cases', () => {
  it('allows requests without an Origin header (curl, health checks, server-to-server)', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
  });

  it('allows only explicitly listed origins, including production and local development', () => {
    const allowed = buildAllowedOrigins({});
    expect(isOriginAllowed('https://jsree.vercel.app', allowed)).toBe(true);
    expect(isOriginAllowed('http://localhost:5173', allowed)).toBe(true);
    expect(isOriginAllowed('https://jsree-git-main-abc123.vercel.app', allowed)).toBe(false);
    expect(isOriginAllowed('https://untrusted.example.com', allowed)).toBe(false);
  });

  it('logs blocked origins server-side so the failure is diagnosable', async () => {
    const warnings = [];
    const app = express();
    const { options } = buildCorsOptions({ env: {}, logger: { warn: (m) => warnings.push(m) } });
    app.use(cors(options));
    app.post(SCREENSHOT_PATH, (req, res) => res.json({ success: true }));
    const s = app.listen(0);
    await new Promise((resolve) => s.once('listening', resolve));

    try {
      await fetch(`http://127.0.0.1:${s.address().port}${SCREENSHOT_PATH}`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://evil.example.com',
          'Access-Control-Request-Method': 'POST'
        }
      });
    } finally {
      await new Promise((resolve) => s.close(resolve));
    }

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/evil\.example\.com/);
  });
});