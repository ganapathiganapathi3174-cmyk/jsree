import { describe, it, expect, vi, beforeEach } from 'vitest';
import { seedDefaultUsers, QA_USER_SPECS, getSeedPassword } from '../../scripts/seedDefaultUsers.js';
import { comparePassword } from '../../utils/helpers.js';
import { adminLogin } from '../../services/authService.js';
import { requireAdmin } from '../../middleware/auth.js';

// ─────────────────────────────────────────────────────────────
// QA DEFAULT ACCOUNTS (plans 120/500/1000): creation, state,
// idempotency, role separation. Supabase mocked; real bcrypt.
// ─────────────────────────────────────────────────────────────

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn() },
}));
vi.mock('../../db/supabase.js', () => ({ supabase: supabaseMock }));

const TEST_PASSWORD = 'QaTest@1234';

function makeUsersChain(state) {
  const obj = {
    _payload: null, _filterEmail: null,
    select: vi.fn(() => obj),
    eq: vi.fn((col, val) => { if (col === 'email') obj._filterEmail = val; return obj; }),
    single: vi.fn(async () => {
      const row = state.users[obj._filterEmail] || null;
      return row ? { data: { ...row }, error: null } : { data: null, error: { code: 'PGRST116' } };
    }),
    insert: vi.fn((payload) => {
      obj._payload = payload;
      const row = { id: `id-${payload.email}`, ...payload };
      state.users[payload.email] = row;
      return obj;
    }),
    update: vi.fn((payload) => {
      obj._payload = payload;
      const row = state.users[obj._filterEmail];
      if (row) Object.assign(row, payload);
      return obj;
    }),
  };
  // insert().select().single() chain resolves the created row
  const origSelect = obj.select;
  obj.select = vi.fn(() => {
    if (obj._payload && obj._payload.email && !obj._filterEmail) {
      const created = state.users[obj._payload.email];
      return { single: vi.fn(async () => ({ data: created, error: null })) };
    }
    return origSelect();
  });
  return obj;
}

let state;
beforeEach(() => {
  vi.clearAllMocks();
  state = { users: {} };
  supabaseMock.from.mockImplementation((table) => {
    if (table !== 'users') throw new Error('seed must only touch users, got: ' + table);
    return makeUsersChain(state);
  });
  process.env.ADMIN_EMAIL = 'admin@jsree.local';
});

describe('CASE 1: exactly 3 default accounts', () => {
  it('seeds three specs, one per plan', async () => {
    expect(QA_USER_SPECS.map(s => s.plan).sort((a, b) => a - b)).toEqual([120, 500, 1000]);
    const results = await seedDefaultUsers({ password: TEST_PASSWORD });
    expect(results).toHaveLength(3);
    expect(Object.keys(state.users).sort()).toEqual(
      ['qa.1000@jsree.local', 'qa.120@jsree.local', 'qa.500@jsree.local']);
  });
});

describe('CASES 2–5/9: active normal users on correct plans', () => {
  it('inserts active role=user rows with exact plan mapping', async () => {
    await seedDefaultUsers({ password: TEST_PASSWORD });
    for (const spec of QA_USER_SPECS) {
      const row = state.users[spec.email];
      expect(row.status).toBe('active');
      expect(row.role).toBe('user');
      expect(row.current_plan).toBe(spec.plan);
      expect(row.referred_by).toBeNull();
    }
  });

  it('stores a real bcrypt hash, never plaintext (existing mechanism)', async () => {
    await seedDefaultUsers({ password: TEST_PASSWORD });
    for (const spec of QA_USER_SPECS) {
      const row = state.users[spec.email];
      expect(row.password_hash).not.toBe(TEST_PASSWORD);
      expect(row.password_hash.startsWith('$2')).toBe(true);
      // CASE 6 core: USER LOGIN accepts these credentials via comparePassword.
      expect(await comparePassword(TEST_PASSWORD, row.password_hash)).toBe(true);
    }
  });
});

describe('CASE 7: default users cannot use admin login', () => {
  it('adminLogin rejects QA emails (env-admin identity only)', async () => {
    await expect(adminLogin('qa.120@jsree.local', TEST_PASSWORD)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });
});

describe('CASE 8: default user token → admin API denied', () => {
  it('requireAdmin returns 403 for role=user', () => {
    const req = { user: { id: 'x', role: 'user' } };
    let status = null; let body = null;
    const res = { status: (s) => { status = s; return { json: (b) => { body = b; } }; } };
    const next = vi.fn();
    requireAdmin(req, res, next);
    expect(status).toBe(403);
    expect(body.code).toBe('ADMIN_REQUIRED');
    expect(next).not.toHaveBeenCalled();
  });
});

describe('CASE 10: idempotent re-seed creates zero duplicates', () => {
  it('second run reuses rows and only enforces state', async () => {
    const first = await seedDefaultUsers({ password: TEST_PASSWORD });
    expect(first.every(r => r.reused === false)).toBe(true);
    const second = await seedDefaultUsers({ password: 'Different@999' });
    expect(second.every(r => r.reused === true)).toBe(true);
    expect(Object.keys(state.users)).toHaveLength(3);
    // Password untouched by reuse.
    expect(await comparePassword(TEST_PASSWORD, state.users['qa.120@jsree.local'].password_hash)).toBe(true);
  });
});

describe('CASES 11–12: existing users and admins preserved', () => {
  it('never touches non-QA rows; refuses admin collisions', async () => {
    state.users['real.user@example.com'] = { id: 'real-1', email: 'real.user@example.com', role: 'user', status: 'active', current_plan: 120 };
    state.users['qa.500@jsree.local'] = { id: 'adm-1', email: 'qa.500@jsree.local', role: 'admin', status: 'active', current_plan: 500 };
    await expect(seedDefaultUsers({ password: TEST_PASSWORD })).rejects.toThrow(/Refusing to touch admin/);
    expect(state.users['real.user@example.com']).toMatchObject({ status: 'active', current_plan: 120 });
  });
});

describe('CASE 15: seeded rows are ordinary deletable users', () => {
  it('carries no protection flags; role=user so existing delete path applies', async () => {
    await seedDefaultUsers({ password: TEST_PASSWORD });
    for (const spec of QA_USER_SPECS) {
      const row = state.users[spec.email];
      expect(row.role).not.toBe('admin');
      expect(row.is_deleted || false).toBe(false);
    }
  });
});

describe('seed password handling', () => {
  it('requires QA_SEED_PASSWORD env (never committed)', () => {
    delete process.env.QA_SEED_PASSWORD;
    expect(() => getSeedPassword()).toThrow(/QA_SEED_PASSWORD/);
    process.env.QA_SEED_PASSWORD = 'short';
    expect(() => getSeedPassword()).toThrow();
  });
});
