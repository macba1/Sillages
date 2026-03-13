import { supabase } from '../lib/supabase.js';
import { shopifyClient } from '../lib/shopify.js';
import type { ShopifyOrder, ShopifyAbandonedCheckout } from '../lib/shopify.js';

const LOG = '[customerIntel]';

// ── Public interface ────────────────────────────────────────────────────────

export interface CustomerProfile {
  name: string;
  email: string;
  total_orders: number;
  total_spent: number;
  favorite_product: string;
  avg_days_between_purchases: number | null;
  last_purchase_date: string;
  days_since_last_purchase: number;
  first_purchase_date: string;
  is_repeat: boolean;
}

export interface AbandonedCart {
  customer_name: string;
  customer_email: string;
  products: Array<{ title: string; quantity: number; price: number }>;
  total_value: number;
  abandoned_at: string;
  is_returning_customer: boolean;
}

export interface CustomerIntelligence {
  // Abandoned carts with details
  abandoned_carts: AbandonedCart[];

  // Star customers (top 5 by spend)
  star_customers: Array<CustomerProfile & { rank: number }>;

  // Lost customers (1 purchase, 14+ days ago)
  lost_customers: CustomerProfile[];

  // About to repeat (within 2 days of their usual cycle)
  about_to_repeat: Array<CustomerProfile & { expected_in_days: number }>;

  // Base summary
  total_customers: number;
  repeat_customers: number;
  one_time_customers: number;
  new_this_week: number;

  // Customers who bought yesterday (for the brief)
  yesterday_buyers: Array<{ name: string; products: string[]; total: number; is_repeat: boolean; order_number: number }>;
}

// ── Main function ───────────────────────────────────────────────────────────

export async function buildCustomerIntelligence(
  accountId: string,
  briefDate: string,
): Promise<CustomerIntelligence | null> {
  // Load connection
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token')
    .eq('account_id', accountId)
    .single();

  if (!conn) {
    console.log(`${LOG} No connection for ${accountId}`);
    return null;
  }

  const client = shopifyClient(conn.shop_domain, conn.access_token);
  const briefDateObj = new Date(briefDate + 'T00:00:00Z');
  const sixtyDaysAgo = new Date(briefDateObj.getTime() - 60 * 86400000);
  const sevenDaysAgo = new Date(briefDateObj.getTime() - 7 * 86400000);

  // Fetch all orders from last 60 days
  console.log(`${LOG} Fetching 60 days of orders...`);
  const allOrders: ShopifyOrder[] = [];
  let pageInfo: string | undefined;

  do {
    const result = await client.getOrders({
      created_at_min: sixtyDaysAgo.toISOString(),
      created_at_max: new Date(briefDateObj.getTime() + 86400000).toISOString(),
      page_info: pageInfo,
    });
    allOrders.push(...result.orders);
    pageInfo = result.nextPageInfo;
  } while (pageInfo);

  // Filter to paid, non-cancelled orders
  const validOrders = allOrders.filter(
    o => o.financial_status !== 'voided' && !o.cancel_reason,
  );

  console.log(`${LOG} ${validOrders.length} valid orders from ${allOrders.length} total`);

  // Build customer profiles from orders
  const customerMap = new Map<string, {
    name: string;
    email: string;
    orders: Array<{ date: string; total: number; products: string[] }>;
    product_counts: Map<string, number>;
  }>();

  for (const order of validOrders) {
    const custId = order.customer?.id ? String(order.customer.id) : order.customer?.email ?? `unknown-${order.id}`;
    const firstName = order.customer?.first_name ?? '';
    const lastName = order.customer?.last_name ?? '';
    const name = `${firstName} ${lastName}`.trim() || 'Cliente anónimo';
    const email = order.customer?.email ?? '';

    if (!customerMap.has(custId)) {
      customerMap.set(custId, { name, email, orders: [], product_counts: new Map() });
    }

    const cust = customerMap.get(custId)!;
    const products = order.line_items.map(li => li.title);
    cust.orders.push({
      date: order.created_at,
      total: parseFloat(order.total_price),
      products,
    });

    for (const li of order.line_items) {
      cust.product_counts.set(li.title, (cust.product_counts.get(li.title) ?? 0) + li.quantity);
    }
  }

  // Build profiles
  const profiles: CustomerProfile[] = [];
  for (const [, cust] of customerMap) {
    if (!cust.email) continue; // skip anonymous

    const sortedOrders = cust.orders.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const totalSpent = sortedOrders.reduce((s, o) => s + o.total, 0);
    const favoriteProduct = [...cust.product_counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const lastDate = sortedOrders[sortedOrders.length - 1].date;
    const firstDate = sortedOrders[0].date;
    const daysSinceLast = Math.floor((briefDateObj.getTime() - new Date(lastDate).getTime()) / 86400000);

    let avgDays: number | null = null;
    if (sortedOrders.length >= 2) {
      const gaps: number[] = [];
      for (let i = 1; i < sortedOrders.length; i++) {
        gaps.push((new Date(sortedOrders[i].date).getTime() - new Date(sortedOrders[i - 1].date).getTime()) / 86400000);
      }
      avgDays = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    }

    profiles.push({
      name: cust.name,
      email: cust.email,
      total_orders: sortedOrders.length,
      total_spent: Math.round(totalSpent * 100) / 100,
      favorite_product: favoriteProduct,
      avg_days_between_purchases: avgDays,
      last_purchase_date: lastDate.slice(0, 10),
      days_since_last_purchase: daysSinceLast,
      first_purchase_date: firstDate.slice(0, 10),
      is_repeat: sortedOrders.length > 1,
    });
  }

  // Star customers: top 5 by spend
  const star_customers = profiles
    .sort((a, b) => b.total_spent - a.total_spent)
    .slice(0, 5)
    .map((p, i) => ({ ...p, rank: i + 1 }));

  // Lost customers: 1 purchase, 14+ days ago
  const lost_customers = profiles
    .filter(p => p.total_orders === 1 && p.days_since_last_purchase >= 14)
    .sort((a, b) => b.days_since_last_purchase - a.days_since_last_purchase)
    .slice(0, 10);

  // About to repeat: repeat customers within 2 days of their cycle
  const about_to_repeat = profiles
    .filter(p => {
      if (!p.avg_days_between_purchases || p.total_orders < 2) return false;
      const expected = p.avg_days_between_purchases - p.days_since_last_purchase;
      return expected >= -2 && expected <= 3; // within window
    })
    .map(p => ({
      ...p,
      expected_in_days: (p.avg_days_between_purchases ?? 0) - p.days_since_last_purchase,
    }))
    .sort((a, b) => a.expected_in_days - b.expected_in_days);

  // Yesterday buyers
  const yesterdayStart = new Date(briefDate + 'T00:00:00Z');
  const yesterdayEnd = new Date(briefDate + 'T23:59:59Z');
  const yesterday_buyers = validOrders
    .filter(o => {
      const d = new Date(o.created_at);
      return d >= yesterdayStart && d <= yesterdayEnd;
    })
    .map(o => {
      const name = o.customer
        ? `${o.customer.first_name ?? ''} ${o.customer.last_name ?? ''}`.trim() || 'Anónimo'
        : 'Anónimo';
      const custProfile = profiles.find(p => p.email === o.customer?.email);
      return {
        name,
        products: o.line_items.map(li => li.title),
        total: parseFloat(o.total_price),
        is_repeat: (custProfile?.total_orders ?? 1) > 1,
        order_number: o.id,
      };
    });

  // New this week
  const new_this_week = profiles.filter(p =>
    new Date(p.first_purchase_date) >= sevenDaysAgo && p.total_orders === 1,
  ).length;

  // Abandoned carts
  console.log(`${LOG} Fetching abandoned carts...`);
  let abandonedCheckouts: ShopifyAbandonedCheckout[] = [];
  try {
    abandonedCheckouts = await client.getAbandonedCheckouts({
      created_at_min: new Date(briefDateObj.getTime() - 3 * 86400000).toISOString(),
      created_at_max: new Date(briefDateObj.getTime() + 86400000).toISOString(),
      limit: 20,
    });
  } catch {
    console.log(`${LOG} Could not fetch abandoned carts`);
  }

  const abandoned_carts: AbandonedCart[] = abandonedCheckouts.map(ac => {
    const name = ac.customer
      ? `${ac.customer.first_name ?? ''} ${ac.customer.last_name ?? ''}`.trim() || 'Visitante'
      : 'Visitante';
    const email = ac.customer?.email ?? '';
    const custProfile = profiles.find(p => p.email === email);

    return {
      customer_name: name,
      customer_email: email,
      products: ac.line_items.map(li => ({
        title: li.title,
        quantity: li.quantity,
        price: parseFloat(li.price),
      })),
      total_value: parseFloat(ac.total_price),
      abandoned_at: ac.created_at,
      is_returning_customer: custProfile ? custProfile.total_orders > 0 : false,
    };
  });

  const repeatCustomers = profiles.filter(p => p.total_orders > 1).length;
  const oneTimeCustomers = profiles.filter(p => p.total_orders === 1).length;

  console.log(`${LOG} Done — ${profiles.length} customers, ${star_customers.length} stars, ${lost_customers.length} lost, ${about_to_repeat.length} about to repeat, ${abandoned_carts.length} abandoned carts`);

  return {
    abandoned_carts,
    star_customers,
    lost_customers,
    about_to_repeat,
    total_customers: profiles.length,
    repeat_customers: repeatCustomers,
    one_time_customers: oneTimeCustomers,
    new_this_week,
    yesterday_buyers,
  };
}
