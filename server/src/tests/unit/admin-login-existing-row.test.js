import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

// Isolated (mocked Supabase) verification of adminLogin() behaviour around the
// DEFECT-A conflict. No database is touched and no credentials are printed.
//
// Invariant under test: when a users row already exists for ADMIN_EMAIL,
// adminLogin() must take the "existing row" branch and NEVER attempt an insert.
// The unguarded auto-provision insert (hard-coded referral_code 'ADMIN001') is
// exactly what crashes with "Cannot read properties of null (reading 'id')"
// when ADMIN001 is already taken by another row.

const TEST_JWT_SECRET = 'test-jwt-secret-for-admin-login-tests-32chars!!';

let mockSupabaseQuery;
let insertSpy;
let fromCalls;

vi.mock('../../db/supabase.js', () => ({
  supabase: { from: vi.fn(() => { fromCalls++; return mockSupabaseQuery(); }) },
  supabaseAnon: {},
  default: {},
}));

vi.mock('../../services/auditService.js', () => ({
  logAction: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../services/ipLogService.js', () => ({
  default: { logEvent: vi.fn().mockResolvedValue(true) },
}));

vi.mock('../../services/suspiciousActivityService.js', () => ({
  default: { checkMultipleAccountsSameIP: vi.fn(), checkBulkReferrals: vi.fn() },
}));

const hash = (pw) => bcrypt.hashSync(pw, 12);

function setupQueryReturning(row) {
  insertSpy = vi.fn(() => { throw new Error('adminLogin must not attempt an insert when a row exists'); });
  const single = vi.fn().mockResolvedValue({ data: row, error: row ? null : { message: 'not found' } });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq, single });
  mockSupabaseQuery = vi.fn(() => ({ select, eq, single, insert: insertSpy }));
}

async function loadAuthService() {
  return import('../../services/authService.js');
}

beforeEach(() => {
  vi.clearAllMocks();
  fromCalls = 0;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.JWT_EXPIRES_IN = '7d';
});

describe('adminLogin with an existing admin row (isolated)', () => {
  const ADMIN_EMAIL = 'configured-admin@test.com';

  it('succeeds and never attempts a duplicate/conflicting insert', async () => {
    process.env.ADMIN_EMAIL = ADMIN_EMAIL;
    process.env.ADMIN_PASSWORD_HASH = hash('adminpass');
    setupQueryReturning({ id: 'existing-admin', full_name: 'Admin', email: ADMIN_EMAIL, role: 'admin', status: 'active' });

    const { adminLogin } = await loadAuthService();
    const result = await adminLogin(ADMIN_EMAIL, 'adminpass');

    expect(result.token).toBeDefined();
    expect(result.user.id).toBe('existing-admin');
    expect(jwt.verify(result.token, TEST_JWT_SECRET).role).toBe('admin');
    // The conflict condition: only the SELECT ran, no INSERT.
    expect(fromCalls).toBe(1);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects a wrong password before any row lookup or insert', async () => {
    process.env.ADMIN_EMAIL = ADMIN_EMAIL;
    process.env.ADMIN_PASSWORD_HASH = hash('adminpass');
    setupQueryReturning({ id: 'existing-admin', role: 'admin', status: 'active' });

    const { adminLogin } = await loadAuthService();
    await expect(adminLogin(ADMIN_EMAIL, 'wrong')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    expect(fromCalls).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects an email that does not match ADMIN_EMAIL', async () => {
    process.env.ADMIN_EMAIL = ADMIN_EMAIL;
    process.env.ADMIN_PASSWORD_HASH = hash('adminpass');
    setupQueryReturning(null);

    const { adminLogin } = await loadAuthService();
    await expect(adminLogin('someone-else@test.com', 'adminpass')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    expect(fromCalls).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects when the matching row is not an admin', async () => {
    process.env.ADMIN_EMAIL = ADMIN_EMAIL;
    process.env.ADMIN_PASSWORD_HASH = hash('adminpass');
    setupQueryReturning({ id: 'u1', role: 'user', status: 'active' });

    const { adminLogin } = await loadAuthService();
    await expect(adminLogin(ADMIN_EMAIL, 'adminpass')).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('reports ADMIN_NOT_CONFIGURED when the admin env pair is absent', async () => {
    process.env.ADMIN_EMAIL = '';
    process.env.ADMIN_PASSWORD_HASH = '';
    setupQueryReturning(null);

    const { adminLogin } = await loadAuthService();
    await expect(adminLogin('x@test.com', 'y')).rejects.toMatchObject({ code: 'ADMIN_NOT_CONFIGURED' });
    expect(fromCalls).toBe(0);
  });
});
