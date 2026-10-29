// Guarded migration applier for authorized, explicitly-configured projects.
//
// Applies ONE reviewed SQL file from supabase/migrations/ to the database
// named by DATABASE_URL, inside a transaction, with an advisory lock.
// It refuses to run unless the operator proves intent and names the target:
//
//   Required env:
//     DATABASE_URL                   direct Postgres URL (Supabase -> Settings/Database)
//     SUPABASE_URL                   project URL (used only to cross-check the target)
//     MIGRATION_TARGET_PROJECT_REF   the Supabase project ref you intend to hit
//     MIGRATION_CONFIRM               must equal the migration filename, e.g. "017_payment_verification_history.sql"
//
//   Optional:
//     ALLOW_NON_TEST_TARGET=I_UNDERSTAND   required if the project ref does NOT
//                                           contain "test" (guards against prod)
//
// Usage:
//   node server/src/scripts/apply-migration-guarded.mjs 017_payment_verification_history.sql
//
// The script NEVER prints secrets (passwords redacted) and NEVER runs
// multiple migrations - review and apply one at a time.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations');

function fail(msg) {
  console.error(`REFUSED: ${msg}`);
  process.exit(1);
}

const migrationFile = process.argv[2];
if (!migrationFile || !/^\d{3}_[a-z0-9_]+\.sql$/.test(migrationFile)) {
  fail('Pass exactly one migration filename, e.g. 017_payment_verification_history.sql');
}

const { DATABASE_URL, SUPABASE_URL, MIGRATION_TARGET_PROJECT_REF, MIGRATION_CONFIRM, ALLOW_NON_TEST_TARGET } = process.env;
if (!DATABASE_URL) fail('DATABASE_URL is not set (direct connection string for the authorized test project).');
if (!SUPABASE_URL) fail('SUPABASE_URL is not set (needed to cross-check the target project ref).');
if (!MIGRATION_TARGET_PROJECT_REF) fail('MIGRATION_TARGET_PROJECT_REF is not set - name the project ref you intend to migrate.');
if (MIGRATION_CONFIRM !== migrationFile) {
  fail(`MIGRATION_CONFIRM must equal "${migrationFile}" to prove this exact migration was reviewed.`);
}

// Cross-check: the Supabase project ref must match the stated target.
const urlRef = (SUPABASE_URL.match(/https?:\/\/([a-z]+)\.supabase\./i) || [])[1];
if (!urlRef) fail(`SUPABASE_URL does not look like a Supabase project URL: redacted host check failed.`);
if (urlRef !== MIGRATION_TARGET_PROJECT_REF) {
  fail(`Target mismatch: SUPABASE_URL project ref "${urlRef}" != MIGRATION_TARGET_PROJECT_REF "${MIGRATION_TARGET_PROJECT_REF}".`);
}
if (!/test/i.test(urlRef) && ALLOW_NON_TEST_TARGET !== 'I_UNDERSTAND') {
  fail(`Project ref "${urlRef}" does not contain "test". If this is genuinely an authorized non-production target, re-run with ALLOW_NON_TEST_TARGET=I_UNDERSTAND.`);
}

const sqlPath = path.join(MIGRATIONS_DIR, migrationFile);
if (!existsSync(sqlPath)) fail(`Migration file not found: ${sqlPath}`);
const sql = readFileSync(sqlPath, 'utf-8');

console.log(`Target project ref : ${urlRef}`);
console.log(`Migration          : ${migrationFile}`);
console.log(`SQL bytes          : ${sql.length}`);
console.log('Applying in a transaction with advisory lock...');

const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});
const redact = (s) => String(s).replace(/:[^:@/]+@/, ':***@');

(async () => {
  try {
    await client.connect();
    const info = await client.query('select current_database() as db, current_user as role');
    console.log(`Connected db/role  : ${info.rows[0].db} / ${info.rows[0].role}`);

    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_lock(717017)');

    // Idempotency marker: 017 is IF NOT EXISTS; record state before/after.
    const before = await client.query(`select to_regclass('public.payment_verifications') as t`);
    await client.query(sql);
    const after = await client.query(`select to_regclass('public.payment_verifications') as t`);
    const rls = await client.query(
      `select relrowsecurity from pg_class where oid = 'public.payment_verifications'::regclass`
    );
    await client.query('COMMIT');

    console.log(`Table before/after : ${before.rows[0].t || '(absent)'} -> ${after.rows[0].t}`);
    console.log(`RLS enabled        : ${rls.rows[0].relrowsecurity === true}`);
    if (!after.rows[0].t) fail('Table still absent after apply - transaction rolled back?');
    console.log('DONE: migration applied and committed.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    console.error(`FAILED (rolled back): ${redact(err.message)}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
})();
