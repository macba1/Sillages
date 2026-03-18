import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // 1. Check email_log for today's sends
  const { data: logs } = await supabase
    .from('email_log')
    .select('*')
    .eq('account_id', ANDREA_ID)
    .eq('channel', 'email')
    .eq('status', 'sent')
    .gte('sent_at', today + 'T00:00:00Z')
    .order('sent_at', { ascending: false });

  console.log(`=== EMAIL_LOG TODAY (${logs?.length ?? 0}) ===`);
  for (const l of logs ?? []) {
    console.log(`  ${l.sent_at} | msg_id: ${l.message_id} | recipient: ${l.recipient_email ?? 'N/A'}`);
  }

  // 2. Check completed cart_recovery actions with result.sent_to
  const { data: actions } = await supabase
    .from('pending_actions')
    .select('id, title, type, status, executed_at, result, content')
    .eq('account_id', ANDREA_ID)
    .eq('type', 'cart_recovery')
    .eq('status', 'completed')
    .gte('executed_at', today + 'T00:00:00Z')
    .order('executed_at', { ascending: false });

  console.log(`\n=== COMPLETED CART_RECOVERY TODAY (${actions?.length ?? 0}) ===`);
  for (const a of actions ?? []) {
    const result = a.result as Record<string, unknown> | null;
    const content = a.content as Record<string, unknown>;
    console.log(`  ${a.executed_at}`);
    console.log(`    Title: ${a.title}`);
    console.log(`    Sent to: ${result?.sent_to ?? 'N/A'}`);
    console.log(`    Skipped: ${result?.skipped ?? false}`);
    console.log(`    Message ID: ${result?.message_id ?? 'N/A'}`);
    console.log(`    Customer: ${content.customer_name} <${content.customer_email}>`);
    console.log(`    Subject (from title): ${content.title ?? a.title}`);
    console.log(`    Has custom copy: ${!!content.copy}`);
    if (content.copy) {
      console.log(`    Copy preview: ${String(content.copy).slice(0, 200)}...`);
    }
    console.log('');
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
