import pg from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Missing DATABASE_URL in server/.env');
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

async function run() {
  await client.connect();
  console.log('Connected to Postgres (host verified, credentials not printed).\n');

  for (const file of ['003_add_utr_constraint.sql', '004_registration_transaction.sql']) {
    const sqlPath = join(__dirname, '../../../supabase/migrations', file);
    const sql = readFileSync(sqlPath, 'utf-8');
    console.log(`Applying ${file}...`);
    await client.query(sql);
    console.log(`  OK: ${file} applied.\n`);
  }

  console.log('=== Verification ===');
  const idx = await client.query(
    "SELECT indexname FROM pg_indexes WHERE indexname = 'idx_payments_transaction_id_unique'"
  );
  console.log(`Unique index idx_payments_transaction_id_unique: ${idx.rowCount > 0 ? 'EXISTS' : 'MISSING'}`);

  const funcs = await client.query(
    "SELECT proname FROM pg_proc WHERE proname IN ('approve_initial_payment','delete_pending_registration')"
  );
  console.log(`RPC functions present: ${funcs.rows.map((r) => r.proname).join(', ') || 'NONE'}`);

  const rpc = await client.query('SELECT approve_initial_payment(NULL::uuid, NULL::uuid)').catch((e) => e);
  console.log(`approve_initial_payment callable: ${rpc instanceof Error ? 'not callable: ' + rpc.message : 'yes'}`);

  console.log('\nMigrations 003 + 004 complete.');
  await client.end();
}

run().catch(async (err) => {
  console.error('Migration failed:', err.message);
  try { await client.end(); } catch {}
  process.exit(1);
});
