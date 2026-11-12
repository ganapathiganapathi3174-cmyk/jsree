import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

// Isolated (mocked Supabase) verification of authService.register().
// No database is touched and no credentials are printed.
//
// Covers the registration business rules that previously had unit coverage
// only inside the env-blocked integration suite: uniqueness rejections,
// referral validation, the generated-code loop, the pending-status insert,
// the issued token, and the non-blocking side effects.

const TEST_JWT_SECRET = 'test-jwt-secret-for-registration-tests-32ch';

let mockSupabaseQuery;
let insertSpy;
let insertedPayload;

// Deferred access only: the vi.mock factory below must not read these at
// factory time (vi.mock is hoisted above let declarations).
function setRows({ email = null, mobile = null, referral = null, insert = null } = {}) {
  insertedPayload = null;
  insertSpy = vi.fn((payload) => { insertedPayload = payload; });
  mockSupabaseQuery = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn((col, val) => ({
        single: vi.fn(async () => {
          if (col === 'email') return { data: email };
          if (col === 'mobile') return { data: mobile };
          if (col === 'referral_code') {
            // Referral lookup uses the operator's code; the uniqueness loop
            // uses a freshly generated REFxxxxxx code. Tests that provide a
            // referrer match on that exact code only.
            if (referral && val === referral.referral_code) return { data: referral };
            return { data: null };
          }
          return { data: null };
        }),
      })),
    })),
    insert: (...args) => {
      insertSpy(...args);
      return {
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: insert, error: insert ? null : { message: 'insert failed' } })),
        })),
      };
    },
  }));
}

vi.mock('../../db/supabase.js', () => ({
  supabase: { from: vi.fn(() => mockSupabaseQuery()) },
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
  default: {
    checkMultipleAccountsSameIP: vi.fn(),
    checkBulkReferrals: vi.fn(),
  },
}));

const { logAction } = await import('../../services/auditService.js');
const ipLogService = (await import('../../services/ipLogService.js')).default;
const suspiciousActivityService = (await import('../../services/suspiciousActivityService.js')).default;
const authService = await import('../../services/authService.js');

const NEW_USER_ROW = {
  id: 'user-new-1',
  full_name: 'Test User',
  email: 'newuser@example.com',
  mobile: '9999999001',
  referral_code: 'REFABC1',
  current_plan: 120,
  status: 'pending',
  role: 'user',
  avatar_url: null,
};

const baseInput = {
  name: 'Test User',
  email: 'newuser@example.com',
  mobile: '9999999001',
  password: 'Test@123',
  plan: '120',
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.JWT_EXPIRES_IN = '7d';
  setRows();
});

describe('authService.register - success path', () => {
  it('creates a pending user with a generated REF code and a verifiable token', async () => {
    setRows({ insert: NEW_USER_ROW });

    const result = await authService.register(baseInput, '127.0.0.1', 'vitest');

    expect(result.user.status).toBe('pending');
    expect(result.user.current_plan).toBe(120);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const payload = insertedPayload;
    expect(payload.referral_code).toMatch(/^REF[A-Z0-9]{6}$/);
    expect(payload.status).toBe('pending');
    expect(payload.role).toBe('user');
    expect(payload.referred_by).toBeNull();
    expect(payload.current_plan).toBe(120);
    expect(payload.email).toBe('newuser@example.com');
    expect(payload.password_hash).not.toBe('Test@123');

    const decoded = jwt.verify(result.token, TEST_JWT_SECRET);
    expect(decoded.userId).toBe(NEW_USER_ROW.id);
    expect(decoded.role).toBe('user');

    expect(logAction).toHaveBeenCalledWith(
      NEW_USER_ROW.id, 'user', 'register', NEW_USER_ROW.id, 'user',
      expect.objectContaining({ plan: 120, referredBy: null })
    );
    expect(ipLogService.logEvent).toHaveBeenCalledWith(
      NEW_USER_ROW.id, '127.0.0.1', 'vitest', 'register', { plan: 120 }
    );
    expect(suspiciousActivityService.checkMultipleAccountsSameIP).toHaveBeenCalledWith('127.0.0.1');
  });

  it('resolves a valid referral code to referred_by and audits the bulk-referral check', async () => {
    const referrer = {
      id: 'referrer-1',
      status: 'active',
      referral_code: 'REFERR01',
    };
    setRows({ referral: referrer, insert: { ...NEW_USER_ROW, referred_by: referrer.id } });

    const result = await authService.register(
      { ...baseInput, referralCode: 'referr01' },
      '10.0.0.5',
      'vitest'
    );

    expect(result.user.referred_by).toBe(referrer.id);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertedPayload.referred_by).toBe(referrer.id);
    expect(suspiciousActivityService.checkBulkReferrals).toHaveBeenCalledWith(referrer.id);
  });
});

describe('authService.register - rejection paths', () => {
  it('rejects a duplicate email with EMAIL_EXISTS and never inserts', async () => {
    setRows({ email: { id: 'existing-1' } });

    await expect(authService.register(baseInput)).rejects.toMatchObject({
      code: 'EMAIL_EXISTS',
      message: 'Email already registered',
    });
    expect(insertSpy).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it('rejects a duplicate mobile with MOBILE_EXISTS and never inserts', async () => {
    setRows({ mobile: { id: 'existing-2' } });

    await expect(authService.register(baseInput)).rejects.toMatchObject({
      code: 'MOBILE_EXISTS',
      message: 'Mobile number already registered',
    });
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects an unknown referral code with INVALID_REFERRAL before any insert', async () => {
    setRows();

    await expect(
      authService.register({ ...baseInput, referralCode: 'REFDOES1' })
    ).rejects.toMatchObject({
      code: 'INVALID_REFERRAL',
      message: 'Invalid referral code',
    });
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects a referral code whose owner is inactive with REFERRAL_INACTIVE', async () => {
    setRows({
      referral: { id: 'referrer-2', status: 'inactive', referral_code: 'REFDEAD1' },
    });

    await expect(
      authService.register({ ...baseInput, referralCode: 'REFDEAD1' })
    ).rejects.toMatchObject({
      code: 'REFERRAL_INACTIVE',
      message: 'Referral code is no longer active',
    });
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('maps an insert failure to REGISTRATION_FAILED', async () => {
    setRows({ insert: null });

    await expect(authService.register(baseInput)).rejects.toMatchObject({
      code: 'REGISTRATION_FAILED',
      message: 'Registration failed',
    });
    expect(logAction).not.toHaveBeenCalled();
  });
});
