import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as configService from '../../services/configService.js';

// ─────────────────────────────────────────────────────────────
// ADMIN CONFIG SERVICE TESTS
//
// Tests the config service's caching, public config, and
// validation logic. Uses mocked Supabase to avoid DB dependency.
// ─────────────────────────────────────────────────────────────

vi.mock('../../db/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    })),
  },
}));

vi.mock('../../services/auditService.js', () => ({
  logAction: vi.fn().mockResolvedValue({}),
}));

describe('Config Service — getPublicConfig()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns receiver_upi, payment_window_minutes, and plans', async () => {
    const { supabase } = await import('../../db/supabase.js');
    supabase.from.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [
          { key: 'receiver_upi', value: 'test@upi' },
          { key: 'payment_window_minutes', value: 30 },
          { key: 'plans', value: { '120': 120, '500': 500, '1000': 1000 } },
        ],
        error: null,
      }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    });

    const config = await configService.getPublicConfig();
    expect(config).toHaveProperty('receiver_upi');
    expect(config).toHaveProperty('payment_window_minutes');
    expect(config).toHaveProperty('plans');
    expect(config.plans).toHaveProperty('120');
    expect(config.plans).toHaveProperty('500');
    expect(config.plans).toHaveProperty('1000');
  });
});

describe('Config Service — getPaymentConfig() caching', () => {
  it('returns config with expected structure', async () => {
    const config = await configService.getPaymentConfig();
    expect(config).toHaveProperty('receiver_upi');
    expect(config).toHaveProperty('payment_window_minutes');
    expect(config).toHaveProperty('plans');
  });
});

describe('Config Service — updatePaymentConfig()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid config keys', async () => {
    try {
      await configService.updatePaymentConfig({ invalid_key: 'value' }, 'admin-id');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err.code).toBe('INVALID_CONFIG_KEY');
    }
  });

  it('allows updating receiver_upi', async () => {
    const { supabase } = await import('../../db/supabase.js');
    supabase.from.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [{ key: 'receiver_upi', value: 'new@upi' }],
        error: null,
      }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    });

    const config = await configService.updatePaymentConfig(
      { receiver_upi: 'new@upi' },
      'admin-id'
    );
    expect(config.receiver_upi).toBe('new@upi');
  });

  it('allows updating payment_window_minutes', async () => {
    const { supabase } = await import('../../db/supabase.js');
    supabase.from.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [{ key: 'payment_window_minutes', value: 45 }],
        error: null,
      }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    });

    const config = await configService.updatePaymentConfig(
      { payment_window_minutes: 45 },
      'admin-id'
    );
    expect(config.payment_window_minutes).toBe(45);
  });
});
