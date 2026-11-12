import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';

// ─────────────────────────────────────────────────────────────
// Admin login hardening (Phase 6 of the 11 Nov 2026 remediation):
//   * missing env configuration refuses cleanly (no crash, no leak)
//   * wrong password is a generic INVALID_CREDENTIALS (no oracle)
//   * DISABLED admin rows (status != active) cannot mint sessions
//   * admin-login endpoint has its own tighter rate-limit bucket
// ─────────────────────────────────────────────────────────────

const { supabaseMock, logAction } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn(), storage: { from: vi.fn() } },
  logAction: vi.fn(),
}));

vi.mock('../../db/supabase.js', () => ({ supabase: supabaseMock, supabaseAnon: {} }));
vi.mock('../../services/auditService.js', () => ({ logAction }));
vi.mock('../../services/ipLogService.js', () => ({ default: { logEvent: vi.fn() } }));
vi.mock('../../services/suspiciousActivityService.js', () => ({
  default: { checkMultipleAccountsSameIP: vi.fn(), checkBulkReferrals: vi.fn() },
}));

import { adminLogin } from '../../services/authService.js';
import { createApp } from '../../app.js';

const EMAIL = 'root@jsree.test';
const PASSWORD = 'correct-horse-battery';
const HASH = bcrypt.hashSync(PASSWORD, 4);

function adminRow(overrides = {}) {
  const q = {};
  q.select = vi.fn(() => q);
  q.eq = vi.fn(() => q);
  q.single = vi.fn().mockResolvedValue({
    data: { id: 'admin-1', full_name: 'Admin', email: EMAIL, role: 'admin', status: 'active', ...overrides },
    error: null,
  });
  q.insert = vi.fn(() => q);
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = 'admin-hardening-test-secret-32-chars-min!!';
  process.env.JWT_EXPIRES_IN = '7d';
  process.env.ADMIN_EMAIL = EMAIL;
  process.env.ADMIN_PASSWORD_HASH = HASH;
});

describe('admin login hardening', () => {
  it('missing env configuration refuses with ADMIN_NOT_CONFIGURED (never a session)', async () => {
    delete process.env.ADMIN_PASSWORD_HASH;
    await expect(adminLogin(EMAIL, PASSWORD)).rejects.toMatchObject({ code: 'ADMIN_NOT_CONFIGURED' });
  });

  it('correct credentials mint a token for an active admin', async () => {
    supabaseMock.from.mockReturnValue(adminRow());
    const out = await adminLogin(EMAIL, PASSWORD, '1.2.3.4', 'ua');
    expect(out.token).toBeTruthy();
    expect(out.user.role).toBe('admin');
    expect(logAction).toHaveBeenCalledWith('admin-1', 'admin', 'admin_login', 'admin-1', 'user', {});
  });

  it('wrong password is a generic INVALID_CREDENTIALS (no account oracle)', async () => {
    await expect(adminLogin(EMAIL, 'wrong-password')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it('disabled admin row (status inactive) cannot mint a session', async () => {
    supabaseMock.from.mockReturnValue(adminRow({ status: 'inactive' }));
    await expect(adminLogin(EMAIL, PASSWORD)).rejects.toMatchObject({ code: 'ADMIN_DISABLED' });
    expect(logAction).not.toHaveBeenCalled();
  });

  it('deleted admin row cannot mint a session', async () => {
    supabaseMock.from.mockReturnValue(adminRow({ status: 'deleted' }));
    await expect(adminLogin(EMAIL, PASSWORD)).rejects.toMatchObject({ code: 'ADMIN_DISABLED' });
  });

  it('a non-admin DB row for the admin email is refused', async () => {
    supabaseMock.from.mockReturnValue(adminRow({ role: 'user' }));
    await expect(adminLogin(EMAIL, PASSWORD)).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
  });
});

describe('admin-login rate limiting (own tighter bucket)', () => {
  it('returns 429 on request 11 within the window (bucket max = 10)', async () => {
    const app = createApp({ env: { CLIENT_URL: 'https://jsree.vercel.app' }, logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const statuses = [];
      for (let i = 0; i < 11; i += 1) {
        const res = await fetch(`${base}/api/auth/admin-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: EMAIL, password: 'nope' }),
        });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
      expect(statuses[10]).toBe(429);
    } finally {
      server.close();
    }
  }, 20000);
});
