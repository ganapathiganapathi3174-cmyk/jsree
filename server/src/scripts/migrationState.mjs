// Per-migration applied-state detection for the guarded migration applier.
//
// Each probe returns a structured answer derived from LIVE catalog state —
// never from filenames or operator memory:
//
//   { applied: true  }  → the migration's post-conditions already hold;
//                         the applier must SKIP (no blind re-run).
//   { applied: false }  → safe to run (the file itself is idempotent:
//                         IF NOT EXISTS / CREATE OR REPLACE / idempotent DDL).
//   { error: '...'  }  → unexpected state; the applier must REFUSE and
//                         surface manual instructions.
//
// Kept dependency-free (duck-typed `client.query`) so unit tests can drive
// it with a fake client. Used by apply-migration-guarded.mjs.

const CORE_15 = [
  'users', 'payments', 'topups', 'wallet_transactions', 'approved_utrs',
  'referrals', 'referral_tiers', 'audit_logs', 'notifications',
  'conversations', 'messages', 'ip_logs', 'suspicious_activity',
  'payment_config', 'plan_change_requests',
];

async function scalar(client, sql) {
  const r = await client.query(sql);
  return r.rows[0];
}

function fnDef(client, name) {
  return client.query(
    `SELECT pg_get_functiondef(p.oid) AS def
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1`,
    [name],
  );
}

export const MIGRATION_PROBES = {
  '017_payment_verification_history.sql': async (client) => {
    const t = await scalar(client, `SELECT to_regclass('public.payment_verifications') IS NOT NULL AS ok`);
    if (!t.ok) return { applied: false };
    const s = await scalar(client, `SELECT c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='payment_verifications'`);
    if (!s || s.rls !== true) return { applied: false }; // partial → idempotent re-run completes it
    const idx = await scalar(client, `SELECT count(*) AS n FROM pg_indexes WHERE schemaname='public' AND tablename='payment_verifications'`);
    if (Number(idx?.n) < 2) return { applied: false };
    return { applied: true };
  },

  '018_complete_user_deletion.sql': async (client) => {
    const t = await scalar(client, `SELECT to_regclass('public.deleted_user_financial_records') IS NOT NULL AS ok`);
    const d = await fnDef(client, 'admin_delete_user');
    const def = d.rows[0]?.def || '';
    const hasArchive = def.includes('deleted_user_financial_records');
    const hasOldUtrDelete = def.includes('DELETE FROM approved_utrs');
    if (t.ok && hasArchive && !hasOldUtrDelete) return { applied: true };
    if (!t.ok && !hasArchive) return { applied: false };
    // Partial/mixed state (e.g. table created but function still 009-era):
    // the file is fully idempotent (IF NOT EXISTS + CREATE OR REPLACE), so
    // re-running completes it. Refuse only if the table exists as the WRONG
    // object kind.
    const kind = await scalar(client, `SELECT c.relkind AS k FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='deleted_user_financial_records'`);
    if (t.ok && kind && kind.k !== 'r') {
      return { error: `deleted_user_financial_records exists as relkind=${kind.k} (expected table r) — inspect manually before applying 018` };
    }
    return { applied: false, note: 'partial state — idempotent re-run will complete' };
  },

  '019_enable_rls_core_tables.sql': async (client) => {
    const list = CORE_15.map((t) => `'${t}'`).join(',');
    const r = await scalar(client,
      `SELECT count(*) AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity AND c.relname IN (${list})`);
    const n = Number(r?.n || 0);
    if (n === CORE_15.length) return { applied: true };
    if (n === 0) return { applied: false };
    // Partial: file is pure idempotent ALTER ... ENABLE ROW LEVEL SECURITY —
    // safe and intended to complete the set.
    return { applied: false, note: `partial RLS (${n}/${CORE_15.length}) — idempotent re-run completes the set` };
  },

  '020_admin_delete_topup_retains_utrs.sql': async (client) => {
    const d = await fnDef(client, 'admin_delete_topup');
    if (!d.rows[0]) return { applied: false, note: 'admin_delete_topup absent — CREATE OR REPLACE will create it' };
    const def = d.rows[0].def;
    const stillDeletesUtrs = def.includes('DELETE FROM approved_utrs');
    if (!stillDeletesUtrs && def.includes('DELETE FROM topups')) return { applied: true };
    if (stillDeletesUtrs) return { applied: false }; // 009-era bug — must run
    return { error: 'admin_delete_topup definition is neither the 009 nor the 020 shape — inspect manually' };
  },

  '021_private_payments_bucket.sql': async (client) => {
    const b = await scalar(client, `SELECT public FROM storage.buckets WHERE id = 'payments'`);
    if (!b) return { error: 'storage bucket "payments" not found — create it before applying 021' };
    if (b.public === false) {
      // Portable across storage schema versions: read the live pg catalog
      // (storage.policies does not exist on every Supabase project).
      const p = await scalar(client,
        `SELECT count(*) AS n FROM pg_policies
          WHERE schemaname='storage' AND tablename='objects' AND cmd='SELECT'
            AND ((roles::text[]) @> ARRAY['anon']::text[] OR (roles::text[]) @> ARRAY['authenticated']::text[])
            AND (qual IS NULL OR qual LIKE '%payments%')`);
      if (Number(p?.n || 0) === 0) return { applied: true };
      return { applied: false, note: 'bucket private but read policies still exist — re-run removes them' };
    }
    return { applied: false };
  },
};

export async function detectMigrationState(client, migrationFile) {
  const probe = MIGRATION_PROBES[migrationFile];
  if (!probe) {
    // Unknown migration file: no probe → applier falls back to plain
    // apply (still inside the transaction) with a warning.
    return { applied: false, unknown: true };
  }
  try {
    return await probe(client);
  } catch (e) {
    return { error: `state probe failed: ${e.message}` };
  }
}

export { CORE_15 };
