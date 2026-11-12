import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../../../..', 'supabase', 'migrations');
const sql018 = readFileSync(resolve(migrationsDir, '018_complete_user_deletion.sql'), 'utf8');
const sql009 = readFileSync(resolve(migrationsDir, '009_admin_delete_operations.sql'), 'utf8');

// Statements inside the admin_delete_user function body only (skip the
// archive-table DDL that sits above the function).
const fnBody = sql018.slice(sql018.indexOf('CREATE OR REPLACE FUNCTION admin_delete_user'));

describe('018_complete_user_deletion — financial retention archive', () => {
  it('creates an anonymized archive table with RLS enabled and no policies', () => {
    expect(sql018).toContain('CREATE TABLE IF NOT EXISTS deleted_user_financial_records');
    expect(sql018).toContain('ALTER TABLE deleted_user_financial_records ENABLE ROW LEVEL SECURITY');
    // No CREATE POLICY anywhere for the archive: service-role only.
    expect(sql018).not.toMatch(/CREATE POLICY.*deleted_user_financial_records/is);
    // The archive DDL itself must not carry PII columns.
    const archiveDdl = sql018.slice(
      sql018.indexOf('CREATE TABLE IF NOT EXISTS deleted_user_financial_records'),
      sql018.indexOf('ALTER TABLE deleted_user_financial_records'),
    );
    expect(archiveDdl).not.toMatch(/full_name|email|mobile|password|screenshot/i);
  });

  it('archives payments, top-ups and wallet ledger rows before deleting them', () => {
    expect(fnBody).toMatch(/INSERT INTO deleted_user_financial_records[\s\S]*'payment'/);
    expect(fnBody).toMatch(/INSERT INTO deleted_user_financial_records[\s\S]*'topup'/);
    expect(fnBody).toMatch(/INSERT INTO deleted_user_financial_records[\s\S]*'wallet_transaction'/);
    // Archive must happen before the corresponding DELETE.
    expect(fnBody.indexOf('INSERT INTO deleted_user_financial_records')).toBeLessThan(fnBody.indexOf('DELETE FROM payments'));
    expect(fnBody.indexOf('INSERT INTO deleted_user_financial_records')).toBeLessThan(fnBody.indexOf('DELETE FROM topups'));
    expect(fnBody.indexOf('INSERT INTO deleted_user_financial_records')).toBeLessThan(fnBody.indexOf('DELETE FROM wallet_transactions'));
  });

  it('RETAINS the approved-UTR fraud ledger and the payment verification audit history', () => {
    // Deleting consumed UTRs would let one bank transaction be approved twice.
    expect(fnBody).not.toMatch(/DELETE FROM approved_utrs/);
    // Verification history is append-only financial audit data.
    expect(fnBody).not.toMatch(/DELETE FROM payment_verifications/);
  });
});

describe('018_complete_user_deletion — safety guards', () => {
  it('enforces admin RBAC, admin-target and self-deletion guards inside the transaction', () => {
    expect(fnBody).toContain("RAISE EXCEPTION 'ADMIN_REQUIRED'");
    expect(fnBody).toContain("RAISE EXCEPTION 'CANNOT_DELETE_ADMIN'");
    expect(fnBody).toContain("RAISE EXCEPTION 'CANNOT_DELETE_SELF'");
    expect(fnBody).toContain('IF p_user_id = p_admin_id THEN');
    expect(fnBody).toContain("IF v_user.role = 'admin' THEN");
  });

  it('clears payment_config.updated_by so the users FK can never block deletion', () => {
    expect(fnBody).toContain('UPDATE payment_config SET updated_by = NULL WHERE updated_by = p_user_id');
  });

  it('scopes every DELETE/UPDATE to the target user (unrelated users are never touched)', () => {
    const statements = fnBody
      .replace(/--[^\n]*/g, '') // strip SQL comments before splitting
      .split(';')
      .map(s => s.trim())
      .filter(s => /^(DELETE FROM|UPDATE )/i.test(s));
    // 12 DELETEs (user-owned tables + users) + 3 UPDATEs (payment_config,
    // suspicious_activity.resolved_by, users.referred_by).
    expect(statements.length).toBe(15);
    for (const stmt of statements) {
      expect(stmt, `statement not scoped to p_user_id: ${stmt}`).toContain('p_user_id');
    }
  });

  it('preserves other users referral links (only the pointer to the deleted user is cleared)', () => {
    expect(fnBody).toContain('UPDATE users SET referred_by = NULL WHERE referred_by = p_user_id');
    expect(fnBody).toMatch(/UPDATE suspicious_activity SET resolved_by = NULL WHERE resolved_by = p_user_id/);
  });

  it('writes the hard_delete_user audit entry inside the same transaction', () => {
    expect(fnBody).toMatch(/INSERT INTO audit_logs[\s\S]*'hard_delete_user'/);
    expect(fnBody).toContain("'retainedApprovedUtrs', true");
  });

  it('is a single SECURITY DEFINER transaction that returns storage paths', () => {
    expect(fnBody).toContain('SECURITY DEFINER');
    expect(fnBody).toContain("'storagePaths'");
    // Atomic: one function body = commit-all or rollback-all.
    expect(fnBody).toContain('RETURNS JSONB');
  });

  it('is restricted to the service role (never reachable from anon/authenticated)', () => {
    expect(sql018).toContain('REVOKE EXECUTE ON FUNCTION public.admin_delete_user(UUID, UUID)');
    expect(sql018).toMatch(/GRANT EXECUTE ON FUNCTION public\.admin_delete_user\(UUID, UUID\)\s*TO service_role/);
  });

  it('deletes the users row itself (account removal is complete)', () => {
    expect(fnBody).toContain('DELETE FROM users WHERE id = p_user_id');
    // Every user-owned table from the schema inventory is handled — except
    // audit_logs, which is PRESERVED (actor pointer detached, rows kept).
    for (const table of ['messages', 'conversations', 'notifications', 'wallet_transactions',
      'ip_logs', 'suspicious_activity', 'plan_change_requests', 'referrals',
      'topups', 'payments']) {
      expect(fnBody, `missing deletion of ${table}`).toContain(`DELETE FROM ${table}`);
    }
    expect(fnBody).not.toContain('DELETE FROM audit_logs');
  });

  it('PRESERVES audit history: detaches the actor pointer instead of deleting rows', () => {
    expect(fnBody).toContain('UPDATE audit_logs SET actor_id = NULL WHERE actor_id = p_user_id');
    expect(fnBody).toContain("'auditLogsPreserved', v_audit_preserved");
    // Never frees consumed UTRs on user deletion (duplicate-credit guard).
    expect(fnBody).not.toContain('DELETE FROM approved_utrs');
  });
});

describe('regression: legacy migration still provides admin_delete_topup', () => {
  it('009 admin_delete_topup is unchanged and still present', () => {
    expect(sql009).toContain('CREATE OR REPLACE FUNCTION admin_delete_topup');
    expect(sql009).toContain('wallet_transactions rows that');
  });
});
