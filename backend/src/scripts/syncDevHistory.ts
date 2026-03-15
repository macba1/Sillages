import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { syncFullHistory } from '../services/fullHistorySync.js';

async function main() {
  const { data: account } = await supabase
    .from('accounts')
    .select('id, email, full_name')
    .eq('email', 'tony@richmondpartner.com')
    .single();

  if (!account) {
    console.error('Account not found');
    process.exit(1);
  }

  console.log(`Account: ${account.full_name} (${account.email}) — id: ${account.id}`);

  // Check token status
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, token_status')
    .eq('account_id', account.id)
    .single();

  console.log(`Shop: ${conn?.shop_domain} | Token: ${conn?.token_status}`);

  if (conn?.token_status === 'invalid') {
    console.error('Token is invalid — cannot sync');
    process.exit(1);
  }

  console.log('\nStarting full history sync...\n');
  await syncFullHistory(account.id);

  // Load and display results
  const { data: history } = await supabase
    .from('store_history')
    .select('*')
    .eq('account_id', account.id)
    .single();

  if (!history) {
    console.log('No store_history found after sync');
    return;
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('  RESULTADOS DEL SYNC');
  console.log('═══════════════════════════════════════════');
  console.log(`Total pedidos: ${history.total_orders}`);
  console.log(`Revenue total: €${Number(history.total_revenue).toFixed(2)}`);
  console.log(`Total clientes: ${history.total_customers}`);
  console.log(`Primer pedido: ${history.first_order_date}`);
  console.log(`Último pedido: ${history.last_order_date}`);

  const segments = history.customer_segments as Record<string, number>;
  if (segments) {
    console.log(`\n── Segmentos de clientes ──`);
    console.log(`  Total: ${segments.total}`);
    console.log(`  Una compra: ${segments.one_time}`);
    console.log(`  Ocasional (2-3): ${segments.occasional}`);
    console.log(`  Regular (4-9): ${segments.regular}`);
    console.log(`  VIP (10+): ${segments.vip}`);
  }

  const topProducts = history.top_products_alltime as Array<Record<string, unknown>>;
  if (topProducts?.length > 0) {
    console.log(`\n── Top 10 productos (de ${topProducts.length}) ──`);
    for (const p of topProducts.slice(0, 10)) {
      console.log(`  ${p.title} — €${Number(p.total_revenue).toFixed(2)} revenue, ${p.total_units} uds, ${p.order_count} pedidos`);
    }
  }

  const topCustomers = history.top_customers_alltime as Array<Record<string, unknown>>;
  if (topCustomers?.length > 0) {
    console.log(`\n── Top 10 clientes (de ${topCustomers.length}) ──`);
    for (const c of topCustomers.slice(0, 10)) {
      console.log(`  ${c.name} — €${Number(c.total_spent).toFixed(2)} total, ${c.order_count} pedidos, fav: ${c.favorite_product}`);
    }
  }

  const monthly = history.monthly_revenue as Array<Record<string, unknown>>;
  if (monthly?.length > 0) {
    console.log(`\n── Revenue mensual ──`);
    for (const m of monthly) {
      const bar = '█'.repeat(Math.round(Number(m.revenue) / (Number(monthly[0]?.revenue) || 1) * 20));
      console.log(`  ${m.month}: €${Number(m.revenue).toFixed(0).padStart(7)} | ${String(m.orders).padStart(3)} pedidos ${bar}`);
    }
  }

  const seasonal = history.seasonal_patterns as Array<Record<string, unknown>>;
  if (seasonal?.length > 0) {
    console.log(`\n── Patrones estacionales ──`);
    for (const s of seasonal) {
      const prods = (s.best_products as string[])?.join(', ') ?? '';
      console.log(`  ${s.month_name}: €${Number(s.avg_revenue).toFixed(0)} avg/mes, ${s.avg_orders} pedidos avg | ${prods}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
