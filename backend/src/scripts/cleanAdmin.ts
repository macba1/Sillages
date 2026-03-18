import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

async function main() {
  // 1. Show all pending actions
  const { data: pending } = await supabase
    .from('pending_actions')
    .select('id, type, title, status, created_at, content')
    .eq('account_id', ANDREA_ID)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  console.log(`=== PENDING ACTIONS (${pending?.length ?? 0}) ===`);
  for (const a of pending ?? []) {
    const content = a.content as Record<string, unknown>;
    const age = Math.round((Date.now() - new Date(a.created_at).getTime()) / 3600000);
    console.log(`  [${a.type}] ${a.title}`);
    console.log(`    ID: ${a.id}`);
    console.log(`    Created: ${a.created_at} (${age}h ago)`);
    console.log(`    Customer: ${content.customer_name ?? 'N/A'} <${content.customer_email ?? 'N/A'}>`);
    console.log('');
  }

  // 2. Delete all stale pending actions
  if (pending && pending.length > 0) {
    const ids = pending.map(a => a.id);
    const { error } = await supabase
      .from('pending_actions')
      .update({ status: 'rejected', result: { reason: 'Limpieza admin: acción obsoleta' } })
      .in('id', ids);

    if (error) {
      console.error('Error rejecting:', error.message);
    } else {
      console.log(`Rejected ${ids.length} stale pending actions`);
    }
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
