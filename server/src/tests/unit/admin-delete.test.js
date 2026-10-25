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
    neq: vi.fn(() => obj),
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

describe('adminService.deleteUser (soft delete only for admin action)', () => {
  it('soft deletes when explicitly requested via softDelete=true', async () => {
    await deleteUser(userId, true, adminId);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(supabaseMock.from).toHaveBeenCalledWith('users');
    expect(logActionMock).toHaveBeenCalledWith(adminId, 'admin', 'soft_delete_user', userId, 'user', {});
  });

  it('defaults to soft delete when softDelete is not set (UI safety)', async () => {
    await deleteUser(userId, undefined, adminId);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(supabaseMock.from).toHaveBeenCalledWith('users');
    expect(logActionMock).toHaveBeenCalledWith(adminId, 'admin', 'soft_delete_user', userId, 'user', {});
  });

  it('soft deletes when explicitly false but preserves safety for admin UI (service enforces soft-only)', async () => {
    await deleteUser(userId, false, adminId);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(logActionMock).toHaveBeenCalledWith(adminId, 'admin', 'soft_delete_user', userId, 'user', {});
  });

  it('returns USER_NOT_FOUND for missing user', async () => {
    supabaseMock.from.mockImplementation((table) => makeChain(table === 'users'
      ? { data: null, error: { message: 'not found' } }
      : { data: null, error: null }));
    await expect(deleteUser('ghost', true, adminId)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('blocks deleting an admin', async () => {
    supabaseMock.from.mockImplementation((table) => makeChain(table === 'users'
      ? { data: { id: adminId, role: 'admin' }, error: null }
      : { data: null, error: null }));
    await expect(deleteUser(adminId, true, adminId)).rejects.toMatchObject({ code: 'CANNOT_DELETE_ADMIN' });
  });

  it('audit entry identifies the admin actor', async () => {
    await deleteUser(userId, true, 'admin-actor-99');
    expect(logActionMock).toHaveBeenCalledWith('admin-actor-99', 'admin', 'soft_delete_user', userId, 'user', {});
  });

  it('repeated requests do not call RPC and remain idempotent (update-based)', async () => {
    await deleteUser(userId, true, adminId);
    await deleteUser(userId, true, adminId);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(logActionMock).toHaveBeenCalledTimes(2);
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
