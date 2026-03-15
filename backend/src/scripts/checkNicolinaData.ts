import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { shopifyClient } from '../lib/shopify.js';

async function main() {
  const accountId = 'e77572ee-83df-43e8-8f69-f143a227fe56';

  // 1. Check abandoned carts
  const { data: carts, count } = await supabase
    .from('abandoned_carts')
    .select('*', { count: 'exact' })
    .eq('account_id', accountId)
    .order('abandoned_at', { ascending: false })
    .limit(3);

  console.log('=== ABANDONED CARTS ===');
  console.log('Total in DB:', count);
  for (const c of carts ?? []) {
    console.log(' ', c.customer_name, '-', c.customer_email, '- €', c.total_price, '-', String(c.abandoned_at)?.slice(0, 10));
  }

  // 2. Recent snapshots
  const { data: snaps } = await supabase
    .from('shopify_daily_snapshots')
    .select('snapshot_date, total_orders, new_customers, total_revenue')
    .eq('account_id', accountId)
    .order('snapshot_date', { ascending: false })
    .limit(14);

  console.log('\n=== RECENT SNAPSHOTS ===');
  for (const s of snaps ?? []) {
    console.log(' ', s.snapshot_date, '| orders:', s.total_orders, '| new:', s.new_customers, '| rev: €', s.total_revenue);
  }

  // 3. Shopify orders — 30 days
  const { data: conn } = await supabase.from('shopify_connections').select('shop_domain, access_token').eq('account_id', accountId).single();
  if (!conn) { console.log('No Shopify connection'); return; }

  const client = shopifyClient(conn.shop_domain, conn.access_token);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const { orders } = await client.getOrders({ created_at_min: thirtyDaysAgo, created_at_max: new Date().toISOString() });
  const valid = orders.filter(o => o.financial_status !== 'voided' && !o.cancel_reason);

  console.log('\n=== SHOPIFY ORDERS (30d) ===');
  console.log('Total valid:', valid.length);

  // First-time buyers
  const firstTimers = valid.filter(o => o.customer?.orders_count === 1 && o.customer?.email);
  console.log('First-time buyers:', firstTimers.length);
  for (const o of firstTimers.slice(0, 5)) {
    console.log('  ', o.customer?.first_name, o.customer?.last_name, '-', o.line_items[0]?.title, '-', o.created_at.slice(0, 10));
  }

  // Repeat customers
  const byCustomer = new Map<string, { name: string; orderCount: number; dates: string[] }>();
  for (const o of valid) {
    const id = String(o.customer?.id ?? '');
    if (!id || !o.customer?.email) continue;
    if (!byCustomer.has(id)) byCustomer.set(id, { name: `${o.customer?.first_name ?? ''} ${o.customer?.last_name ?? ''}`.trim(), orderCount: 0, dates: [] });
    const c = byCustomer.get(id)!;
    c.orderCount++;
    c.dates.push(o.created_at.slice(0, 10));
  }

  console.log('\nRepeat customers (2+ orders in 30d):');
  for (const [, c] of byCustomer) {
    if (c.orderCount >= 2) {
      console.log('  ', c.name, '-', c.orderCount, 'orders:', c.dates.join(', '));
    }
  }

  // 60 day window for overdue
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();
  const { orders: orders60 } = await client.getOrders({ created_at_min: sixtyDaysAgo, created_at_max: new Date().toISOString() });
  const valid60 = orders60.filter(o => o.financial_status !== 'voided' && !o.cancel_reason);

  const byCustomer60 = new Map<string, { name: string; email: string; orderCount: number; dates: string[] }>();
  for (const o of valid60) {
    const id = String(o.customer?.id ?? '');
    if (!id || !o.customer?.email) continue;
    if (!byCustomer60.has(id)) byCustomer60.set(id, { name: `${o.customer?.first_name ?? ''} ${o.customer?.last_name ?? ''}`.trim(), email: o.customer.email, orderCount: 0, dates: [] });
    const c = byCustomer60.get(id)!;
    c.orderCount++;
    c.dates.push(o.created_at.slice(0, 10));
  }

  console.log('\n=== CUSTOMERS WITH 3+ ORDERS (60d) ===');
  for (const [, c] of byCustomer60) {
    if (c.orderCount >= 3) {
      c.dates.sort();
      const daysSince = Math.floor((Date.now() - new Date(c.dates[c.dates.length - 1]).getTime()) / 86400000);
      console.log('  ', c.name, '-', c.orderCount, 'orders - last:', daysSince, 'd ago -', c.dates.join(', '));
    }
  }

  console.log('\n=== ALL CUSTOMERS WITH 2+ ORDERS (60d) for reference ===');
  for (const [, c] of byCustomer60) {
    if (c.orderCount >= 2) {
      c.dates.sort();
      const daysSince = Math.floor((Date.now() - new Date(c.dates[c.dates.length - 1]).getTime()) / 86400000);
      console.log('  ', c.name, '-', c.orderCount, 'orders - last:', daysSince, 'd ago');
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
