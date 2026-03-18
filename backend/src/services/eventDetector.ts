import { supabase } from '../lib/supabase.js';
import { shopifyClient } from '../lib/shopify.js';
import type { ShopifyOrder } from '../lib/shopify.js';

const LOG = '[eventDetector]';

// ── Event types ─────────────────────────────────────────────────────────────

export interface DetectedEvent {
  type: 'new_first_buyer' | 'abandoned_cart' | 'overdue_customer';
  key: string; // dedup key
  data: NewFirstBuyerData | AbandonedCartData | OverdueCustomerData;
}

export interface NewFirstBuyerData {
  customer_name: string;
  customer_email: string;
  product_purchased: string;
  order_total: number;
  order_id: string;
}

export interface AbandonedCartData {
  customer_name: string;
  customer_email: string;
  products: Array<{ title: string; quantity: number; price: number; image_url?: string }>;
  total_value: number;
  checkout_url: string;
  checkout_id: string;
}

export interface OverdueCustomerData {
  customer_name: string;
  customer_email: string;
  last_product: string;
  days_since: number;
  usual_cycle_days: number;
  total_spent: number;
}

// ── Detect all events for an account ────────────────────────────────────────

export async function detectEvents(accountId: string): Promise<DetectedEvent[]> {
  const events: DetectedEvent[] = [];

  const [firstBuyers, carts, overdue] = await Promise.all([
    detectNewFirstBuyers(accountId),
    detectNewAbandonedCarts(accountId),
    detectOverdueCustomers(accountId),
  ]);

  events.push(...firstBuyers, ...carts, ...overdue);

  // Check if any new orders match abandoned cart customers → mark as recovered
  await detectCartRecoveries(accountId);

  return events;
}

// ── Cart recovery detection ─────────────────────────────────────────────────
// When a customer who had an abandoned cart places an order, mark the cart as recovered.

async function detectCartRecoveries(accountId: string): Promise<void> {
  try {
    // Get unrecovered abandoned carts from the last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const { data: openCarts } = await supabase
      .from('abandoned_carts')
      .select('id, customer_email, total_price')
      .eq('account_id', accountId)
      .or('recovered.is.null,recovered.eq.false')
      .gte('abandoned_at', thirtyDaysAgo);

    if (!openCarts || openCarts.length === 0) return;

    // Get recent orders (last 48h) to cross-reference
    const { data: conn } = await supabase
      .from('shopify_connections')
      .select('shop_domain, access_token')
      .eq('account_id', accountId)
      .single();

    if (!conn) return;

    const client = shopifyClient(conn.shop_domain, conn.access_token);
    const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const { orders } = await client.getOrders({
      created_at_min: since,
      created_at_max: new Date().toISOString(),
    });

    const orderEmails = new Set(
      orders
        .filter(o => o.customer?.email && o.financial_status !== 'voided' && !o.cancel_reason)
        .map(o => o.customer!.email!.toLowerCase()),
    );

    // Find cart_recovery actions that generated emails (completed with sent_to)
    const { data: recoveryActions } = await supabase
      .from('pending_actions')
      .select('id, content, executed_at, result')
      .eq('account_id', accountId)
      .eq('type', 'cart_recovery')
      .eq('status', 'completed');

    const actionByEmail = new Map<string, { id: string; executed_at: string | null; sent_to: string | null }>();
    if (recoveryActions) {
      for (const a of recoveryActions) {
        const email = String((a.content as Record<string, unknown>).customer_email ?? '').toLowerCase();
        const result = a.result as Record<string, unknown> | null;
        const sentTo = result?.sent_to as string | null;
        if (email) actionByEmail.set(email, { id: a.id, executed_at: a.executed_at, sent_to: sentTo });
      }
    }

    // Mark matching carts as recovered — with honest attribution
    for (const cart of openCarts) {
      if (!cart.customer_email) continue;
      const email = cart.customer_email.toLowerCase();

      if (orderEmails.has(email)) {
        const matchingOrder = orders.find(
          o => o.customer?.email?.toLowerCase() === email &&
               o.financial_status !== 'voided' && !o.cancel_reason,
        );

        const revenue = matchingOrder ? parseFloat(matchingOrder.total_price) : cart.total_price;
        const orderId = matchingOrder ? String(matchingOrder.id) : null;
        const action = actionByEmail.get(email);
        const actionId = action?.id ?? null;

        // Attribution: only "by_sillages" if we sent an email BEFORE the purchase
        let attribution: 'by_sillages' | 'organic' = 'organic';
        if (action?.sent_to && action.executed_at && matchingOrder) {
          const emailSentAt = new Date(action.executed_at).getTime();
          const orderCreatedAt = new Date(matchingOrder.created_at).getTime();
          if (emailSentAt < orderCreatedAt) {
            attribution = 'by_sillages';
          }
        }

        await supabase
          .from('abandoned_carts')
          .update({
            recovered: true,
            recovered_at: new Date().toISOString(),
            recovery_order_id: orderId,
            recovery_revenue: revenue,
            recovery_action_id: actionId,
            recovery_attribution: attribution,
          })
          .eq('id', cart.id);

        console.log(`${LOG} Cart recovered: ${email} → order ${orderId} (€${revenue}) [${attribution}]`);
      }
    }
  } catch (err) {
    console.warn(`${LOG} Cart recovery detection failed: ${(err as Error).message}`);
  }
}

// ── 1. New first-time buyers ────────────────────────────────────────────────

async function detectNewFirstBuyers(accountId: string): Promise<DetectedEvent[]> {
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token')
    .eq('account_id', accountId)
    .single();

  if (!conn) return [];

  const client = shopifyClient(conn.shop_domain, conn.access_token);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  let orders: ShopifyOrder[];
  try {
    const result = await client.getOrders({
      created_at_min: since,
      created_at_max: new Date().toISOString(),
    });
    orders = result.orders;
  } catch {
    console.warn(`${LOG} Failed to fetch recent orders for ${accountId}`);
    return [];
  }

  // Filter first-time buyers (orders_count === 1 on the customer)
  const firstTimers = orders.filter(o =>
    o.customer &&
    o.customer.orders_count === 1 &&
    o.customer.email &&
    o.financial_status !== 'voided' &&
    !o.cancel_reason,
  );

  const events: DetectedEvent[] = [];

  for (const order of firstTimers) {
    const key = `order:${order.id}`;
    const alreadyLogged = await tryLogEvent(accountId, 'new_first_buyer', key);
    if (!alreadyLogged) continue; // already detected

    const name = `${order.customer!.first_name ?? ''} ${order.customer!.last_name ?? ''}`.trim() || 'Cliente';
    const topProduct = order.line_items[0]?.title ?? '';

    events.push({
      type: 'new_first_buyer',
      key,
      data: {
        customer_name: name,
        customer_email: order.customer!.email!,
        product_purchased: topProduct,
        order_total: parseFloat(order.total_price),
        order_id: String(order.id),
      } as NewFirstBuyerData,
    });
  }

  if (events.length > 0) {
    console.log(`${LOG} Detected ${events.length} new first-time buyer(s)`);
  }

  return events;
}

// ── 2. New abandoned carts ──────────────────────────────────────────────────

async function detectNewAbandonedCarts(accountId: string): Promise<DetectedEvent[]> {
  // Read from abandoned_carts table (populated by abandonedCartsSync)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const { data: carts } = await supabase
    .from('abandoned_carts')
    .select('*')
    .eq('account_id', accountId)
    .or('recovered.is.null,recovered.eq.false')
    .gte('abandoned_at', sevenDaysAgo)
    .order('abandoned_at', { ascending: false })
    .limit(10);

  if (!carts || carts.length === 0) return [];

  // Get recent orders to filter out customers who already bought
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token')
    .eq('account_id', accountId)
    .single();

  let recentOrderEmails = new Set<string>();
  if (conn) {
    try {
      const client = shopifyClient(conn.shop_domain, conn.access_token);
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
      const { orders } = await client.getOrders({
        created_at_min: sevenDaysAgo,
        created_at_max: new Date().toISOString(),
      });
      recentOrderEmails = new Set(
        orders
          .filter(o => o.customer?.email && o.financial_status !== 'voided' && !o.cancel_reason)
          .map(o => o.customer!.email!.toLowerCase()),
      );
    } catch (err) {
      console.warn(`${LOG} Failed to fetch orders for cart filter: ${(err as Error).message}`);
    }
  }

  const events: DetectedEvent[] = [];

  for (const cart of carts) {
    const checkoutId = (cart.shopify_checkout_id as string) ?? String(cart.id);
    const key = `cart:${checkoutId}`;
    const alreadyLogged = await tryLogEvent(accountId, 'abandoned_cart', key);
    if (!alreadyLogged) continue;

    const email = (cart.customer_email as string) ?? '';
    if (!email) continue; // skip anonymous carts

    // Skip if customer already placed an order (they recovered on their own)
    if (recentOrderEmails.has(email.toLowerCase())) {
      console.log(`${LOG} Skipping cart for ${email} — customer already purchased`);
      // Mark cart as recovered
      await supabase
        .from('abandoned_carts')
        .update({ recovered: true, recovered_at: new Date().toISOString() })
        .eq('id', cart.id);
      continue;
    }

    events.push({
      type: 'abandoned_cart',
      key,
      data: {
        customer_name: (cart.customer_name as string) ?? 'Visitante',
        customer_email: email,
        products: (cart.products as Array<{ title: string; quantity: number; price: number; image_url?: string }>) ?? [],
        total_value: cart.total_price as number,
        checkout_url: (cart.checkout_url as string) ?? '',
        checkout_id: checkoutId,
      } as AbandonedCartData,
    });
  }

  if (events.length > 0) {
    console.log(`${LOG} Detected ${events.length} new abandoned cart(s)`);
  }

  return events;
}

// ── 3. Overdue customers ────────────────────────────────────────────────────

async function detectOverdueCustomers(accountId: string): Promise<DetectedEvent[]> {
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token')
    .eq('account_id', accountId)
    .single();

  if (!conn) return [];

  const client = shopifyClient(conn.shop_domain, conn.access_token);
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400 * 1000).toISOString();

  // Fetch 60 days of orders for customer analysis
  let allOrders: ShopifyOrder[] = [];
  let pageInfo: string | undefined;

  try {
    do {
      const result = await client.getOrders({
        created_at_min: sixtyDaysAgo,
        created_at_max: new Date().toISOString(),
        page_info: pageInfo,
      });
      allOrders.push(...result.orders);
      pageInfo = result.nextPageInfo;
    } while (pageInfo);
  } catch {
    console.warn(`${LOG} Failed to fetch orders for overdue detection`);
    return [];
  }

  const validOrders = allOrders.filter(
    o => o.financial_status !== 'voided' && !o.cancel_reason,
  );

  // Build customer profiles
  const customerMap = new Map<string, {
    name: string;
    email: string;
    orders: Array<{ date: string; total: number; products: string[] }>;
    product_counts: Map<string, number>;
  }>();

  for (const order of validOrders) {
    const email = order.customer?.email;
    if (!email) continue;
    const custId = String(order.customer!.id);

    if (!customerMap.has(custId)) {
      const firstName = order.customer!.first_name ?? '';
      const lastName = order.customer!.last_name ?? '';
      customerMap.set(custId, {
        name: `${firstName} ${lastName}`.trim() || 'Cliente',
        email,
        orders: [],
        product_counts: new Map(),
      });
    }

    const cust = customerMap.get(custId)!;
    cust.orders.push({
      date: order.created_at,
      total: parseFloat(order.total_price),
      products: order.line_items.map(li => li.title),
    });

    for (const li of order.line_items) {
      cust.product_counts.set(li.title, (cust.product_counts.get(li.title) ?? 0) + li.quantity);
    }
  }

  // Find overdue repeat customers
  const events: DetectedEvent[] = [];
  const now = Date.now();

  for (const [, cust] of customerMap) {
    if (cust.orders.length < 3) continue; // need 3+ orders for a reliable purchase cycle

    const sorted = cust.orders.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push((new Date(sorted[i].date).getTime() - new Date(sorted[i - 1].date).getTime()) / 86400000);
    }
    const avgCycle = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    const lastOrder = sorted[sorted.length - 1];
    const daysSince = Math.floor((now - new Date(lastOrder.date).getTime()) / 86400000);

    // Overdue: more than 50% past their cycle
    if (daysSince > avgCycle * 1.5 && daysSince >= 14) {
      const key = `overdue:${cust.email}`;

      // Only alert once per 7 days per customer
      const { data: recent } = await supabase
        .from('event_log')
        .select('id')
        .eq('account_id', accountId)
        .eq('event_type', 'overdue_customer')
        .eq('event_key', key)
        .gte('detected_at', new Date(now - 7 * 86400 * 1000).toISOString())
        .limit(1);

      if (recent && recent.length > 0) continue; // alerted recently

      // Log this event (allow re-insert since we're checking by time window)
      await supabase.from('event_log').insert({
        account_id: accountId,
        event_type: 'overdue_customer',
        event_key: key,
      }).then(() => {}); // ignore conflict

      const favoriteProduct = [...cust.product_counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
      const totalSpent = sorted.reduce((s, o) => s + o.total, 0);

      events.push({
        type: 'overdue_customer',
        key,
        data: {
          customer_name: cust.name,
          customer_email: cust.email,
          last_product: favoriteProduct,
          days_since: daysSince,
          usual_cycle_days: avgCycle,
          total_spent: Math.round(totalSpent * 100) / 100,
        } as OverdueCustomerData,
      });
    }
  }

  if (events.length > 0) {
    console.log(`${LOG} Detected ${events.length} overdue customer(s)`);
  }

  return events.slice(0, 5); // max 5 per check
}

// ── Dedup helper: insert into event_log, returns true if NEW ────────────────

async function tryLogEvent(accountId: string, eventType: string, eventKey: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('event_log')
    .insert({ account_id: accountId, event_type: eventType, event_key: eventKey })
    .select('id')
    .single();

  if (error) {
    // Unique constraint violation = already exists
    if (error.code === '23505') return false;
    // Other error — skip but log
    console.warn(`${LOG} event_log insert error: ${error.message}`);
    return false;
  }

  return !!data;
}
