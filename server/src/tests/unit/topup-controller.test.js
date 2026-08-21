import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as topupController from '../../controllers/topupController.js';

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));
vi.mock('../../db/supabase.js', () => ({ supabase: supabaseMock }));

const service = vi.hoisted(() => ({
  getTopupsForUser: vi.fn(),
  computeTopupSummary: vi.fn(),
  createDirectTopup: vi.fn(),
  claimTopupForReceiver: vi.fn(),
}));
vi.mock('../../services/topupService.js', () => service);

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMock.from.mockRestore ? null : null;
});

function mockUsersChain(results) {
  const obj = { select: vi.fn(() => obj), eq: vi.fn(() => obj), single: vi.fn() };
  (results || []).forEach(r => obj.single.mockResolvedValueOnce(r));
  return obj;
}

describe('topupController.directTopup', () => {
  it('201 (created) passes through the direct result', async () => {
    service.createDirectTopup.mockResolvedValue({ topupId: 't1', created: true, credited: false, message: 'Top-up created' });
    const req = { user: { id: 'u1' }, body: { amount: '120' }, file: null };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await topupController.directTopup(req, res);

    expect(service.createDirectTopup).toHaveBeenCalledWith({ senderId: 'u1', amount: 120, receiverId: null, file: null });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'Top-up created' }));
  });

  it('200 (processed) when reusing/crediting an existing record', async () => {
    service.createDirectTopup.mockResolvedValue({ topupId: 't1', created: false, credited: true, message: 'Topup approved and amount credited to your balance' });
    const req = { user: { id: 'u1' }, body: { amount: '120', receiverId: 'sp-9' }, file: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await topupController.directTopup(req, res);

    expect(service.createDirectTopup).toHaveBeenCalledWith({ senderId: 'u1', amount: 120, receiverId: 'sp-9', file: {} });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('maps NO_SPONSOR to 400', async () => {
    service.createDirectTopup.mockRejectedValue({ message: 'No sponsor found to top-up', code: 'NO_SPONSOR' });
    const req = { user: { id: 'u1' }, body: { amount: '120' }, file: null };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await topupController.directTopup(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, code: 'NO_SPONSOR' }));
  });

  it('maps RECEIVER_NOT_FOUND to 404', async () => {
    service.createDirectTopup.mockRejectedValue({ message: 'Receiver not found', code: 'RECEIVER_NOT_FOUND' });
    const req = { user: { id: 'u1' }, body: { amount: '120' }, file: null };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await topupController.directTopup(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('topupController.getTopups (summary)', () => {
  it('computes summary, resolves sponsor, and returns it', async () => {
    const received = [{ id: 't1', status: 'completed', receiver_id: 'u1' }];
    service.getTopupsForUser.mockResolvedValue({ sent: [{ id: 't9' }], received });
    service.computeTopupSummary.mockResolvedValue({ receivedCompletedCount: 1, receivedRequired: 2, remaining: 1, mustTopup: false, canClaim: true, receivedPendingCount: 0, receivedClaimableCount: 0 });

    const usersChain = mockUsersChain([
      { data: { referred_by: 'sp-1' }, error: null },
      { data: { full_name: 'Sponsor Name' }, error: null },
    ]);
    supabaseMock.from.mockImplementation((table) => (table === 'users' ? usersChain : { single: vi.fn().mockResolvedValue({ data: null, error: null }) }));

    const req = { user: { id: 'u1' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await topupController.getTopups(req, res);

    expect(service.getTopupsForUser).toHaveBeenCalledWith('u1');
    expect(service.computeTopupSummary).toHaveBeenCalledWith(received, 'u1');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      summary: expect.objectContaining({ mustTopup: false, sponsorId: 'sp-1', sponsorName: 'Sponsor Name' }),
    }));
  });

  it('returns null sponsor data when the user has no sponsor', async () => {
    const received = [];
    service.getTopupsForUser.mockResolvedValue({ sent: [], received });
    service.computeTopupSummary.mockResolvedValue({ receivedCompletedCount: 0, receivedRequired: 2, remaining: 2, mustTopup: false, canClaim: false, receivedPendingCount: 0, receivedClaimableCount: 0 });

    const usersChain = mockUsersChain([
      { data: { referred_by: null }, error: null },
    ]);
    supabaseMock.from.mockImplementation((table) => (table === 'users' ? usersChain : { single: vi.fn().mockResolvedValue({ data: null, error: null }) }));

    const req = { user: { id: 'u1' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await topupController.getTopups(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.objectContaining({ sponsorId: null, sponsorName: null }),
    }));
  });
});

describe('topupController.claimTopup', () => {
  it('claims a pending top-up successfully', async () => {
    service.claimTopupForReceiver.mockResolvedValue({ message: 'Topup claimed and credited', credited: true, alreadyClaimed: false });

    const req = { user: { id: 'u1' }, body: { topupId: 't1' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await topupController.claimTopup(req, res);

    expect(service.claimTopupForReceiver).toHaveBeenCalledWith('t1', 'u1');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ topupId: 't1', credited: true, alreadyClaimed: false }),
    }));
  });

  it('returns 400 when topupId missing', async () => {
    const req = { user: { id: 'u1' }, body: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await topupController.claimTopup(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, code: 'VALIDATION_ERROR' }));
  });

  it('maps OWN_TOPUP_REQUIRED to 400', async () => {
    service.claimTopupForReceiver.mockRejectedValue({ message: 'Complete your required top-up to claim this payment', code: 'OWN_TOPUP_REQUIRED' });

    const req = { user: { id: 'u1' }, body: { topupId: 't1' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await topupController.claimTopup(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'OWN_TOPUP_REQUIRED' }));
  });

  it('maps TOPUP_NOT_FOUND to 404', async () => {
    service.claimTopupForReceiver.mockRejectedValue({ message: 'Topup not found', code: 'TOPUP_NOT_FOUND' });

    const req = { user: { id: 'u1' }, body: { topupId: 't1' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await topupController.claimTopup(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('maps UNAUTHORIZED to 403', async () => {
    service.claimTopupForReceiver.mockRejectedValue({ message: 'Unauthorized', code: 'UNAUTHORIZED' });

    const req = { user: { id: 'u1' }, body: { topupId: 't1' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await topupController.claimTopup(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});