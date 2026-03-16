import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { syncFullHistory } from '../services/fullHistorySync.js';
import { syncAbandonedCarts } from '../services/abandonedCartsSync.js';

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

async function main() {
  // 1. Force resync by clearing synced_at
  console.log('Clearing synced_at to force full history resync...');
  await supabase.from('store_history').update({ synced_at: null }).eq('account_id', ANDREA_ID);

  // 2. Run full history sync
  console.log('\n=== FULL HISTORY SYNC ===');
  await syncFullHistory(ANDREA_ID);

  // 3. Check results
  const { data: hist } = await supabase.from('store_history').select('*').eq('account_id', ANDREA_ID).maybeSingle();
  if (hist) {
    console.log(`\nTotal orders: ${hist.total_orders}`);
    console.log(`Total revenue: €${hist.total_revenue}`);
    const monthly = hist.monthly_revenue as any[];
    console.log(`Months of data: ${monthly?.length}`);
    if (monthly && monthly.length > 0) {
      console.log(`First month: ${monthly[0].month}`);
      console.log(`Last month: ${monthly[monthly.length - 1].month}`);
    }
  }

  // 4. Try abandoned carts sync
  console.log('\n=== ABANDONED CARTS SYNC ===');
  try {
    await syncAbandonedCarts(ANDREA_ID);
    const { count } = await supabase.from('abandoned_carts').select('*', { count: 'exact', head: true }).eq('account_id', ANDREA_ID);
    console.log(`Abandoned carts after sync: ${count}`);
  } catch (err) {
    console.error('Abandoned carts sync failed:', (err as Error).message);
    console.log('(Probably missing read_checkouts scope)');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
