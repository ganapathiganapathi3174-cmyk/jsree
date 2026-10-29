import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ─────────────────────────────────────────────────────────────
// Deployment-readiness regression: apply-migration-guarded.mjs
//
// The guarded migration script must REFUSE to run unless the operator
// proves intent (MIGRATION_CONFIRM === filename), names the target
// (MIGRATION_TARGET_PROJECT_REF === ref parsed from SUPABASE_URL), and
// satisfies the non-production guard. Every refusal below happens BEFORE
// any database connection is attempted, so these tests are fully offline.
// ─────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'apply-migration-guarded.mjs');
const MIGRATION = '017_payment_verification_history.sql';

function run(envOverrides, migrationArg = MIGRATION) {
  const baseEnv = {
    PATH: process.env.PATH,
    SYSTEMROOT: process.env.SYSTEMROOT,
    // Strip any operator env: the script must see ONLY what the test passes.
    DATABASE_URL: undefined,
    SUPABASE_URL: undefined,
    MIGRATION_TARGET_PROJECT_REF: undefined,
    MIGRATION_CONFIRM: undefined,
    ALLOW_NON_TEST_TARGET: undefined,
  };
  const env = { ...baseEnv, ...envOverrides };
  // execFileSync cannot take undefined values; drop them.
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, migrationArg], {
      env,
      encoding: 'utf-8',
      timeout: 15000,
    });
    return { code: 0, output: stdout };
  } catch (err) {
    return { code: err.status, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

const VALID_TEST_ENV = {
  DATABASE_URL: 'postgres://user:pass@db.example-test.invalid:5432/postgres',
  SUPABASE_URL: 'https://exampletestproject.supabase.co',
  MIGRATION_TARGET_PROJECT_REF: 'exampletestproject',
  MIGRATION_CONFIRM: MIGRATION,
};

describe('apply-migration-guarded.mjs — refusal paths (offline)', () => {
  it('refuses with no environment at all', () => {
    const r = run({});
    expect(r.code).toBe(1);
    expect(r.output).toContain('REFUSED: DATABASE_URL is not set');
  });

  it('refuses when only DATABASE_URL is set (missing target proof)', () => {
    const r = run({ DATABASE_URL: VALID_TEST_ENV.DATABASE_URL });
    expect(r.code).toBe(1);
    expect(r.output).toContain('REFUSED:');
    expect(r.output).toMatch(/SUPABASE_URL|MIGRATION_TARGET_PROJECT_REF/);
  });

  it('refuses an incorrect migration confirmation', () => {
    const r = run({ ...VALID_TEST_ENV, MIGRATION_CONFIRM: '001_initial_schema.sql' });
    expect(r.code).toBe(1);
    expect(r.output).toContain('REFUSED: MIGRATION_CONFIRM must equal "017_payment_verification_history.sql"');
  });

  it('refuses when MIGRATION_TARGET_PROJECT_REF does not match SUPABASE_URL', () => {
    const r = run({ ...VALID_TEST_ENV, MIGRATION_TARGET_PROJECT_REF: 'someothertestref' });
    expect(r.code).toBe(1);
    expect(r.output).toContain('Target mismatch');
  });

  it('refuses a non-test project ref without ALLOW_NON_TEST_TARGET (production guard)', () => {
    const r = run({
      ...VALID_TEST_ENV,
      SUPABASE_URL: 'https://livecompanyproject.supabase.co',
      MIGRATION_TARGET_PROJECT_REF: 'livecompanyproject',
    });
    expect(r.code).toBe(1);
    expect(r.output).toContain('does not contain "test"');
    expect(r.output).toContain('ALLOW_NON_TEST_TARGET=I_UNDERSTAND');
  });

  it('refuses a malformed migration filename before any environment check', () => {
    const r = run({}, 'drop-everything.sql');
    expect(r.code).toBe(1);
    expect(r.output).toContain('Pass exactly one migration filename');
  });

  it('refuses a well-formed but unknown migration filename before any connection', () => {
    const r = run({
      ...VALID_TEST_ENV,
      MIGRATION_CONFIRM: '999_does_not_exist.sql',
    }, '999_does_not_exist.sql');
    expect(r.code).toBe(1);
    expect(r.output).toContain('Migration file not found');
  });

  it('never prints connection secrets in refusal output', () => {
    const r = run({
      ...VALID_TEST_ENV,
      DATABASE_URL: 'postgres://dbuser:SUPERSECRETPW123@db.example-test.invalid:5432/postgres',
      MIGRATION_CONFIRM: 'wrong.sql',
    });
    expect(r.code).toBe(1);
    expect(r.output).not.toContain('SUPERSECRETPW123');
  });
});
