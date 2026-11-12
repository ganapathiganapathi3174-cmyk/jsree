import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────
// Receiver identity: ONE validated configuration source.
// resolveReceiverIdentity() is the single resolver used by both
// payment flows: DB payment_config wins, env is the fallback layer,
// and nameConfigured=false must surface as an explicit disclosure
// (never as a silent pass) — see decisionEngine gate 7.
// ─────────────────────────────────────────────────────────────

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));
vi.mock('../../db/supabase.js', () => ({ supabase: supabaseMock, supabaseAnon: {} }));
vi.mock('../../services/auditService.js', () => ({ logAction: vi.fn() }));

import { resolveReceiverIdentity, getPaymentConfig, resetPaymentConfigCache } from '../../services/configService.js';

function configRows(rows) {
  const q = {};
  q.select = vi.fn(() => q);
  q.single = vi.fn().mockResolvedValue({ data: null, error: null });
  q.then = undefined;
  supabaseMock.from.mockReturnValue({
    select: vi.fn().mockResolvedValue({ data: rows, error: null }),
  });
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPaymentConfigCache();
  delete process.env.ADMIN_RECEIVER_NAME;
  process.env.ADMIN_UPI_ID = 'env-upi@okicici';
});

describe('resolveReceiverIdentity — single validated source', () => {
  it('DB receiver_name wins over env; DB empty falls back to env layer', async () => {
    configRows([
      { key: 'receiver_name', value: 'DB Configured Name' },
      { key: 'receiver_upi', value: 'db-upi@okicici' },
    ]);
    let id = await resolveReceiverIdentity();
    expect(id.receiverName).toBe('DB Configured Name');
    expect(id.receiverUpi).toBe('db-upi@okicici');
    expect(id.nameConfigured).toBe(true);

    resetPaymentConfigCache();
    configRows([
      { key: 'receiver_name', value: '' },
      { key: 'receiver_upi', value: 'db-upi@okicici' },
    ]);
    id = await resolveReceiverIdentity();
    expect(id.receiverName).toBe('');
    expect(id.nameConfigured).toBe(false);

    process.env.ADMIN_RECEIVER_NAME = 'Env Fallback Name';
    resetPaymentConfigCache();
    id = await resolveReceiverIdentity();
    expect(id.receiverName).toBe('Env Fallback Name');
    expect(id.nameConfigured).toBe(true);
    delete process.env.ADMIN_RECEIVER_NAME;
  });

  it('trims whitespace and caps length; sub-2-char names count as unconfigured', async () => {
    configRows([
      { key: 'receiver_name', value: '  Padded Name  ' },
      { key: 'receiver_upi', value: ' upi@ok ' },
    ]);
    let id = await resolveReceiverIdentity();
    expect(id.receiverName).toBe('Padded Name');
    expect(id.receiverUpi).toBe('upi@ok');

    resetPaymentConfigCache();
    configRows([{ key: 'receiver_name', value: 'X' }, { key: 'receiver_upi', value: 'u@ok' }]);
    id = await resolveReceiverIdentity();
    expect(id.nameConfigured).toBe(false);
  });

  it('payment_config cache serves both callers identically (same source)', async () => {
    configRows([{ key: 'receiver_name', value: 'Cached Name' }, { key: 'receiver_upi', value: 'c@ok' }]);
    const a = await getPaymentConfig();
    const b = await resolveReceiverIdentity();
    expect(b.receiverName).toBe(a.receiver_name);
    expect(b.receiverUpi).toBe(a.receiver_upi);
  });
});
