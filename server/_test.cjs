import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Try to create exec_sql function and run DDL
const sql = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'exec_sql') THEN
    CREATE FUNCTION exec_sql(query text) RETURNS void AS $$
    BEGIN
      EXECUTE query;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;
  END IF;
END $$;
`;

// Try calling existing exec_sql
const r1 = await s.rpc('exec_sql', { query: 'SELECT 1' });
console.log('exec_sql exists:', JSON.stringify(r1));

// Try creating via a PostgREST trick: insert into a migration log
// Actually let's just try the Supabase Management-like approach
const r2 = await s.from('topups').select('id').eq('status', 'approved').limit(1);
console.log('approved topups exist:', JSON.stringify(r2));
