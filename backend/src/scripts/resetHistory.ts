import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

async function main() {
  // Delete existing store_history for Andrea so we can re-sync
  const { data: acc } = await supabase
    .from('accounts')
    .select('id')
    .eq('email', 'andrea@nicolina.es')
    .single();
  
  if (!acc) { console.error('Not found'); return; }
  
  await supabase.from('store_history').delete().eq('account_id', acc.id);
  console.log('Deleted existing store_history for Andrea — ready for re-sync');
}
main().catch(console.error);
