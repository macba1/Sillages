import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

async function main() {
  // 1. Pending actions for Andrea
  const { data: actions } = await supabase
    .from('pending_actions')
    .select('id, type, title, status, created_at, content')
    .eq('account_id', ANDREA_ID)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  console.log(`=== PENDING ACTIONS for Andrea (${actions?.length ?? 0}) ===`);
  for (const a of actions ?? []) {
    const c = a.content as Record<string, unknown>;
    console.log(`  ${a.type.padEnd(18)} | ${a.title}`);
    console.log(`    Customer: ${c.customer_name} <${c.customer_email}>`);
    console.log(`    Created: ${a.created_at}`);
    console.log(`    ID: ${a.id}`);
    console.log('');
  }

  // 2. Check if those customers already bought (real-time Shopify)
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token')
    .eq('account_id', ANDREA_ID)
    .single();

  if (!conn) return;

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const url = `https://${conn.shop_domain}/admin/api/2024-01/orders.json?status=any&created_at_min=${sevenDaysAgo}&limit=250`;
  const resp = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': conn.access_token },
  });
  const data = await resp.json() as { orders: Array<{ email: string; customer: { first_name: string; last_name: string }; created_at: string; financial_status: string; cancel_reason: string | null; line_items: Array<{ title: string }> }> };

  const recentOrders = data.orders.filter(o => o.financial_status !== 'voided' && !o.cancel_reason);
  const orderEmails = new Set(recentOrders.map(o => o.email?.toLowerCase()).filter(Boolean));

  console.log('=== SHOPIFY CHECK: Did these customers already buy? ===\n');
  for (const a of actions ?? []) {
    const c = a.content as Record<string, unknown>;
    const email = String(c.customer_email ?? '').toLowerCase();
    const bought = orderEmails.has(email);

    if (bought) {
      const order = recentOrders.find(o => o.email?.toLowerCase() === email);
      console.log(`  ❌ ${c.customer_name} — YA COMPRÓ`);
      console.log(`     Order: ${order?.created_at} | ${order?.line_items.map(li => li.title).join(', ')}`);
    } else {
      console.log(`  ✅ ${c.customer_name} — NO ha comprado. Email válido para enviar.`);
    }
  }

  // 3. Unrecovered abandoned carts (last 5 days)
  const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString();
  const { data: openCarts } = await supabase
    .from('abandoned_carts')
    .select('*')
    .eq('account_id', ANDREA_ID)
    .or('recovered.is.null,recovered.eq.false')
    .gte('abandoned_at', fiveDaysAgo)
    .order('abandoned_at', { ascending: false });

  console.log(`\n=== OPEN ABANDONED CARTS last 5 days (${openCarts?.length ?? 0}) ===\n`);
  for (const cart of openCarts ?? []) {
    const email = (cart.customer_email as string) ?? '';
    const alreadyBought = email ? orderEmails.has(email.toLowerCase()) : false;
    const products = (cart.products as Array<{title: string; price: number}>)?.map(p => p.title).join(', ');

    console.log(`  ${cart.customer_name ?? 'Anónimo'} <${email || 'sin email'}>`);
    console.log(`    Abandoned: ${cart.abandoned_at}`);
    console.log(`    Products: ${products}`);
    console.log(`    Total: €${cart.total_price}`);
    if (alreadyBought) {
      console.log(`    ⚠️  YA COMPRÓ — should be marked recovered`);
    } else if (!email) {
      console.log(`    ⚠️  Sin email — no se puede contactar`);
    } else {
      console.log(`    ✅ OPORTUNIDAD — no ha comprado, tiene email`);
    }
    console.log('');
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
