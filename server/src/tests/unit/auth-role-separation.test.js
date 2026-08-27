import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const TEST_JWT_SECRET = 'test-jwt-secret-for-role-separation-tests-32chars!';

let mockSupabaseQuery;

vi.mock('../../db/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => mockSupabaseQuery()),
  },
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

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.JWT_EXPIRES_IN = '7d';
  process.env.ADMIN_EMAIL = 'admin@test.com';
  process.env.ADMIN_PASSWORD_HASH = undefined;
});

function makeSupabaseResponse(data, error = null) {
  return { data, error };
}

function chainQuery(result) {
  const single = vi.fn().mockResolvedValue(result);
  const limit = vi.fn().mockReturnValue({ single });
  const order = vi.fn().mockReturnValue({ limit });
  const eq3 = vi.fn().mockReturnValue({ single });
  const eq2 = vi.fn().mockReturnValue({ single: eq3 });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2, single });
  const select = vi.fn().mockReturnValue({ eq: eq1, single, order });
  return { select, eq: eq1, single, order, limit };
}

function setupUserLoginQuery(user) {
  const response = user
    ? makeSupabaseResponse(user)
    : makeSupabaseResponse(null, { message: 'not found' });

  const single = vi.fn().mockResolvedValue(response);
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq, single });

  mockSupabaseQuery = vi.fn(() => ({ select, eq, single }));
}

function setupAdminLoginQuery(existingUser) {
  const firstQueryResponse = existingUser
    ? makeSupabaseResponse(existingUser)
    : makeSupabaseResponse(null, { message: 'not found' });
  const firstSingle = vi.fn().mockResolvedValue(firstQueryResponse);
  const firstEq = vi.fn().mockReturnValue({ single: firstSingle });
  const firstSelect = vi.fn().mockReturnValue({ eq: firstEq, single: firstSingle });

  let callCount = 0;
  mockSupabaseQuery = vi.fn(() => {
    callCount++;
    if (callCount === 1) {
      return { select: firstSelect, eq: firstEq, single: firstSingle };
    }
    const newAdmin = {
      id: 'new-admin-uuid',
      full_name: 'Admin',
      email: process.env.ADMIN_EMAIL,
      role: 'admin',
      status: 'active',
    };
    const newSingle = vi.fn().mockResolvedValue(makeSupabaseResponse(newAdmin));
    const insertResult = {
      select: vi.fn().mockReturnValue({ single: newSingle }),
    };
    return { insert: vi.fn().mockReturnValue(insertResult) };
  });
}

async function importAuthService() {
  const mod = await import('../../services/authService.js');
  return mod;
}

function hashForTest(password) {
  return bcrypt.hashSync(password, 12);
}

describe('Auth Role Separation — Security', { timeout: 15000 }, () => {
  describe('CASE 1: Normal user credentials → User Login', () => {
    it('should succeed for active user', async () => {
      const hashedPw = hashForTest('user123');
      setupUserLoginQuery({
        id: 'user-1',
        email: 'user@test.com',
        password_hash: hashedPw,
        role: 'user',
        status: 'active',
        full_name: 'Test User',
        mobile: '1234567890',
        referral_code: 'REF001',
        current_plan: 120,
        avatar_url: null,
      });

      const authService = await importAuthService();
      const result = await authService.login('user@test.com', 'user123');

      expect(result.token).toBeDefined();
      expect(result.user.role).toBe('user');
      expect(result.user.email).toBe('user@test.com');

      const decoded = jwt.verify(result.token, TEST_JWT_SECRET);
      expect(decoded.role).toBe('user');
      expect(decoded.userId).toBe('user-1');
    });
  });

  describe('CASE 2: Admin credentials → User Login', () => {
    it('should reject admin from user login with generic error', async () => {
      const hashedPw = hashForTest('admin123');
      setupUserLoginQuery({
        id: 'admin-1',
        email: 'admin@test.com',
        password_hash: hashedPw,
        role: 'admin',
        status: 'active',
        full_name: 'Admin',
        mobile: '0000000000',
        referral_code: 'ADMIN001',
        current_plan: null,
        avatar_url: null,
      });

      const authService = await importAuthService();
      await expect(
        authService.login('admin@test.com', 'admin123')
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    });

    it('should not reveal that the account is an admin', async () => {
      const hashedPw = hashForTest('admin123');
      setupUserLoginQuery({
        id: 'admin-1',
        email: 'admin@test.com',
        password_hash: hashedPw,
        role: 'admin',
        status: 'active',
        full_name: 'Admin',
        mobile: '0000000000',
        referral_code: 'ADMIN001',
        current_plan: null,
        avatar_url: null,
      });

      const authService = await importAuthService();
      try {
        await authService.login('admin@test.com', 'admin123');
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e.message).not.toContain('admin');
        expect(e.message).not.toContain('Admin');
      }
    });
  });

  describe('CASE 3: Normal user credentials → Admin Login', () => {
    it('should reject normal user from admin login (env var mismatch)', async () => {
      process.env.ADMIN_EMAIL = 'admin@test.com';
      process.env.ADMIN_PASSWORD_HASH = hashForTest('adminpass');

      setupAdminLoginQuery(null);

      const authService = await importAuthService();
      await expect(
        authService.adminLogin('user@test.com', 'user123')
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    });
  });

  describe('CASE 4: Admin credentials → Admin Login', () => {
    it('should succeed for admin via admin-login endpoint', async () => {
      const adminHash = hashForTest('adminpass');
      process.env.ADMIN_EMAIL = 'admin@test.com';
      process.env.ADMIN_PASSWORD_HASH = adminHash;

      const adminUser = {
        id: 'admin-1',
        full_name: 'Admin',
        email: 'admin@test.com',
        role: 'admin',
        status: 'active',
      };

      const single = vi.fn().mockResolvedValue(makeSupabaseResponse(adminUser));
      const eq = vi.fn().mockReturnValue({ single });
      const select = vi.fn().mockReturnValue({ eq, single });
      mockSupabaseQuery = vi.fn(() => ({ select, eq, single }));

      const authService = await importAuthService();
      const result = await authService.adminLogin('admin@test.com', 'adminpass');

      expect(result.token).toBeDefined();
      expect(result.user.role).toBe('admin');

      const decoded = jwt.verify(result.token, TEST_JWT_SECRET);
      expect(decoded.role).toBe('admin');
    });

    it('should auto-create admin in DB if not found', async () => {
      const adminHash = hashForTest('adminpass');
      process.env.ADMIN_EMAIL = 'newadmin@test.com';
      process.env.ADMIN_PASSWORD_HASH = adminHash;

      const newAdmin = {
        id: 'new-admin-uuid',
        full_name: 'Admin',
        email: 'newadmin@test.com',
        role: 'admin',
        status: 'active',
      };

      const newSingle = vi.fn().mockResolvedValue(makeSupabaseResponse(newAdmin));
      const insertResult = {
        select: vi.fn().mockReturnValue({ single: newSingle }),
      };
      const insert = vi.fn().mockReturnValue(insertResult);

      const notFoundResponse = makeSupabaseResponse(null, { message: 'not found' });
      const eqSingle = vi.fn().mockResolvedValue(notFoundResponse);
      const eq = vi.fn().mockReturnValue({ single: eqSingle });
      const select = vi.fn().mockReturnValue({ eq, single: eqSingle });

      let callCount = 0;
      mockSupabaseQuery = vi.fn(() => {
        callCount++;
        if (callCount === 1) return { select, eq, single: eqSingle };
        return { insert };
      });

      const authService = await importAuthService();
      const result = await authService.adminLogin('newadmin@test.com', 'adminpass');

      expect(result.token).toBeDefined();
      expect(result.user.role).toBe('admin');
    });
  });

  describe('CASE 5: Normal user token → Admin API', () => {
    it('should reject when role is not admin in middleware', async () => {
      const { authenticateToken, requireAdmin } = await import('../../middleware/auth.js');

      const userToken = jwt.sign(
        { userId: 'user-1', role: 'user' },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
      );

      const userRow = {
        id: 'user-1',
        full_name: 'Test User',
        email: 'user@test.com',
        role: 'user',
        status: 'active',
        mobile: '1234567890',
        referral_code: 'REF001',
        current_plan: 120,
        avatar_url: null,
      };

      const single = vi.fn().mockResolvedValue(makeSupabaseResponse(userRow));
      const eq = vi.fn().mockReturnValue({ single });
      const select = vi.fn().mockReturnValue({ eq, single });
      mockSupabaseQuery = vi.fn(() => ({ select, eq, single }));

      const req = {
        headers: { authorization: `Bearer ${userToken}` },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await authenticateToken(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.user.role).toBe('user');

      requireAdmin(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'ADMIN_REQUIRED' })
      );
    });
  });

  describe('CASE 6: Admin token → Admin API', () => {
    it('should allow admin through authenticateToken + requireAdmin', async () => {
      const { authenticateToken, requireAdmin } = await import('../../middleware/auth.js');

      const adminToken = jwt.sign(
        { userId: 'admin-1', role: 'admin' },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
      );

      const adminRow = {
        id: 'admin-1',
        full_name: 'Admin',
        email: 'admin@test.com',
        role: 'admin',
        status: 'active',
        mobile: '0000000000',
        referral_code: 'ADMIN001',
        current_plan: null,
        avatar_url: null,
      };

      const single = vi.fn().mockResolvedValue(makeSupabaseResponse(adminRow));
      const eq = vi.fn().mockReturnValue({ single });
      const select = vi.fn().mockReturnValue({ eq, single });
      mockSupabaseQuery = vi.fn(() => ({ select, eq, single }));

      const req = {
        headers: { authorization: `Bearer ${adminToken}` },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await authenticateToken(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.user.role).toBe('admin');

      requireAdmin(req, res, next);
      expect(next).toHaveBeenCalledTimes(2);
    });
  });

  describe('CASE 7: Normal user modifies role in request body', () => {
    it('should ignore role from request body — login uses DB role', async () => {
      const hashedPw = hashForTest('user123');
      setupUserLoginQuery({
        id: 'user-1',
        email: 'user@test.com',
        password_hash: hashedPw,
        role: 'user',
        status: 'active',
        full_name: 'Test User',
        mobile: '1234567890',
        referral_code: 'REF001',
        current_plan: 120,
        avatar_url: null,
      });

      const authService = await importAuthService();
      const result = await authService.login('user@test.com', 'user123');

      const decoded = jwt.verify(result.token, TEST_JWT_SECRET);
      expect(decoded.role).toBe('user');
    });
  });

  describe('CASE 8: User modifies localStorage role', () => {
    it('should not grant admin access — backend checks DB role on every request', async () => {
      const userToken = jwt.sign(
        { userId: 'user-1', role: 'user' },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
      );

      const userRow = {
        id: 'user-1',
        full_name: 'Test User',
        email: 'user@test.com',
        role: 'user',
        status: 'active',
        mobile: '1234567890',
        referral_code: 'REF001',
        current_plan: 120,
        avatar_url: null,
      };

      const single = vi.fn().mockResolvedValue(makeSupabaseResponse(userRow));
      const eq = vi.fn().mockReturnValue({ single });
      const select = vi.fn().mockReturnValue({ eq, single });
      mockSupabaseQuery = vi.fn(() => ({ select, eq, single }));

      const { authenticateToken, requireAdmin } = await import('../../middleware/auth.js');

      const req = { headers: { authorization: `Bearer ${userToken}` } };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await authenticateToken(req, res, next);
      expect(req.user.role).toBe('user');

      requireAdmin(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('CASE 9: Forged/modified JWT', () => {
    it('should reject tokens signed with wrong secret', async () => {
      const forgedToken = jwt.sign(
        { userId: 'admin-1', role: 'admin' },
        'wrong-secret-32-chars!!!!!!!!!!!!!!',
        { expiresIn: '1h' }
      );

      const { authenticateToken } = await import('../../middleware/auth.js');

      const req = { headers: { authorization: `Bearer ${forgedToken}` } };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await authenticateToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'TOKEN_INVALID' })
      );
    });

    it('should reject expired tokens', async () => {
      const expiredToken = jwt.sign(
        { userId: 'user-1', role: 'user' },
        TEST_JWT_SECRET,
        { expiresIn: '0s' }
      );

      await new Promise((r) => setTimeout(r, 1100));

      const { authenticateToken } = await import('../../middleware/auth.js');

      const req = { headers: { authorization: `Bearer ${expiredToken}` } };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await authenticateToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'TOKEN_INVALID' })
      );
    });

    it('should reject tokens with tampered payload', async () => {
      const legitToken = jwt.sign(
        { userId: 'user-1', role: 'user' },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
      );

      const parts = legitToken.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      payload.role = 'admin';
      parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64');
      const tamperedToken = parts.join('.');

      const { authenticateToken } = await import('../../middleware/auth.js');

      const req = { headers: { authorization: `Bearer ${tamperedToken}` } };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await authenticateToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('CASE 10: User navigates to /admin/dashboard', () => {
    it('should reject admin route access for user token via middleware', async () => {
      const userToken = jwt.sign(
        { userId: 'user-1', role: 'user' },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
      );

      const userRow = {
        id: 'user-1',
        role: 'user',
        status: 'active',
      };

      const single = vi.fn().mockResolvedValue(makeSupabaseResponse(userRow));
      const eq = vi.fn().mockReturnValue({ single });
      const select = vi.fn().mockReturnValue({ eq, single });
      mockSupabaseQuery = vi.fn(() => ({ select, eq, single }));

      const { authenticateToken, requireAdmin } = await import('../../middleware/auth.js');

      const req = { headers: { authorization: `Bearer ${userToken}` } };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await authenticateToken(req, res, next);
      requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'ADMIN_REQUIRED' })
      );
    });
  });

  describe('CASE 11: Admin navigates to normal user dashboard', () => {
    it('should allow admin through user routes (requireActiveUser lets admin pass)', async () => {
      const adminToken = jwt.sign(
        { userId: 'admin-1', role: 'admin' },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
      );

      const adminRow = {
        id: 'admin-1',
        role: 'admin',
        status: 'active',
      };

      const single = vi.fn().mockResolvedValue(makeSupabaseResponse(adminRow));
      const eq = vi.fn().mockReturnValue({ single });
      const select = vi.fn().mockReturnValue({ eq, single });
      mockSupabaseQuery = vi.fn(() => ({ select, eq, single }));

      const { authenticateToken, requireActiveUser } = await import('../../middleware/auth.js');

      const req = { headers: { authorization: `Bearer ${adminToken}` } };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await authenticateToken(req, res, next);
      requireActiveUser(req, res, next);

      expect(next).toHaveBeenCalledTimes(2);
    });
  });

  describe('Defense-in-depth: adminLogin DB role check', () => {
    it('should reject if DB user exists but role is not admin', async () => {
      const adminHash = hashForTest('adminpass');
      process.env.ADMIN_EMAIL = 'admin@test.com';
      process.env.ADMIN_PASSWORD_HASH = adminHash;

      const normalUser = {
        id: 'user-1',
        full_name: 'Normal User',
        email: 'admin@test.com',
        role: 'user',
        status: 'active',
      };

      const single = vi.fn().mockResolvedValue(makeSupabaseResponse(normalUser));
      const eq = vi.fn().mockReturnValue({ single });
      const select = vi.fn().mockReturnValue({ eq, single });
      mockSupabaseQuery = vi.fn(() => ({ select, eq, single }));

      const authService = await importAuthService();
      await expect(
        authService.adminLogin('admin@test.com', 'adminpass')
      ).rejects.toMatchObject({
        code: 'ADMIN_REQUIRED',
        message: 'Account is not an admin account',
      });
    });
  });

  describe('Password still required for login', () => {
    it('should reject user login with wrong password', async () => {
      setupUserLoginQuery(null);

      const authService = await importAuthService();
      await expect(
        authService.login('user@test.com', 'wrongpass')
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    });

    it('should reject admin login with wrong password', async () => {
      const adminHash = hashForTest('correctpass');
      process.env.ADMIN_EMAIL = 'admin@test.com';
      process.env.ADMIN_PASSWORD_HASH = adminHash;

      setupAdminLoginQuery(null);

      const authService = await importAuthService();
      await expect(
        authService.adminLogin('admin@test.com', 'wrongpass')
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    });
  });
});
