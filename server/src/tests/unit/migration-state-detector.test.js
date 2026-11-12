import { describe, expect, it } from 'vitest';
import { detectMigrationState, MIGRATION_PROBES, CORE_15 } from '../../scripts/migrationState.mjs';

// Fake pg client: routes SQL text to canned row results.
function fakeClient(map) {
  return {
    async query(sql, params) {
      for (const [needle, rows] of map) {
        if (sql.includes(needle)) return { rows };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 90)}`);
    },
  };
}

describe('migration state detection (guarded applier probes)', () => {
  it('covers every rollout migration 017-021', () => {
    expect(Object.keys(MIGRATION_PROBES).sort()).toEqual([
      '017_payment_verification_history.sql',
      '018_complete_user_deletion.sql',
      '019_enable_rls_core_tables.sql',
      '020_admin_delete_topup_retains_utrs.sql',
      '021_private_payments_bucket.sql',
    ]);
  });

  it('017: absent table -> apply; fully applied -> skip; table without RLS -> re-run (idempotent completion)', async () => {
    expect(await detectMigrationState(fakeClient([
      ["payment_verifications') IS NOT NULL", [{ ok: false }]],
    ]), '017_payment_verification_history.sql')).toEqual({ applied: false });

    expect(await detectMigrationState(fakeClient([
      ["payment_verifications') IS NOT NULL", [{ ok: true }]],
      ['relrowsecurity AS rls', [{ rls: true }]],
      ['FROM pg_indexes', [{ n: 2 }]],
    ]), '017_payment_verification_history.sql')).toEqual({ applied: true });

    const partial = await detectMigrationState(fakeClient([
      ["payment_verifications') IS NOT NULL", [{ ok: true }]],
      ['relrowsecurity AS rls', [{ rls: false }]],
    ]), '017_payment_verification_history.sql');
    expect(partial.applied).toBe(false);
  });

  it('018: 009-era function (no archive) -> apply; archive + no UTR delete -> skip', async () => {
    const oldFn = { rows: [{ def: 'DELETE FROM approved_utrs WHERE ... DELETE FROM users' }] };
    const newFn = { rows: [{ def: 'INSERT INTO deleted_user_financial_records ... UPDATE audit_logs SET actor_id = NULL' }] };

    expect(await detectMigrationState(fakeClient([
      ["deleted_user_financial_records') IS NOT NULL", [{ ok: false }]],
      ['pg_get_functiondef', oldFn.rows],
    ]), '018_complete_user_deletion.sql').then(r => r.applied)).toBe(false);

    expect(await detectMigrationState(fakeClient([
      ["deleted_user_financial_records') IS NOT NULL", [{ ok: true }]],
      ['pg_get_functiondef', newFn.rows],
    ]), '018_complete_user_deletion.sql')).toEqual({ applied: true });
  });

  it('019: 15/15 core RLS -> skip; partial set -> idempotent re-run; 0 -> apply', async () => {
    expect((await detectMigrationState(fakeClient([
      ['c.relrowsecurity AND c.relname IN', [{ n: CORE_15.length }]],
    ]), '019_enable_rls_core_tables.sql')).applied).toBe(true);

    const partial = await detectMigrationState(fakeClient([
      ['c.relrowsecurity AND c.relname IN', [{ n: 7 }]],
    ]), '019_enable_rls_core_tables.sql');
    expect(partial.applied).toBe(false);
    expect(partial.note).toMatch(/idempotent re-run/);

    expect((await detectMigrationState(fakeClient([
      ['c.relrowsecurity AND c.relname IN', [{ n: 0 }]],
    ]), '019_enable_rls_core_tables.sql')).applied).toBe(false);
  });

  it('020: 009 bug (DELETE FROM approved_utrs) -> apply; retained -> skip', async () => {
    expect((await detectMigrationState(fakeClient([
      ['pg_get_functiondef', [{ def: 'DELETE FROM approved_utrs WHERE reference_type = \'topup\' DELETE FROM topups' }]],
    ]), '020_admin_delete_topup_retains_utrs.sql')).applied).toBe(false);

    expect((await detectMigrationState(fakeClient([
      ['pg_get_functiondef', [{ def: 'DELETE FROM topups WHERE id = p_topup_id' }]],
    ]), '020_admin_delete_topup_retains_utrs.sql')).applied).toBe(true);
  });

  it('021: public bucket -> apply; private with zero read policies -> skip; missing bucket -> refuse', async () => {
    expect((await detectMigrationState(fakeClient([
      ['FROM storage.buckets WHERE id', [{ public: true }]],
    ]), '021_private_payments_bucket.sql')).applied).toBe(false);

    expect((await detectMigrationState(fakeClient([
      ['FROM storage.buckets WHERE id', [{ public: false }]],
      ['FROM pg_policies', [{ n: 0 }]],
    ]), '021_private_payments_bucket.sql')).applied).toBe(true);

    const missing = await detectMigrationState(fakeClient([
      ['FROM storage.buckets WHERE id', []],
    ]), '021_private_payments_bucket.sql');
    expect(missing.error).toMatch(/BUCKET_NOT_FOUND|not found/);
  });

  it('unknown migration files report unknown instead of guessing', async () => {
    const r = await detectMigrationState(fakeClient([]), '999_future_migration.sql');
    expect(r).toEqual({ applied: false, unknown: true });
  });
});
