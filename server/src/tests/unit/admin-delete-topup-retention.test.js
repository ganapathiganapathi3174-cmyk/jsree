import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../../../..', 'supabase', 'migrations');
const sql020 = readFileSync(resolve(migrationsDir, '020_admin_delete_topup_retains_utrs.sql'), 'utf8');
const sql018 = readFileSync(resolve(migrationsDir, '018_complete_user_deletion.sql'), 'utf8');

const fnBody = sql020.slice(sql020.indexOf('CREATE OR REPLACE FUNCTION admin_delete_topup'));

// ─────────────────────────────────────────────────────────────
// Regression: admin_delete_topup must RETAIN the consumed-UTR ledger.
//
// 009 deleted approved_utrs together with the top-up, which freed the
// bank transaction reference back into the pool — the same UTR could
// then be reserved and credited a second time (duplicate wallet
// credit). 018 already established the retention invariant for user
// deletion; 020 applies it to top-up deletion.
// ─────────────────────────────────────────────────────────────

describe('020_admin_delete_topup_retains_utrs — UTR retention fix', () => {
  it('redefines admin_delete_topup without deleting approved_utrs', () => {
    expect(sql020).toContain('CREATE OR REPLACE FUNCTION admin_delete_topup');
    expect(fnBody).not.toContain('DELETE FROM approved_utrs');
  });

  it('still deletes the top-up row itself', () => {
    expect(fnBody).toContain('DELETE FROM topups WHERE id = p_topup_id');
  });

  it('keeps the wallet-safety contract: no wallet tables are touched', () => {
    expect(fnBody).not.toMatch(/DELETE FROM wallet_transactions/i);
    expect(fnBody).not.toMatch(/wallet_balance/i);
  });

  it('keeps idempotent alreadyDeleted behavior and admin RBAC', () => {
    expect(fnBody).toContain("alreadyDeleted', true");
    expect(fnBody).toContain("role = 'admin'");
    expect(fnBody).toContain('ADMIN_REQUIRED');
  });

  it('keeps storage path collection and the audit trail', () => {
    expect(fnBody).toContain('storagePaths');
    expect(fnBody).toContain("INSERT INTO audit_logs");
    expect(fnBody).toContain("'delete_topup'");
  });

  it('uses the same FOR UPDATE row lock as 009 (concurrent-safe delete)', () => {
    expect(fnBody).toContain('FOR UPDATE');
  });

  it('is consistent with the 018 user-deletion retention invariant', () => {
    const userFn = sql018.slice(sql018.indexOf('CREATE OR REPLACE FUNCTION admin_delete_user'));
    expect(userFn).not.toContain('DELETE FROM approved_utrs');
    expect(fnBody).not.toContain('DELETE FROM approved_utrs');
  });
});
