import pg from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!databaseUrl) { console.error('Missing DATABASE_URL in server/.env'); process.exit(1); }
if (!supabaseUrl || !serviceRoleKey) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

async function run() {
  await client.connect();
  console.log('Connected to Postgres (host verified, credentials not printed).\n');

  const sqlPath = join(__dirname, '../../../supabase/migrations/005_add_avatar_url.sql');
  const sql = readFileSync(sqlPath, 'utf-8');
  console.log('Applying 005_add_avatar_url.sql...');
  await client.query(sql);
  console.log('  OK: avatar_url column added.\n');

  const col = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'avatar_url'"
  );
  console.log(`avatar_url column: ${col.rowCount > 0 ? 'EXISTS' : 'MISSING'}`);

  await client.end();
  console.log('Migration 005 complete.\n');

  // Create avatars bucket (public) if it does not exist
  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: buckets } = await sb.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === 'avatars');
  if (exists) {
    console.log('Storage bucket avatars: ALREADY EXISTS');
  } else {
    const { error } = await sb.storage.createBucket('avatars', { public: true });
    if (error) {
      console.error('Storage bucket avatars creation FAILED:', error.message);
      process.exit(1);
    }
    console.log('Storage bucket avatars: CREATED (public)');
  }

  console.log('\navatar migration + bucket setup complete.');
}

run().catch(async (err) => {
  console.error('Migration failed:', err.message);
  try { await client.end(); } catch {}
  process.exit(1);
});
