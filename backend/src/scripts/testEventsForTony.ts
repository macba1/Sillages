import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { shopifyClient } from '../lib/shopify.js';
import type { ShopifyOrder } from '../lib/shopify.js';
import type { DetectedEvent, NewFirstBuyerData, AbandonedCartData, OverdueCustomerData } from '../services/eventDetector.js';
import { generateEventAction } from '../services/eventActionGenerator.js';
import { sendPushNotification } from '../services/pushNotifier.js';

/**
 * Test event-driven flow using NICOLINA's REAL Shopify data,
 * but saving actions to Tony's account and sending push to Tony.
 *
 * Uses relaxed thresholds to find real data that would normally
 * not trigger (e.g. 2-order customers instead of 3+).
 * This is a TEST SCRIPT — production detector has stricter rules.
 */

const ANDREA_EMAIL = 'andrea@nicolina.es';
const TONY_EMAIL = 'tony@richmondpartner.com';

async function main() {
  // ── Get both accounts ──
  const [{ data: andrea }, { data: tony }] = await Promise.all([
    supabase.from('accounts').select('id, language, full_name').eq('email', ANDREA_EMAIL).single(),
    supabase.from('accounts').select('id, language, full_name').eq('email', TONY_EMAIL).single(),
  ]);

  if (!andrea) { console.error('Andrea account not found'); process.exit(1); }
  if (!tony) { console.error('Tony account not found'); process.exit(1); }

  // ── Get NICOLINA Shopify connection ──
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token, shop_name, shop_currency')
    .eq('account_id', andrea.id)
    .single();

  if (!conn) { console.error('No Shopify connection for NICOLINA'); process.exit(1); }

  const storeName = conn.shop_name ?? 'NICOLINA';
  const currency = conn.shop_currency ?? 'EUR';
  const cs = currency === 'EUR' ? '€' : '$';
  const lang: 'en' | 'es' = andrea.language === 'es' ? 'es' : 'en';

  console.log(`\nStore: ${storeName} | ${currency} | ${lang}`);
  console.log(`Source: Andrea (${andrea.id})`);
  console.log(`Target: Tony (${tony.id})\n`);

  const client = shopifyClient(conn.shop_domain, conn.access_token);
  const events: DetectedEvent[] = [];

  // ══════════════════════════════════════════════════════════════════
  // Fetch 60 days of real Shopify orders
  // ══════════════════════════════════════════════════════════════════
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();
  let allOrders: ShopifyOrder[] = [];
  let pageInfo: string | undefined;

  do {
    const result = await client.getOrders({
      created_at_min: sixtyDaysAgo,
      created_at_max: new Date().toISOString(),
      page_info: pageInfo,
    });
    allOrders.push(...result.orders);
    pageInfo = result.nextPageInfo;
  } while (pageInfo);

  const validOrders = allOrders.filter(o => o.financial_status !== 'voided' && !o.cancel_reason);
  console.log(`Fetched ${validOrders.length} valid orders (60 days)\n`);

  // ══════════════════════════════════════════════════════════════════
  // EVENT 1: Most recent first-time buyer (any from last 30 days)
  // In production this is 24h — we use 30d for testing
  // ══════════════════════════════════════════════════════════════════
  console.log('─── EVENT 1: First-time buyer ───');

  // Find last order from a customer who had orders_count === 1 at time of order
  // Since Shopify now reports their current orders_count (which may have grown),
  // we look for customers with only 1 order in our 60-day window
  const customerOrders = new Map<string, ShopifyOrder[]>();
  for (const o of validOrders) {
    const email = o.customer?.email;
    if (!email) continue;
    if (!customerOrders.has(email)) customerOrders.set(email, []);
    customerOrders.get(email)!.push(o);
  }

  // Find someone with exactly 1 order (recent one-time buyer)
  let firstBuyerOrder: ShopifyOrder | null = null;
  for (const [, orders] of customerOrders) {
    if (orders.length === 1) {
      const o = orders[0];
      if (!firstBuyerOrder || new Date(o.created_at) > new Date(firstBuyerOrder.created_at)) {
        firstBuyerOrder = o;
      }
    }
  }

  if (firstBuyerOrder) {
    const name = `${firstBuyerOrder.customer!.first_name ?? ''} ${firstBuyerOrder.customer!.last_name ?? ''}`.trim() || 'Cliente';
    const d: NewFirstBuyerData = {
      customer_name: name,
      customer_email: firstBuyerOrder.customer!.email!,
      product_purchased: firstBuyerOrder.line_items[0]?.title ?? '',
      order_total: parseFloat(firstBuyerOrder.total_price),
      order_id: String(firstBuyerOrder.id),
      order_created_at: firstBuyerOrder.created_at,
    };
    events.push({ type: 'new_first_buyer', key: `test:order:${firstBuyerOrder.id}`, data: d });
    console.log(`  ${name} compró ${d.product_purchased} (${cs}${d.order_total}) el ${firstBuyerOrder.created_at.slice(0, 10)}`);
  } else {
    console.log('  (ningún cliente con 1 solo pedido en 60d)');
  }

  // ══════════════════════════════════════════════════════════════════
  // EVENT 2: Simulated abandoned cart using real product data
  // (NICOLINA has 0 carts in DB, so we build one from a real order)
  // ══════════════════════════════════════════════════════════════════
  console.log('\n─── EVENT 2: Abandoned cart (simulado con producto real) ───');

  // Pick a recent order and pretend those products were left in a cart
  const recentOrder = validOrders.find(o => o.customer?.email && o.line_items.length > 0);
  if (recentOrder) {
    const name = `${recentOrder.customer!.first_name ?? ''} ${recentOrder.customer!.last_name ?? ''}`.trim() || 'Cliente';
    const d: AbandonedCartData = {
      customer_name: name,
      customer_email: recentOrder.customer!.email!,
      products: recentOrder.line_items.map(li => ({
        title: li.title,
        quantity: li.quantity,
        price: parseFloat(li.price),
      })),
      total_value: parseFloat(recentOrder.total_price),
      checkout_url: '',
      checkout_id: `test-${recentOrder.id}`,
    };
    events.push({ type: 'abandoned_cart', key: `test:cart:${recentOrder.id}`, data: d });
    console.log(`  ${name} — ${cs}${d.total_value} (${d.products.map(p => p.title).join(', ')})`);
  }

  // ══════════════════════════════════════════════════════════════════
  // EVENT 3: Overdue customer (relaxed to 2+ orders for testing)
  // ══════════════════════════════════════════════════════════════════
  console.log('\n─── EVENT 3: Overdue customers ───');

  const custMap = new Map<string, {
    name: string; email: string;
    orders: Array<{ date: string; total: number; products: string[] }>;
    product_counts: Map<string, number>;
  }>();

  for (const order of validOrders) {
    const email = order.customer?.email;
    if (!email) continue;
    const custId = String(order.customer!.id);

    if (!custMap.has(custId)) {
      custMap.set(custId, {
        name: `${order.customer!.first_name ?? ''} ${order.customer!.last_name ?? ''}`.trim() || 'Cliente',
        email,
        orders: [],
        product_counts: new Map(),
      });
    }

    const cust = custMap.get(custId)!;
    cust.orders.push({
      date: order.created_at,
      total: parseFloat(order.total_price),
      products: order.line_items.map(li => li.title),
    });

    for (const li of order.line_items) {
      cust.product_counts.set(li.title, (cust.product_counts.get(li.title) ?? 0) + li.quantity);
    }
  }

  const now = Date.now();
  for (const [, cust] of custMap) {
    // For testing: 2+ orders, 14+ days since last
    if (cust.orders.length < 2) continue;

    const sorted = cust.orders.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push((new Date(sorted[i].date).getTime() - new Date(sorted[i - 1].date).getTime()) / 86400000);
    }
    const avgCycle = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    const daysSince = Math.floor((now - new Date(sorted[sorted.length - 1].date).getTime()) / 86400000);

    // For testing: overdue if 14+ days since last purchase
    if (daysSince >= 14) {
      const favoriteProduct = [...cust.product_counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
      const totalSpent = sorted.reduce((s, o) => s + o.total, 0);

      const d: OverdueCustomerData = {
        customer_name: cust.name,
        customer_email: cust.email,
        last_product: favoriteProduct,
        days_since: daysSince,
        usual_cycle_days: avgCycle,
        total_spent: Math.round(totalSpent * 100) / 100,
      };

      events.push({ type: 'overdue_customer', key: `test:overdue:${cust.email}`, data: d });
      console.log(`  ${cust.name} — ${daysSince}d sin comprar (ciclo: ${avgCycle}d, ${cust.orders.length} pedidos, ${cs}${totalSpent.toFixed(0)} total)`);

      if (events.filter(e => e.type === 'overdue_customer').length >= 2) break; // max 2
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // GENERATE ACTIONS → TONY'S ACCOUNT
  // ══════════════════════════════════════════════════════════════════
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${events.length} eventos → Generando acciones con IA...`);
  console.log(`${'═'.repeat(60)}\n`);

  // Clean Tony's old pending actions
  await supabase.from('pending_actions').delete().eq('account_id', tony.id).eq('status', 'pending');

  const generated: Array<{ actionId: string; event: DetectedEvent }> = [];

  for (const event of events) {
    const typeName = event.type === 'new_first_buyer' ? 'welcome_email'
      : event.type === 'abandoned_cart' ? 'cart_recovery' : 'reactivation_email';
    const custName = (event.data as any).customer_name;

    process.stdout.write(`  ${typeName} para ${custName}... `);
    const actionId = await generateEventAction(tony.id, event, lang, storeName, currency, andrea.id);

    if (actionId) {
      generated.push({ actionId, event });
      console.log(`OK (${actionId.slice(0, 8)})`);
    } else {
      console.log('FALLO');
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // SEND PUSH NOTIFICATIONS → TONY
  // ══════════════════════════════════════════════════════════════════
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Enviando push notifications a Tony...');
  console.log(`${'═'.repeat(60)}\n`);

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('account_id', tony.id);

  if (!subs || subs.length === 0) {
    console.log('  Tony no tiene push subscriptions.');
    console.log('  Las acciones están guardadas — ábrelas en /actions.\n');
  } else {
    console.log(`  ${subs.length} subscription(s)\n`);

    for (const { actionId, event } of generated) {
      const push = buildEventPush(event, lang, storeName, currency, actionId);
      console.log(`  PUSH: ${push.title}`);
      console.log(`  BODY: ${push.body}`);
      console.log(`  URL:  ${push.url}`);

      await sendPushNotification(tony.id, push);
      console.log(`  → Enviada\n`);

      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`${'═'.repeat(60)}`);
  console.log(`  LISTO — ${generated.length} acciones en /actions de Tony`);
  console.log(`${'═'.repeat(60)}\n`);
}

function buildEventPush(
  event: DetectedEvent, lang: 'en' | 'es', storeName: string, currency: string, actionId: string,
): { title: string; body: string; url: string } {
  const isEs = lang === 'es';
  const cs = currency === 'EUR' ? '€' : '$';

  switch (event.type) {
    case 'new_first_buyer': {
      const d = event.data as NewFirstBuyerData;
      return {
        title: storeName,
        body: isEs
          ? `${d.customer_name} compró ${d.product_purchased} por primera vez. ¿Le mandamos un agradecimiento?`
          : `${d.customer_name} bought ${d.product_purchased} for the first time. Send a thank you?`,
        url: `/actions?highlight=${actionId}`,
      };
    }
    case 'abandoned_cart': {
      const d = event.data as AbandonedCartData;
      const productNames = d.products.map(p => p.title).join(', ');
      return {
        title: storeName,
        body: isEs
          ? `${d.customer_name} dejó ${cs}${d.total_value.toFixed(0)} en su carrito (${productNames}). ¿La recuperamos?`
          : `${d.customer_name} left ${cs}${d.total_value.toFixed(0)} in their cart (${productNames}). Recover it?`,
        url: `/actions?highlight=${actionId}`,
      };
    }
    case 'overdue_customer': {
      const d = event.data as OverdueCustomerData;
      return {
        title: storeName,
        body: isEs
          ? `${d.customer_name} no compra desde hace ${d.days_since} días. Suele comprar cada ${d.usual_cycle_days}. ¿Le escribimos?`
          : `${d.customer_name} hasn't bought in ${d.days_since} days. Usually buys every ${d.usual_cycle_days}. Reach out?`,
        url: `/actions?highlight=${actionId}`,
      };
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
