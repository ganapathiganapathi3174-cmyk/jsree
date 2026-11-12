import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────
// Status-transition race guards (exactly-once).
//
// rejectPayment and plan-change approve/reject previously performed an
// UNGUARDED update after a check-then-act fetch: a concurrent approval
// could be overwritten by a late reject, and a request could be marked
// rejected after its plan had already been applied. These regressions
// pin the guarded-transition contract (mirrors the verification engine
// in paymentService.verifyPayment and topupService.verifyTopup):
//   * the UPDATE carries a status guard
//   * a lost race never overwrites a foreign terminal state
//   * a lost race to the SAME terminal state is an idempotent success
//     with no duplicate notification/audit side effects
// ─────────────────────────────────────────────────────────────

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));
vi.mock('../../db/supabase.js', () => ({
  supabase: supabaseMock,
  supabaseAnon: {},
  default: supabaseMock,
}));
vi.mock('../../services/auditService.js', () => ({ logAction: vi.fn() }));
vi.mock('../../services/notificationService.js', () => ({
  default: { createNotification: vi.fn() },
}));

import * as paymentService from '../../services/paymentService.js';
import * as planService from '../../services/planService.js';
import { logAction } from '../../services/auditService.js';
import notificationService from '../../services/notificationService.js';

const ACTABLE = ['pending', 'manual_review'];

function fetchChain(row) {
  const chain = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve({ data: row, error: null }));
  return chain;
}

function guardedUpdateChain(rows) {
  const chain = {};
  chain.update = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.select = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  return chain;
}

function scriptPayments({ fetchRow, updateRows, refetchRow }) {
  const fetch = fetchChain(fetchRow);
  const update = guardedUpdateChain(updateRows);
  const refetch = fetchChain(refetchRow);
  const chains = [fetch, update, refetch];
  supabaseMock.from.mockImplementation((table) => {
    if (table !== 'payments') throw new Error(`unexpected table: ${table}`);
    const next = chains.shift();
    if (!next) throw new Error('unexpected extra payments query');
    return next;
  });
  return { fetch, update, refetch };
}

function scriptPlanRequests({ fetchRow, updateRows }) {
  const fetch = fetchChain(fetchRow);
  const update = guardedUpdateChain(updateRows);
  const chains = [fetch, update];
  const usersUpdate = { update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })) };
  supabaseMock.from.mockImplementation((table) => {
    if (table === 'plan_change_requests') {
      const next = chains.shift();
      if (!next) throw new Error('unexpected extra plan_change_requests query');
      return next;
    }
    if (table === 'users') return usersUpdate;
    throw new Error(`unexpected table: ${table}`);
  });
  return { fetch, update, usersUpdate };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('rejectPayment — guarded transition (race vs concurrent approval)', () => {
  const pendingPayment = { id: 'pay-1', status: 'pending', user_id: 'u1', expected_amount: 120 };

  it('never overwrites a concurrently approved payment (RACE_CONDITION, no side effects)', async () => {
    const { update, refetch } = scriptPayments({
      fetchRow: pendingPayment,
      updateRows: [],           // lost the race: 0 rows matched the status guard
      refetchRow: { id: 'pay-1', status: 'approved' },
    });

    await expect(paymentService.rejectPayment('pay-1', 'admin-1', 'dup'))
      .rejects.toMatchObject({ code: 'RACE_CONDITION' });

    expect(update.in).toHaveBeenCalledWith('status', ACTABLE);
    expect(refetch.single).toHaveBeenCalled();
    expect(notificationService.createNotification).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it('is an idempotent success when a concurrent reject already won (no duplicate notification)', async () => {
    scriptPayments({
      fetchRow: pendingPayment,
      updateRows: [],
      refetchRow: { id: 'pay-1', status: 'rejected' },
    });

    await expect(paymentService.rejectPayment('pay-1', 'admin-1', 'dup'))
      .resolves.toMatchObject({ paymentId: 'pay-1', message: 'Payment rejected' });

    expect(notificationService.createNotification).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it('rejects normally through the status guard and runs side effects exactly once', async () => {
    const { update } = scriptPayments({
      fetchRow: pendingPayment,
      updateRows: [{ id: 'pay-1' }],
      refetchRow: null,
    });

    const result = await paymentService.rejectPayment('pay-1', 'admin-1', 'bad proof');

    expect(result).toMatchObject({ paymentId: 'pay-1' });
    expect(update.in).toHaveBeenCalledWith('status', ACTABLE);
    expect(update.eq).toHaveBeenCalledWith('id', 'pay-1');
    expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
    expect(logAction).toHaveBeenCalledTimes(1);
  });
});

describe('plan change approve/reject — guarded transition (exactly-once)', () => {
  const pendingRequest = {
    id: 'req-1', status: 'pending', user_id: 'u1',
    current_plan: 120, requested_plan: 500,
  };

  it('approve loses the race to a concurrent reject → NOT_PENDING, user plan untouched', async () => {
    const { update, usersUpdate } = scriptPlanRequests({
      fetchRow: pendingRequest,
      updateRows: [],
    });

    await expect(planService.approvePlanChange('req-1', 'admin-1'))
      .rejects.toMatchObject({ code: 'NOT_PENDING' });

    expect(update.eq).toHaveBeenCalledWith('status', 'pending');
    expect(usersUpdate.update).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it('approve applies the user plan only after the guarded status flip succeeds', async () => {
    const { update, usersUpdate } = scriptPlanRequests({
      fetchRow: pendingRequest,
      updateRows: [{ id: 'req-1' }],
    });

    await expect(planService.approvePlanChange('req-1', 'admin-1'))
      .resolves.toMatchObject({ requestId: 'req-1' });

    expect(update.eq).toHaveBeenCalledWith('status', 'pending');
    expect(usersUpdate.update).toHaveBeenCalledWith({ current_plan: 500 });
    expect(logAction).toHaveBeenCalledTimes(1);
  });

  it('reject loses the race to a concurrent approve → NOT_PENDING, no audit entry', async () => {
    const { update, usersUpdate } = scriptPlanRequests({
      fetchRow: pendingRequest,
      updateRows: [],
    });

    await expect(planService.rejectPlanChange('req-1', 'admin-1', 'no'))
      .rejects.toMatchObject({ code: 'NOT_PENDING' });

    expect(update.eq).toHaveBeenCalledWith('status', 'pending');
    expect(usersUpdate.update).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it('reject succeeds through the status guard and records the audit entry once', async () => {
    const { update } = scriptPlanRequests({
      fetchRow: pendingRequest,
      updateRows: [{ id: 'req-1' }],
    });

    await expect(planService.rejectPlanChange('req-1', 'admin-1', 'not allowed'))
      .resolves.toMatchObject({ requestId: 'req-1' });

    expect(update.eq).toHaveBeenCalledWith('status', 'pending');
    expect(logAction).toHaveBeenCalledTimes(1);
  });
});
