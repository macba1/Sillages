import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

/**
 * 1. Migrate pending cart_recovery items from pending_comms → pending_actions
 * 2. Delete ALL non-weekly_email items from pending_comms
 */
async function main() {
  // 1. Get all pending cart_recovery from pending_comms
  const { data: cartComms, error: fetchErr } = await supabase
    .from('pending_comms')
    .select('*')
    .eq('type', 'cart_recovery')
    .eq('status', 'pending');

  if (fetchErr) {
    console.error('Failed to fetch cart_recovery comms:', fetchErr.message);
    process.exit(1);
  }

  console.log(`Found ${cartComms?.length ?? 0} pending cart_recovery in pending_comms`);

  // 2. Migrate each to pending_actions
  let migrated = 0;
  for (const comm of cartComms ?? []) {
    const content = comm.content as Record<string, unknown>;
    const customerName = String(content.customer_name ?? '');
    const customerEmail = String(content.customer_email ?? '');
    const title = String(content.title ?? `Email para ${customerName}`);

    const { error: insertErr } = await supabase
      .from('pending_actions')
      .insert({
        account_id: comm.account_id,
        type: 'cart_recovery',
        title,
        description: `Email preparado para ${customerName} <${customerEmail}>`,
        content: {
          ...content,
          plan_required: 'growth',
          time_estimate: '5 min',
          pending_comm_id: comm.id,
        },
        status: 'pending',
      });

    if (insertErr) {
      console.log(`✗ ${customerName}: ${insertErr.message}`);
    } else {
      migrated++;
      console.log(`✓ Migrated → pending_actions: ${customerName}`);
    }
  }

  console.log(`\nMigrated ${migrated}/${cartComms?.length ?? 0} cart_recovery to pending_actions`);

  // 3. Delete ALL non-weekly_email from pending_comms (any status)
  const { data: toDelete } = await supabase
    .from('pending_comms')
    .select('id, type, status')
    .neq('type', 'weekly_email');

  console.log(`\nDeleting ${toDelete?.length ?? 0} non-weekly_email items from pending_comms:`);
  for (const item of toDelete ?? []) {
    console.log(`  - ${item.id} (${item.type}, ${item.status})`);
  }

  if (toDelete && toDelete.length > 0) {
    const ids = toDelete.map(i => i.id);
    const { error: delErr } = await supabase
      .from('pending_comms')
      .delete()
      .in('id', ids);

    if (delErr) {
      console.error(`Delete failed: ${delErr.message}`);
    } else {
      console.log(`Deleted ${ids.length} items`);
    }
  }

  // 4. Show what remains
  const { data: remaining } = await supabase
    .from('pending_comms')
    .select('id, type, status, created_at')
    .order('created_at', { ascending: false });

  console.log(`\n═══ REMAINING IN pending_comms (${remaining?.length ?? 0} items) ═══`);
  for (const r of remaining ?? []) {
    console.log(`  ${r.id} | ${r.type} | ${r.status} | ${r.created_at}`);
  }
  if (!remaining || remaining.length === 0) {
    console.log('  (empty — only weekly_email will appear here from now on)');
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
