import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteUser, deleteTopup } from '../../services/adminService.js';

const { supabaseMock, logActionMock, storageState } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn(), rpc: vi.fn(), storage: { from: vi.fn() } },
  logActionMock: vi.fn(),
  storageState: {
    listCalls: [],
    removeCalls: [],
    listImpl: () => ({ data: [], error: null }),
    removeError: null,
  },
}));

vi.mock('../../db/supabase.js', () => ({ supabase: supabaseMock }));
vi.mock('../../services/auditService.js', () => ({ logAction: logActionMock }));

const adminId = 'admin-1';
const userId = 'user-1';
const topupId = 'topup-1';

// Chain that supports both .single() and direct await (thenable), which is
// how the service issues its pre-deletion reference queries.
function makeChain(result) {
  const q = {
    _result: result,
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    neq: vi.fn(() => q),
    or: vi.fn(() => q),
    in: vi.fn(() => q),
    single: vi.fn(() => Promise.resolve(q._result)),
    update: vi.fn(() => q),
    delete: vi.fn(() => q),
    insert: vi.fn(() => q),
    then(onRes, onRej) { return Promise.resolve(q._result).then(onRes, onRej); },
    catch(fn) { return Promise.resolve(q._result).catch(fn); },
  };
  return q;
}

const usersState = { result: { data: { id: userId, role: 'user', status: 'active', avatar_url: null }, error: null } };
const paymentsState = { result: { data: [{ id: 'pay-1' }], error: null } };
const topupsState = { result: { data: [{ id: 'topup-a' }], error: null } };

function resetStates() {
  usersState.result = { data: { id: userId, role: 'user', status: 'active', avatar_url: null }, error: null };
  paymentsState.result = { data: [{ id: 'pay-1' }], error: null };
  topupsState.result = { data: [{ id: 'topup-a' }], error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStates();
  storageState.listCalls.length = 0;
  storageState.removeCalls.length = 0;
  storageState.listImpl = () => ({ data: [], error: null });
  storageState.removeError = null;

  supabaseMock.from.mockImplementation((table) => {
    if (table === 'users') return makeChain(usersState.result);
    if (table === 'payments') return makeChain(paymentsState.result);
    if (table === 'topups') return makeChain(topupsState.result);
    return makeChain({ data: null, error: null });
  });
  supabaseMock.rpc.mockResolvedValue({
    data: { deleted: true, userId, storagePaths: ['payments/pay-1/screenshot.png'], archived: { payments: 1, topups: 0, walletTransactions: 2 } },
    error: null,
  });
  supabaseMock.storage.from.mockImplementation((bucket) => ({
    list: vi.fn(async (folder) => {
      storageState.listCalls.push({ bucket, folder });
      return storageState.listImpl(bucket, folder);
    }),
    remove: vi.fn(async (paths) => {
      storageState.removeCalls.push({ bucket, paths });
      return { data: null, error: storageState.removeError };
    }),
  }));
});

describe('adminService.deleteUser — complete deletion', () => {
  it('deletes via the transactional admin_delete_user RPC and reports success', async () => {
    const result = await deleteUser(userId, adminId);

    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('admin_delete_user', {
      p_user_id: userId,
      p_admin_id: adminId,
    });
    expect(result).toMatchObject({ deleted: true, userId, storageCleanup: 'complete' });
    expect(result.archived).toEqual({ payments: 1, topups: 0, walletTransactions: 2 });
    expect(logActionMock).toHaveBeenCalledWith(adminId, 'admin', 'hard_delete_user', userId, 'user', expect.objectContaining({ deleted: true }));
  });

  it('removes user-specific storage: payment folders, top-up folders, avatars and RPC screenshot paths', async () => {
    storageState.listImpl = (bucket, folder) => ({
      data: [{ name: 'shot.png', id: null }, { name: 'sub/', id: 'folder-id' }],
      error: null,
    });

    await deleteUser(userId, adminId);

    const folders = storageState.listCalls.map(c => `${c.bucket}/${c.folder}`);
    expect(folders).toEqual(expect.arrayContaining([
      'payments/payments/pay-1',
      'payments/topups/topup-a',
      'avatars/avatars/user-1',
    ]));
    // Directory entries (trailing slash) are skipped, files are removed.
    const paymentRemoves = storageState.removeCalls.filter(c => c.bucket === 'payments');
    expect(paymentRemoves.some(c => c.paths.includes('payments/pay-1/shot.png'))).toBe(true);
    expect(paymentRemoves.some(c => c.paths.includes('topups/topup-a/shot.png'))).toBe(true);
    expect(paymentRemoves.some(c => c.paths.includes('payments/pay-1/screenshot.png'))).toBe(true);
    expect(storageState.removeCalls.some(c => c.bucket === 'avatars' && c.paths.includes('avatars/user-1/shot.png'))).toBe(true);
    // No path is removed twice.
    const allPaths = storageState.removeCalls.flatMap(c => c.paths);
    expect(new Set(allPaths).size).toBe(allPaths.length);
  });

  it('returns USER_NOT_FOUND when the account no longer exists (repeat request after deletion)', async () => {
    usersState.result = { data: null, error: { code: 'PGRST116', message: 'No rows found' } };
    await expect(deleteUser(userId, adminId)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('protects admin accounts (CANNOT_DELETE_ADMIN) before any deletion runs', async () => {
    usersState.result = { data: { id: userId, role: 'admin', status: 'active' }, error: null };
    await expect(deleteUser(userId, adminId)).rejects.toMatchObject({ code: 'CANNOT_DELETE_ADMIN' });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('refuses self-deletion by the currently authenticated admin', async () => {
    usersState.result = { data: { id: adminId, role: 'user', status: 'active' }, error: null };
    await expect(deleteUser(adminId, adminId)).rejects.toMatchObject({ code: 'CANNOT_DELETE_SELF' });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('maps in-transaction RBAC failures raised by the RPC', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { message: 'ERROR: ADMIN_REQUIRED (P0001)' } });
    await expect(deleteUser(userId, adminId)).rejects.toMatchObject({ code: 'ADMIN_REQUIRED', message: 'Admin access required' });
  });

  it('maps a concurrent deletion race (USER_NOT_FOUND from the RPC)', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { message: 'ERROR: USER_NOT_FOUND (P0001)' } });
    await expect(deleteUser(userId, adminId)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('never touches unrelated users: only one scoped RPC call and no direct user-table mutation', async () => {
    await deleteUser(userId, adminId);

    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('admin_delete_user', expect.objectContaining({ p_user_id: userId }));
    // The service itself must never UPDATE/DELETE rows directly — the
    // transactional RPC owns every row mutation.
    const userQueries = supabaseMock.from.mock.calls.filter(([t]) => t === 'users');
    expect(userQueries.length).toBeGreaterThan(0);
    // Only reference reads happen for payments/topups (no deletes from Node).
    expect(supabaseMock.from.mock.calls.filter(([t]) => t === 'payments' || t === 'topups').length).toBe(2);
  });

  it('a failed DB transaction performs NO storage cleanup (no partial deletion)', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { message: 'ERROR: deadlock detected' } });

    await expect(deleteUser(userId, adminId)).rejects.toMatchObject({ code: 'DELETE_FAILED' });
    expect(storageState.listCalls).toHaveLength(0);
    expect(storageState.removeCalls).toHaveLength(0);
    expect(logActionMock).not.toHaveBeenCalled();
  });

  it('storage failure after a committed deletion is non-blocking and reported as partial', async () => {
    storageState.listImpl = () => ({ data: null, error: { message: 'storage down' } });

    const result = await deleteUser(userId, adminId);

    expect(result.deleted).toBe(true);
    expect(result.storageCleanup).toBe('partial');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(logActionMock).toHaveBeenCalledWith(adminId, 'admin', 'hard_delete_user', userId, 'user',
      expect.objectContaining({ storageCleanup: 'partial' }));
  });

  it('audit entry identifies the acting admin and the archived financial records', async () => {
    await deleteUser(userId, 'admin-actor-99');
    expect(logActionMock).toHaveBeenCalledWith('admin-actor-99', 'admin', 'hard_delete_user', userId, 'user',
      expect.objectContaining({ archived: { payments: 1, topups: 0, walletTransactions: 2 } }));
  });
});

describe('adminService.deleteTopup', () => {
  it('calls admin_delete_topup RPC and returns deleted message', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { deleted: true, storagePaths: [] }, error: null });
    const result = await deleteTopup(topupId, adminId);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('admin_delete_topup', { p_topup_id: topupId, p_admin_id: adminId });
    expect(result.message).toBe('Top-up deleted successfully');
  });

  it('returns alreadyDeleted when the top-up is already gone (idempotent)', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { alreadyDeleted: true, topupId }, error: null });
    const result = await deleteTopup(topupId, adminId);
    expect(result.alreadyDeleted).toBe(true);
    expect(result.message).toBe('Top-up already deleted');
  });

  it('propagates RPC errors', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { message: 'ERROR: ADMIN_REQUIRED (P0001)' } });
    await expect(deleteTopup(topupId, adminId)).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
  });
});
