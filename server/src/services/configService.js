import { supabase } from '../db/supabase.js';
import { logAction } from './auditService.js';

// ─────────────────────────────────────────────────────────────
// Payment configuration management.
//
// Stores admin-configurable settings in the `payment_config` table.
// All writes are admin-only and audit-logged. The frontend can read
// public config (UPI ID, plans) via a public endpoint.
// ─────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  receiver_upi: process.env.ADMIN_UPI_ID || 'jayarajj126-3@okicici',
  payment_window_minutes: 30,
  min_ocr_confidence: 55,
  plans: { '120': 120, '500': 500, '1000': 1000 },
};

let cachedConfig = null;
let cacheTimestamp = 0;
const CONFIG_CACHE_TTL = 60 * 1000; // 1 minute

async function fetchConfigFromDb() {
  const { data, error } = await supabase.from('payment_config').select('key, value');
  if (error || !data) return null;
  const config = {};
  for (const row of data) {
    config[row.key] = row.value;
  }
  return config;
}

export async function getPaymentConfig() {
  const now = Date.now();
  if (cachedConfig && (now - cacheTimestamp) < CONFIG_CACHE_TTL) {
    return cachedConfig;
  }
  const dbConfig = await fetchConfigFromDb();
  if (dbConfig) {
    cachedConfig = {
      receiver_upi: dbConfig.receiver_upi || DEFAULT_CONFIG.receiver_upi,
      payment_window_minutes: Number(dbConfig.payment_window_minutes) || DEFAULT_CONFIG.payment_window_minutes,
      min_ocr_confidence: Number(dbConfig.min_ocr_confidence) || DEFAULT_CONFIG.min_ocr_confidence,
      plans: dbConfig.plans || DEFAULT_CONFIG.plans,
    };
  } else {
    cachedConfig = { ...DEFAULT_CONFIG };
  }
  cacheTimestamp = now;
  return cachedConfig;
}

// Public config (safe for frontend consumption — no secrets).
export async function getPublicConfig() {
  const config = await getPaymentConfig();
  return {
    receiver_upi: config.receiver_upi,
    payment_window_minutes: config.payment_window_minutes,
    plans: config.plans,
  };
}

function validateConfigValue(key, value) {
  if (key === 'payment_window_minutes') {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 5 || n > 180) {
      throw { message: 'payment_window_minutes must be an integer between 5 and 180', code: 'INVALID_CONFIG_VALUE' };
    }
  }
  if (key === 'min_ocr_confidence') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw { message: 'min_ocr_confidence must be a number between 0 and 100', code: 'INVALID_CONFIG_VALUE' };
    }
  }
  if (key === 'receiver_upi') {
    if (typeof value !== 'string' || value.length === 0 || value.length > 255 || !value.includes('@')) {
      throw { message: 'receiver_upi must be a valid UPI ID string', code: 'INVALID_CONFIG_VALUE' };
    }
  }
  if (key === 'plans') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) {
      throw { message: 'plans must be a non-empty object mapping plan to amount', code: 'INVALID_CONFIG_VALUE' };
    }
    for (const [plan, amount] of Object.entries(value)) {
      if (!Number.isFinite(Number(plan)) || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
        throw { message: `Invalid plan entry: ${plan}`, code: 'INVALID_CONFIG_VALUE' };
      }
    }
  }
}

export async function updatePaymentConfig(updates, adminId) {
  const ALLOWED_KEYS = ['receiver_upi', 'payment_window_minutes', 'min_ocr_confidence', 'plans'];

  for (const [key, value] of Object.entries(updates)) {
    if (!ALLOWED_KEYS.includes(key)) {
      throw { message: `Invalid config key: ${key}`, code: 'INVALID_CONFIG_KEY' };
    }
    validateConfigValue(key, value);

    const { error } = await supabase
      .from('payment_config')
      .upsert({ key, value: value, updated_by: adminId, updated_at: new Date().toISOString() }, { onConflict: 'key' });

    if (error) throw { message: `Failed to update config: ${key}`, code: 'CONFIG_UPDATE_FAILED' };
  }

  // Invalidate cache so next read picks up changes.
  cachedConfig = null;
  cacheTimestamp = 0;

  await logAction(adminId, 'admin', 'update_payment_config', null, 'config', { updates: Object.keys(updates) });

  return await getPaymentConfig();
}
