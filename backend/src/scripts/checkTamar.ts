import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

async function main() {
  // 1. Check abandoned_carts for Tamar
  const { data: carts } = await supabase
    .from('abandoned_carts')
    .select('*')
    .eq('account_id', ANDREA_ID)
    .ilike('customer_name', '%Tamar%');

  console.log('=== ABANDONED CARTS (Tamar) ===');
  for (const c of carts ?? []) {
    console.log(`  Cart ID: ${c.id}`);
    console.log(`  Customer: ${c.customer_name} <${c.customer_email}>`);
    console.log(`  Abandoned at: ${c.abandoned_at}`);
    console.log(`  Recovered: ${c.recovered}`);
    console.log(`  Recovered at: ${c.recovered_at}`);
    console.log(`  Recovery order ID: ${c.recovery_order_id}`);
    console.log(`  Products: ${JSON.stringify(c.products)}`);
    console.log('');
  }

  // 2. Check pending_actions for Tamar
  const { data: actions } = await supabase
    .from('pending_actions')
    .select('*')
    .eq('account_id', ANDREA_ID)
    .eq('type', 'cart_recovery')
    .filter('content->>customer_name', 'ilike', '%Tamar%');

  console.log('=== PENDING ACTIONS (Tamar cart_recovery) ===');
  for (const a of actions ?? []) {
    console.log(`  Action ID: ${a.id}`);
    console.log(`  Status: ${a.status}`);
    console.log(`  Created at: ${a.created_at}`);
    console.log(`  Approved at: ${a.approved_at}`);
    console.log(`  Executed at: ${a.executed_at}`);
    console.log(`  Title: ${a.title}`);
    console.log(`  Result: ${JSON.stringify(a.result)}`);
    console.log('');
  }

  // 3. Check email_log for Tamar
  const { data: emails } = await supabase
    .from('email_log')
    .select('*')
    .eq('account_id', ANDREA_ID);

  console.log('=== EMAIL LOG (all for Andrea) ===');
  for (const e of emails ?? []) {
    console.log(`  ${e.sent_at} | ${e.channel} | ${e.status} | msg=${e.message_id}`);
  }

  // 4. Check Shopify orders for Tamar
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token')
    .eq('account_id', ANDREA_ID)
    .single();

  if (conn) {
    const url = `https://${conn.shop_domain}/admin/api/2024-01/orders.json?status=any&limit=50`;
    const resp = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': conn.access_token }
    });
    const data = await resp.json() as { orders: Array<{ id: number; name: string; email: string; created_at: string; financial_status: string; line_items: Array<{ title: string }> }> };

    const tamarOrders = data.orders.filter((o: any) =>
      o.email?.toLowerCase().includes('tvbenet') ||
      (o.customer?.first_name + ' ' + o.customer?.last_name)?.toLowerCase().includes('tamar')
    );

    console.log(`\n=== SHOPIFY ORDERS (Tamar) === (${tamarOrders.length} found)`);
    for (const o of tamarOrders) {
      console.log(`  Order ${o.name} | ${o.created_at} | ${o.financial_status} | ${o.email}`);
      console.log(`    Products: ${o.line_items.map((li: any) => li.title).join(', ')}`);
    }
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
