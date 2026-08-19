import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteUser, deleteTopup } from '../../services/adminService.js';

const { supabaseMock, logActionMock } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn(), rpc: vi.fn(), storage: { from: vi.fn(() => ({ remove: vi.fn() })) } },
  logActionMock: vi.fn(),
}));

vi.mock('../../db/supabase.js', () => ({ supabase: supabaseMock }));
vi.mock('../../services/auditService.js', () => ({ logAction: logActionMock }));

const adminId = 'admin-1';
const userId = 'user-1';
const topupId = 'topup-1';

function makeChain(selectResult) {
  const obj = {
    select: vi.fn(() => obj),
    eq: vi.fn(() => obj),
    single: vi.fn(() => Promise.resolve(selectResult || { data: null, error: null })),
    update: vi.fn(() => obj),
    delete: vi.fn(() => obj),
  };
  return obj;
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMock.storage.from.mockImplementation(() => ({ remove: vi.fn() }));
  supabaseMock.from.mockImplementation((table) => makeChain(table === 'users'
    ? { data: { id: userId, role: 'user' }, error: null }
    : { data: null, error: null }));
});

describe('adminService.deleteUser (hard delete)', () => {
  it('calls admin_delete_user RPC with the admin as actor', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { deleted: true, storagePaths: [] }, error: null });

    const result = await deleteUser(userId, false, adminId);

    expect(supabaseMock.rpc).toHaveBeenCalledWith('admin_delete_user', { p_user_id: userId, p_admin_id: adminId });
    expect(result.message).toBe('User permanently deleted');
  });

  it('defaults to a hard (complete) delete when softDelete is not set', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { deleted: true, storagePaths: [] }, error: null });

    await deleteUser(userId, undefined, adminId);

    expect(supabaseMock.rpc).toHaveBeenCalledWith('admin_delete_user', { p_user_id: userId, p_admin_id: adminId });
    expect(logActionMock).not.toHaveBeenCalledWith(expect.anything(), 'admin', 'soft_delete_user');
  });

  it('soft deletes when explicitly requested', async () => {
    await deleteUser(userId, true, adminId);

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(supabaseMock.from).toHaveBeenCalledWith('users');
    expect(logActionMock).toHaveBeenCalledWith(adminId, 'admin', 'soft_delete_user', userId, 'user', {});
  });

  it('returns USER_NOT_FOUND for missing user', async () => {
    supabaseMock.from.mockImplementation((table) => makeChain(table === 'users'
      ? { data: null, error: { message: 'not found' } }
      : { data: null, error: null }));

    await expect(deleteUser('ghost', false, adminId)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('blocks deleting an admin', async () => {
    supabaseMock.from.mockImplementation((table) => makeChain(table === 'users'
      ? { data: { id: adminId, role: 'admin' }, error: null }
      : { data: null, error: null }));

    await expect(deleteUser(adminId, false, adminId)).rejects.toMatchObject({ code: 'CANNOT_DELETE_ADMIN' });
  });

  it('maps RPC errors to codes', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { message: 'ERROR: ADMIN_REQUIRED (P0001)' } });

    await expect(deleteUser(userId, false, adminId)).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
  });

  it('removes storage objects returned by the RPC (best-effort)', async () => {
    const remove = vi.fn();
    supabaseMock.storage.from.mockImplementation(() => ({ remove }));
    supabaseMock.rpc.mockResolvedValue({ data: { deleted: true, storagePaths: ['payments/x/y.png'] }, error: null });

    await deleteUser(userId, false, adminId);

    expect(supabaseMock.storage.from).toHaveBeenCalledWith('payments');
    expect(remove).toHaveBeenCalledWith(['payments/x/y.png']);
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