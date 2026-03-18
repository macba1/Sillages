import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

async function main() {
  // 1. Check the pending_comms pushes for Anna and Patricia
  const { data: comms } = await supabase
    .from('pending_comms')
    .select('*')
    .eq('account_id', ANDREA_ID)
    .order('created_at', { ascending: false })
    .limit(10);

  console.log(`=== PENDING COMMS (${comms?.length ?? 0}) ===`);
  for (const c of comms ?? []) {
    const content = c.content as Record<string, unknown>;
    console.log(`  ID: ${c.id}`);
    console.log(`  Type: ${c.type} | Channel: ${c.channel}`);
    console.log(`  Status: ${c.status}`);
    console.log(`  Approved at: ${c.approved_at ?? 'N/A'}`);
    console.log(`  Approved by: ${c.approved_by ?? 'N/A'}`);
    console.log(`  Title: ${content.title}`);
    console.log(`  Body: ${String(content.body).slice(0, 100)}`);
    console.log(`  _action_id: ${content._action_id ?? 'N/A'}`);
    console.log('');
  }

  // 2. Check the pending_actions for Anna and Patricia
  const actionIds = [
    '0854c001-a7c0-4292-a400-80f923293baa', // Anna
    '3755008c-0ff6-41d7-bd13-cb94a86502fe', // Patricia
  ];

  console.log('=== PENDING ACTIONS (Anna & Patricia) ===');
  for (const id of actionIds) {
    const { data: action } = await supabase
      .from('pending_actions')
      .select('*')
      .eq('id', id)
      .single();

    if (action) {
      const c = action.content as Record<string, unknown>;
      console.log(`  ${c.customer_name}:`);
      console.log(`    Status: ${action.status}`);
      console.log(`    Created: ${action.created_at}`);
      console.log(`    Approved: ${action.approved_at ?? 'N/A'}`);
      console.log(`    Executed: ${action.executed_at ?? 'N/A'}`);
      console.log(`    Result: ${JSON.stringify(action.result)}`);
    }
    console.log('');
  }

  // 3. Check push subscriptions for Andrea
  const { data: subs, count } = await supabase
    .from('push_subscriptions')
    .select('*', { count: 'exact' })
    .eq('account_id', ANDREA_ID);

  console.log(`=== PUSH SUBSCRIPTIONS for Andrea: ${count ?? 0} ===`);
  for (const s of subs ?? []) {
    console.log(`  Endpoint: ${String(s.endpoint).slice(0, 80)}...`);
    console.log(`  Created: ${s.created_at}`);
  }

  // 4. Check recent email_log for pushes
  const { data: logs } = await supabase
    .from('email_log')
    .select('*')
    .eq('account_id', ANDREA_ID)
    .order('sent_at', { ascending: false })
    .limit(10);

  console.log(`\n=== RECENT EMAIL_LOG (${logs?.length ?? 0}) ===`);
  for (const l of logs ?? []) {
    console.log(`  ${l.sent_at} | ${l.channel} | ${l.status} | ${l.error_message ?? ''}`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
