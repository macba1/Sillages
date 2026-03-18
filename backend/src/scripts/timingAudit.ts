import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

async function main() {
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token')
    .eq('account_id', ANDREA_ID)
    .single();

  if (!conn) { console.log('No connection'); return; }

  // Order IDs from recovered carts
  const orderIds = ['10736103653700', '10736655565124', '10736493691204'];

  // Fetch each order from Shopify
  for (const orderId of orderIds) {
    const url = `https://${conn.shop_domain}/admin/api/2024-01/orders/${orderId}.json`;
    const resp = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': conn.access_token },
    });
    const data = await resp.json() as { order: { name: string; created_at: string; email: string; customer: { first_name: string; last_name: string }; line_items: Array<{ title: string }> } };
    const o = data.order;
    console.log(`${o.customer.first_name} ${o.customer.last_name} (${o.email})`);
    console.log(`  Order ${o.name}: ${o.created_at}`);
    console.log(`  Products: ${o.line_items.map(li => li.title).join(', ')}`);
  }

  // Action execution times
  const actionIds = ['d2673aea', 'a967e211', 'ee6bc489'];
  const fullIds = [
    'd2673aea-', // Cecilia
    'a967e211-', // Lorena
    'ee6bc489-', // Paola
  ];

  console.log('\n=== EMAIL SEND TIMES ===');
  const { data: actions } = await supabase
    .from('pending_actions')
    .select('id, title, executed_at, content')
    .eq('account_id', ANDREA_ID)
    .eq('type', 'cart_recovery')
    .in('id', [
      'd2673aea-5dbd-41f6-923d-ac8a3b9f1d1b', // guess - let me get real IDs
    ]);

  // Just get all completed cart_recovery with executed_at
  const { data: allActions } = await supabase
    .from('pending_actions')
    .select('id, title, executed_at, content')
    .eq('account_id', ANDREA_ID)
    .eq('type', 'cart_recovery')
    .eq('status', 'completed')
    .not('executed_at', 'is', null)
    .order('executed_at', { ascending: true });

  for (const a of allActions ?? []) {
    const c = a.content as Record<string, unknown>;
    const email = c.customer_email as string;
    const sentTo = (a as any).result?.sent_to;
    if (['cecilia@fseal.com', 'pereira.lorena@gmail.com', 'paosealc@gmail.com'].includes(email)) {
      console.log(`${c.customer_name}: executed_at = ${a.executed_at}`);
    }
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
