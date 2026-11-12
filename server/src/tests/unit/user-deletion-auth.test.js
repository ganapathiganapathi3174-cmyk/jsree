import { describe, it, expect, vi, beforeEach } from 'vitest';

// Session/login invalidation after a user account is hard-deleted.
// The app uses stateless JWTs: every request re-reads the users row, so a
// deleted account must be rejected at the middleware and at login.
const { authState, supabaseMock } = vi.hoisted(() => {
  process.env.JWT_SECRET = 'user-deletion-auth-test-secret-32-chars';
  return {
    authState: { row: null },
    supabaseMock: { from: vi.fn(), rpc: vi.fn(), storage: { from: vi.fn() } },
  };
});

vi.mock('../../db/supabase.js', () => ({
  supabase: supabaseMock,
  supabaseAnon: {},
  default: supabaseMock,
}));
vi.mock('../../services/auditService.js', () => ({ logAction: vi.fn() }));
vi.mock('../../services/ipLogService.js', () => ({ default: { logEvent: vi.fn() } }));
vi.mock('../../services/suspiciousActivityService.js', () => ({ default: {} }));

import { authenticateToken, requireAdmin } from '../../middleware/auth.js';
import { login } from '../../services/authService.js';
import { generateToken } from '../../utils/helpers.js';

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.row = null;
  supabaseMock.from.mockImplementation(() => {
    const q = {
      select: () => q,
      eq: () => q,
      single: async () => authState.row
        ? { data: authState.row, error: null }
        : { data: null, error: { code: 'PGRST116', message: 'No rows found' } },
      then(res, rej) { return Promise.resolve(authState.row ? { data: authState.row, error: null } : { data: null, error: { code: 'PGRST116' } }).then(res, rej); },
    };
    return q;
  });
});

describe('deleted user sessions are invalidated', () => {
  it('a still-valid JWT is rejected with 401 once the users row is gone', async () => {
    const token = generateToken({ userId: 'user-1' }); // valid, not expired
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = makeRes();
    const next = vi.fn();

    await authenticateToken(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ success: false, code: 'USER_NOT_FOUND' });
  });

  it('an existing user still authenticates normally (regression guard)', async () => {
    authState.row = { id: 'user-1', full_name: 'U', email: 'u@x.y', role: 'user', status: 'active' };
    const token = generateToken({ userId: 'user-1' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = makeRes();
    const next = vi.fn();

    await authenticateToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
    expect(req.user).toMatchObject({ id: 'user-1' });
  });

  it('a missing token is still rejected', async () => {
    const res = makeRes();
    const next = vi.fn();
    await authenticateToken({ headers: {} }, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('requireAdmin still gates admin routes after deletion attempts', () => {
    const next = vi.fn();
    requireAdmin({ user: { role: 'user' } }, makeRes(), next);
    expect(next).not.toHaveBeenCalled();

    const ok = makeRes();
    requireAdmin({ user: { role: 'admin' } }, ok, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('deleted user login is rejected', () => {
  it('login for a removed account fails with INVALID_CREDENTIALS (no session issued)', async () => {
    authState.row = null; // account hard-deleted
    await expect(login('ghost@example.com', 'whatever123')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('legacy soft-deleted accounts (status=deleted) remain blocked with ACCOUNT_DELETED', async () => {
    authState.row = { id: 'user-2', email: 'x@y.z', status: 'deleted', role: 'user' };
    await expect(login('x@y.z', 'whatever123')).rejects.toMatchObject({
      code: 'ACCOUNT_DELETED',
    });
  });
});
