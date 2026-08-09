import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const sql = readFileSync(join(__dirname, '../../../supabase/migrations/001_initial_schema.sql'), 'utf-8');

// Split into individual statements
const statements = sql
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'));

console.log(`Found ${statements.length} SQL statements to execute`);

async function runMigration() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  let success = 0;
  let failed = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.substring(0, 60).replace(/\n/g, ' ');
    
    try {
      const { error } = await supabase.rpc('exec_sql', { query: stmt + ';' });
      
      if (error) {
        // Try direct table creation via REST
        console.log(`[${i+1}/${statements.length}] SKIP (rpc): ${preview}...`);
        failed++;
      } else {
        console.log(`[${i+1}/${statements.length}] OK: ${preview}...`);
        success++;
      }
    } catch (e) {
      console.log(`[${i+1}/${statements.length}] ERR: ${preview}...`);
      failed++;
    }
  }

  console.log(`\nResults: ${success} OK, ${failed} failed`);
}

runMigration().catch(e => {
  console.error('Migration failed:', e.message);
  process.exit(1);
});
