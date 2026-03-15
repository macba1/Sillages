import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { shopifyClient } from '../lib/shopify.js';

async function main() {
  const { data: acc } = await supabase.from('accounts').select('id').eq('email', 'andrea@nicolina.es').single();
  if (!acc) { console.error('Not found'); return; }

  // 1. Clean pending actions
  const { count } = await supabase.from('pending_actions').select('*', { count: 'exact', head: true }).eq('account_id', acc.id).eq('status', 'pending');
  console.log(`Pending actions to delete: ${count}`);
  await supabase.from('pending_actions').delete().eq('account_id', acc.id).eq('status', 'pending');
  console.log('Deleted all pending actions for Andrea\n');

  // 2. Investigate Julia's purchase history
  const { data: conn } = await supabase.from('shopify_connections').select('shop_domain, access_token').eq('account_id', acc.id).single();
  if (!conn) return;

  const client = shopifyClient(conn.shop_domain, conn.access_token);
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();
  const result = await client.getOrders({ created_at_min: sixtyDaysAgo, created_at_max: new Date().toISOString() });
  const allOrders = result.orders.filter(o => o.financial_status !== 'voided' && !o.cancel_reason);

  // Build customer map
  const customerMap = new Map<string, { name: string; email: string; orders: Array<{ date: string; total: number; products: string[] }> }>();
  for (const o of allOrders) {
    const email = o.customer?.email;
    if (!email) continue;
    const name = `${o.customer?.first_name ?? ''} ${o.customer?.last_name ?? ''}`.trim();
    if (!customerMap.has(email)) customerMap.set(email, { name, email, orders: [] });
    customerMap.get(email)!.orders.push({
      date: o.created_at,
      total: parseFloat(o.total_price),
      products: o.line_items.map(li => li.title),
    });
  }

  // Find Julia
  console.log('=== JULIA FDEZ.-MORIS ===');
  for (const [, c] of customerMap) {
    if (!c.name.includes('Julia') || !c.name.includes('Moris')) continue;

    c.orders.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    console.log(`Name: ${c.name}`);
    console.log(`Email: ${c.email}`);
    console.log(`Orders in 60 days: ${c.orders.length}`);

    for (const o of c.orders) {
      console.log(`  ${o.date.slice(0, 10)} — €${o.total.toFixed(2)} — ${o.products.join(', ')}`);
    }

    if (c.orders.length >= 2) {
      const gaps: number[] = [];
      for (let i = 1; i < c.orders.length; i++) {
        const gap = Math.round((new Date(c.orders[i].date).getTime() - new Date(c.orders[i - 1].date).getTime()) / 86400000);
        gaps.push(gap);
      }
      const avg = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
      const daysSince = Math.floor((Date.now() - new Date(c.orders[c.orders.length - 1].date).getTime()) / 86400000);
      console.log(`Gaps: ${gaps.join(', ')} days`);
      console.log(`Average cycle: ${avg} days`);
      console.log(`Days since last: ${daysSince}`);
      console.log(`BUG? avg_cycle=${avg} seems ${avg < 7 ? 'TOO LOW — probably two orders on consecutive days skewing the average' : 'reasonable'}`);
    }
  }

  // Show all repeat customers with their real data
  console.log('\n=== TOP 15 REPEAT CUSTOMERS (by order count) ===');
  const repeaters: Array<{ name: string; orders: number; avg_cycle: number; days_since: number; gaps: string }> = [];

  for (const [, c] of customerMap) {
    if (c.orders.length < 2) continue;
    c.orders.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const gaps: number[] = [];
    for (let i = 1; i < c.orders.length; i++) {
      gaps.push(Math.round((new Date(c.orders[i].date).getTime() - new Date(c.orders[i - 1].date).getTime()) / 86400000));
    }
    const avg = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    const daysSince = Math.floor((Date.now() - new Date(c.orders[c.orders.length - 1].date).getTime()) / 86400000);
    repeaters.push({ name: c.name, orders: c.orders.length, avg_cycle: avg, days_since: daysSince, gaps: gaps.join(',') });
  }

  repeaters.sort((a, b) => b.orders - a.orders);
  for (const r of repeaters.slice(0, 15)) {
    const overdue = r.days_since > r.avg_cycle * 1.5 && r.days_since >= 14;
    const flag = overdue ? ' ⚠️ OVERDUE' : '';
    const bugFlag = r.avg_cycle < 7 && r.orders <= 3 ? ' 🐛 CYCLE TOO LOW' : '';
    console.log(`  ${r.name.padEnd(32)} ${String(r.orders).padStart(2)} orders | cycle ${String(r.avg_cycle).padStart(3)}d | last ${String(r.days_since).padStart(3)}d ago | gaps: ${r.gaps}${flag}${bugFlag}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
