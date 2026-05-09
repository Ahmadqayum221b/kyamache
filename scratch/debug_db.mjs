import { makeSupabase } from '../worker/src/lib/supabase.js';

const env = {
  SUPABASE_URL: "https://lnbpgnilxaaodowbetgg.supabase.co",
  SUPABASE_SERVICE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxuYnBnbmlseGFhb2Rvd2JldGdnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzIzNjQwMywiZXhwIjoyMDkyODEyNDAzfQ.8R2-k2AnmV3HxVVg7Z1HG572IGbbkfhT1iy96qU_XZQ"
};

const db = makeSupabase(env);

async function debug() {
  try {
    console.log('--- Checking Entries ---');
    const res = await fetch(`${db.base}/rest/v1/entries?order=created_at.desc&limit=5`, {
      headers: db._headers()
    });
    const entries = await res.json();
    console.log('Sample entries:', JSON.stringify(entries, null, 2));

    if (entries.length > 0) {
      console.log('Columns in first entry:', Object.keys(entries[0]));
    } else {
      console.log('No entries found in table.');
    }

    console.log('\n--- Checking Table Structure (via RPC or just guessing) ---');
    // We can't easily check columns without information_schema which might be restricted
    // but we can try a select with a specific column.
    const res2 = await fetch(`${db.base}/rest/v1/entries?select=status&limit=1`, {
      headers: db._headers()
    });
    if (res2.ok) {
      console.log('Status column EXISTS.');
    } else {
      console.log('Status column MISSING or Error:', await res2.text());
    }

  } catch (err) {
    console.error('Debug failed:', err.message);
  }
}

debug();
