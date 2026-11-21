import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';

// Focused tests for the PAYMENT_NOT_APPROVED login payload:
//  - when NO payment row exists, selectedPlan/expectedAmount fall back to
//    the user's own current_plan via the trusted PLAN_AMOUNTS mapping;
//  - when a payment row exists, its values ALWAYS take precedence.

const TEST_JWT_SECRET = 'test-jwt-secret-for-payment-payload-tests-32ch!';

let mockSupabaseQuery;

vi.mock('../../db/supabase.js', () => ({
  supabase: {
    from: vi.fn((table) => mockSupabaseQuery(table)),
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

const HASH = bcrypt.hashSync('PendingPw!123', 12);

function makePendingUser(currentPlan) {
  return {
    id: `user-plan-${currentPlan}`,
    email: `pending${currentPlan}@test.com`,
    password_hash: HASH,
    role: 'user',
    status: 'pending',
    full_name: 'Pending User',
    mobile: '9000000000',
    referral_code: `REF${currentPlan}`,
    current_plan: currentPlan,
    avatar_url: null,
  };
}

// users chain:  from('users').select('*').eq('email', ...).single()
// payments chain: from('payments').select(...).eq('user_id', ...).order(...).limit(1).single()
function setupLoginQueries(user, payment) {
  const userSingle = vi.fn().mockResolvedValue(
    user ? { data: user, error: null } : { data: null, error: { message: 'not found' } }
  );
  const userEq = vi.fn().mockReturnValue({ single: userSingle });
  const userSelect = vi.fn().mockReturnValue({ eq: userEq, single: userSingle });

  const paySingle = vi.fn().mockResolvedValue(
    payment ? { data: payment, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }
  );
  const payLimit = vi.fn().mockReturnValue({ single: paySingle });
  const payOrder = vi.fn().mockReturnValue({ limit: payLimit });
  const payEq = vi.fn().mockReturnValue({ order: payOrder, single: paySingle });
  const paySelect = vi.fn().mockReturnValue({ eq: payEq, single: paySingle });

  mockSupabaseQuery = vi.fn((table) => {
    if (table === 'users') return { select: userSelect, eq: userEq, single: userSingle };
    if (table === 'payments') return { select: paySelect, eq: payEq, single: paySingle };
    throw new Error(`Unexpected table queried: ${table}`);
  });
}

async function expectPendingRejection(email) {
  const authService = await import('../../services/authService.js');
  try {
    await authService.login(email, 'PendingPw!123');
    expect.fail('login should have thrown PAYMENT_NOT_APPROVED');
  } catch (e) {
    expect(e.code).toBe('PAYMENT_NOT_APPROVED');
    return e.data;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.JWT_EXPIRES_IN = '7d';
});

describe('PAYMENT_NOT_APPROVED payload — fallback when no payment row exists', () => {
  it.each([
    [120, 120],
    [500, 500],
    [1000, 1000],
  ])('plan %i → selectedPlan %i and expectedAmount %i from user.current_plan', async (plan, expectedAmount) => {
    const user = makePendingUser(plan);
    setupLoginQueries(user, null);

    const data = await expectPendingRejection(user.email);

    expect(data.accountStatus).toBe('pending');
    expect(data.paymentStatus).toBeNull();
    expect(data.paymentId).toBeNull();
    expect(data.selectedPlan).toBe(expectedAmount);
    expect(data.expectedAmount).toBe(expectedAmount);
    expect(data.submittedAt).toBeNull();
    expect(data.rejectionReason).toBeNull();
  });

  it('returns null fallbacks when user.current_plan is null/unknown', async () => {
    const user = makePendingUser(null);
    setupLoginQueries(user, null);

    const data = await expectPendingRejection(user.email);

    expect(data.selectedPlan).toBeNull();
    expect(data.expectedAmount).toBeNull();
  });
});

describe('PAYMENT_NOT_APPROVED payload — payment row takes precedence', () => {
  it('uses payment selected_plan/expected_amount over user.current_plan', async () => {
    const user = makePendingUser(120);
    const payment = {
      id: 'pay-precedence-1',
      status: 'pending',
      selected_plan: 1000,
      expected_amount: 1000,
      rejection_reason: null,
      submitted_at: '2026-11-20T10:00:00+00:00',
    };
    setupLoginQueries(user, payment);

    const data = await expectPendingRejection(user.email);

    expect(data.paymentId).toBe('pay-precedence-1');
    expect(data.paymentStatus).toBe('pending');
    expect(data.selectedPlan).toBe(1000);
    expect(data.expectedAmount).toBe(1000);
    expect(data.submittedAt).toBe('2026-11-20T10:00:00+00:00');
  });

  it('falls back per-field: payment amount wins, missing plan falls back to user.current_plan', async () => {
    const user = makePendingUser(500);
    const payment = {
      id: 'pay-partial-1',
      status: 'pending',
      selected_plan: null,
      expected_amount: 777,
      rejection_reason: null,
      submitted_at: '2026-11-20T11:00:00+00:00',
    };
    setupLoginQueries(user, payment);

    const data = await expectPendingRejection(user.email);

    expect(data.selectedPlan).toBe(500);
    expect(data.expectedAmount).toBe(777);
  });

  it('keeps rejected payment status mapping unchanged', async () => {
    const user = makePendingUser(120);
    const payment = {
      id: 'pay-rejected-1',
      status: 'rejected',
      selected_plan: 120,
      expected_amount: 120,
      rejection_reason: 'Amount mismatch',
      submitted_at: '2026-11-20T09:00:00+00:00',
    };
    setupLoginQueries(user, payment);

    const authService = await import('../../services/authService.js');
    await expect(authService.login(user.email, 'PendingPw!123')).rejects.toMatchObject({
      code: 'PAYMENT_NOT_APPROVED',
      message: 'Your payment was not approved. Please contact support.',
      data: {
        paymentStatus: 'rejected',
        selectedPlan: 120,
        expectedAmount: 120,
        rejectionReason: 'Amount mismatch',
      },
    });
  });
});
