import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { shopifyClient } from '../lib/shopify.js';

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

async function main() {
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token')
    .eq('account_id', ANDREA_ID)
    .single();

  if (!conn) { console.log('No connection'); return; }

  const client = shopifyClient(conn.shop_domain, conn.access_token);

  // Search orders for Elena Llagostera
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  const { orders } = await client.getOrders({
    created_at_min: thirtyDaysAgo,
    created_at_max: new Date().toISOString(),
  });

  const elenaOrders = orders.filter(o => {
    const email = o.customer?.email?.toLowerCase() ?? '';
    const name = `${o.customer?.first_name ?? ''} ${o.customer?.last_name ?? ''}`.toLowerCase();
    return name.includes('llagostera') || name.includes('elena l');
  });

  console.log(`Orders matching Elena Llagostera (last 30d): ${elenaOrders.length}`);
  for (const o of elenaOrders) {
    console.log(`  ${o.created_at} | ${o.customer?.email} | €${o.total_price} | ${o.financial_status} | items: ${o.line_items.map(li => li.title).join(', ')}`);
  }

  // Also check email_log for recent contact
  const { data: logs } = await supabase
    .from('email_log')
    .select('sent_at, message_id, recipient_email')
    .eq('account_id', ANDREA_ID)
    .eq('status', 'sent')
    .order('sent_at', { ascending: false })
    .limit(50);

  const elenaLogs = (logs ?? []).filter(l =>
    l.recipient_email?.toLowerCase().includes('llagostera') ||
    l.recipient_email?.toLowerCase().includes('elena')
  );

  console.log(`\nEmail log entries for Elena: ${elenaLogs.length}`);
  for (const l of elenaLogs) {
    console.log(`  ${l.sent_at} | ${l.recipient_email} | msg: ${l.message_id}`);
  }

  // Check abandoned carts
  const { data: carts } = await supabase
    .from('abandoned_carts')
    .select('customer_name, customer_email, products, total_price, abandoned_at, recovered')
    .eq('account_id', ANDREA_ID)
    .ilike('customer_name', '%llagostera%');

  console.log(`\nAbandoned carts for Llagostera: ${(carts ?? []).length}`);
  for (const c of carts ?? []) {
    console.log(`  ${c.abandoned_at} | ${c.customer_email} | €${c.total_price} | recovered: ${c.recovered}`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
