import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../../.env') });

// GET /api/cache-stats previously served an unauthenticated {size, keys[]} of
// `userId:originalUrl` entries. This suite boots an isolated server instance on
// its own port and asserts the endpoint is admin-only. It is read-only against
// the database: JWTs are signed for rows that already exist, and nothing is
// created, updated or deleted.

const serverRoot = join(__dirname, '../../..');
let child = null;
let base = '';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Poll every 500ms for at most 45s: at most ~90 attempts, so the health probe
// itself can never trip the global 100-requests/15-min rate limiter.
async function waitForHealth(url, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
      lastErr = new Error(`health status ${res.status}`);
    } catch (e) { lastErr = e; }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`server did not become healthy: ${lastErr?.message}`);
}

async function getJson(path, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { headers });
  const text = await res.text();
  try { return { status: res.status, ...JSON.parse(text) }; }
  catch { return { status: res.status, success: false, message: 'Non-JSON response' }; }
}

function signFor(userId, role) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET missing from server/.env');
  return jwt.sign({ userId, role }, process.env.JWT_SECRET, { expiresIn: '10m' });
}

let nonAdminToken;
let adminToken;

beforeAll(async () => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: user } = await supabase
    .from('users').select('id').neq('role', 'admin').limit(1);
  const { data: admin } = await supabase
    .from('users').select('id').eq('role', 'admin').eq('status', 'active').limit(1);

  if (!user?.[0]) throw new Error('fixture missing: no non-admin user row found');
  if (!admin?.[0]) throw new Error('fixture missing: no active admin user row found');

  nonAdminToken = signFor(user[0].id, 'user');
  adminToken = signFor(admin[0].id, 'admin');

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  base = `${origin}/api`;
  child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore'
  });
  child.on('error', () => { /* surfaced by the health timeout */ });
  await waitForHealth(origin);
}, 90000);

afterAll(() => {
  if (child && !child.killed) child.kill();
});

describe('GET /api/cache-stats authorization', () => {
  it('server is reachable without auth (health is public by design)', async () => {
    const res = await getJson('/health');
    expect(res.status).toBe(200);
    expect(res.success).toBe(true);
  });

  it('rejects a request with no Authorization header (401 TOKEN_REQUIRED)', async () => {
    const res = await getJson('/cache-stats');
    expect(res.status).toBe(401);
    expect(res.code).toBe('TOKEN_REQUIRED');
    expect(res.keys).toBeUndefined();
  });

  it('rejects a malformed token (401 TOKEN_INVALID)', async () => {
    const res = await getJson('/cache-stats', 'not-a-jwt');
    expect(res.status).toBe(401);
    expect(res.code).toBe('TOKEN_INVALID');
  });

  it('rejects a valid non-admin user token (403 ADMIN_REQUIRED)', async () => {
    const res = await getJson('/cache-stats', nonAdminToken);
    expect(res.status).toBe(403);
    expect(res.code).toBe('ADMIN_REQUIRED');
    expect(res.keys).toBeUndefined();
  });

  it('returns stats to an admin token (200 {size, keys})', async () => {
    const res = await getJson('/cache-stats', adminToken);
    expect(res.status).toBe(200);
    expect(typeof res.size).toBe('number');
    expect(Array.isArray(res.keys)).toBe(true);
  });
});
