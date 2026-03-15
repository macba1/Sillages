import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { syncFullHistory } from '../services/fullHistorySync.js';

const ANDREA_EMAIL = 'andrea@nicolina.es';

async function main() {
  console.log('=== SYNC ANDREA FULL HISTORY ===\n');

  // Look up Andrea's account
  const { data: account, error } = await supabase
    .from('accounts')
    .select('id, owner_name, owner_email')
    .eq('owner_email', ANDREA_EMAIL)
    .single();

  if (error || !account) {
    console.error(`Account not found for ${ANDREA_EMAIL}:`, error?.message);
    process.exit(1);
  }

  console.log(`Account: ${account.owner_name} (${account.owner_email})`);
  console.log(`ID: ${account.id}\n`);

  await syncFullHistory(account.id);

  console.log('\n=== DONE ===');
}

main().catch((err) => {
  console.error('SYNC ERROR:', err);
  process.exit(1);
});
