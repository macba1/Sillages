import axios from 'axios';
import { supabase } from '../lib/supabase.js';
import type { ShopifyOrder, ShopifyConnection } from '../lib/shopify.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface MonthlyRevenue {
  month: string;       // "2025-01"
  revenue: number;
  orders: number;
}

interface TopProductAlltime {
  title: string;
  total_revenue: number;
  total_units: number;
  order_count: number;
}

interface TopCustomerAlltime {
  name: string;
  email: string | null;
  total_spent: number;
  order_count: number;
  first_order: string;
  last_order: string;
  favorite_product: string;
}

interface CustomerSegments {
  total: number;
  one_time: number;
  occasional: number;  // 2-3 orders
  regular: number;     // 4-9 orders
  vip: number;         // 10+
}

interface SeasonalPattern {
  month_name: string;
  avg_revenue: number;
  avg_orders: number;
  best_products: string[];
}

interface StoreHistoryData {
  account_id: string;
  total_orders: number;
  total_revenue: number;
  first_order_date: string | null;
  last_order_date: string | null;
  monthly_revenue: MonthlyRevenue[];
  top_products_alltime: TopProductAlltime[];
  top_customers_alltime: TopCustomerAlltime[];
  customer_segments: CustomerSegments;
  seasonal_patterns: SeasonalPattern[];
  synced_at: string;
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function syncFullHistory(accountId: string): Promise<void> {
  const LOG = '[fullHistorySync]';
  console.log(`${LOG} Starting full history sync for account ${accountId}`);

  // 1. Get connection
  const { data: connection, error: connError } = await supabase
    .from('shopify_connections')
    .select('*')
    .eq('account_id', accountId)
    .single();

  if (connError || !connection) {
    throw new Error(`${LOG} No Shopify connection for account ${accountId}`);
  }

  const conn = connection as ShopifyConnection;
  console.log(`${LOG} Shop: ${conn.shop_domain}`);

  // 2. Check if recently synced (within 7 days)
  const { data: existing } = await supabase
    .from('store_history')
    .select('synced_at')
    .eq('account_id', accountId)
    .maybeSingle();

  if (existing?.synced_at) {
    const syncedAt = new Date(existing.synced_at).getTime();
    const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
    if (syncedAt > sevenDaysAgo) {
      console.log(`${LOG} Already synced ${existing.synced_at} (within 7 days) — skipping`);
      return;
    }
  }

  // 3. Fetch ALL orders via cursor pagination
  const allOrders = await fetchAllHistoricalOrders(conn.shop_domain, conn.access_token);
  console.log(`${LOG} Total orders fetched: ${allOrders.length}`);

  if (allOrders.length === 0) {
    console.log(`${LOG} No orders found — saving empty history`);
    await upsertStoreHistory({
      account_id: accountId,
      total_orders: 0,
      total_revenue: 0,
      first_order_date: null,
      last_order_date: null,
      monthly_revenue: [],
      top_products_alltime: [],
      top_customers_alltime: [],
      customer_segments: { total: 0, one_time: 0, occasional: 0, regular: 0, vip: 0 },
      seasonal_patterns: [],
      synced_at: new Date().toISOString(),
    });
    return;
  }

  // 4. Process all orders
  const completedOrders = allOrders.filter(
    (o) => o.financial_status !== 'voided' && o.cancel_reason === null,
  );

  const totalRevenue = completedOrders.reduce(
    (sum, o) => sum + parseFloat(o.total_price),
    0,
  );

  // Sort by date to get first/last
  const sortedByDate = [...allOrders].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const firstOrderDate = sortedByDate[0].created_at;
  const lastOrderDate = sortedByDate[sortedByDate.length - 1].created_at;

  // Monthly revenue
  const monthlyMap = new Map<string, { revenue: number; orders: number }>();
  for (const order of completedOrders) {
    const month = order.created_at.slice(0, 7); // "2025-01"
    const entry = monthlyMap.get(month) ?? { revenue: 0, orders: 0 };
    entry.revenue += parseFloat(order.total_price);
    entry.orders += 1;
    monthlyMap.set(month, entry);
  }
  const monthlyRevenue: MonthlyRevenue[] = Array.from(monthlyMap.entries())
    .map(([month, data]) => ({ month, revenue: round2(data.revenue), orders: data.orders }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // Top products all-time
  const productMap = new Map<string, { title: string; total_revenue: number; total_units: number; order_ids: Set<string> }>();
  for (const order of completedOrders) {
    for (const item of order.line_items) {
      const key = String(item.product_id);
      const existing = productMap.get(key);
      if (existing) {
        existing.total_revenue += parseFloat(item.price) * item.quantity;
        existing.total_units += item.quantity;
        existing.order_ids.add(String(order.id));
      } else {
        productMap.set(key, {
          title: item.title,
          total_revenue: parseFloat(item.price) * item.quantity,
          total_units: item.quantity,
          order_ids: new Set([String(order.id)]),
        });
      }
    }
  }
  const topProductsAlltime: TopProductAlltime[] = Array.from(productMap.values())
    .map((p) => ({
      title: p.title,
      total_revenue: round2(p.total_revenue),
      total_units: p.total_units,
      order_count: p.order_ids.size,
    }))
    .sort((a, b) => b.total_revenue - a.total_revenue)
    .slice(0, 20);

  // Top customers all-time
  const customerMap = new Map<number, {
    name: string;
    email: string | null;
    total_spent: number;
    order_count: number;
    first_order: string;
    last_order: string;
    product_counts: Map<string, number>;
  }>();
  for (const order of completedOrders) {
    if (!order.customer) continue;
    const cid = order.customer.id;
    const existing = customerMap.get(cid);
    const orderDate = order.created_at;

    if (existing) {
      existing.total_spent += parseFloat(order.total_price);
      existing.order_count += 1;
      if (orderDate < existing.first_order) existing.first_order = orderDate;
      if (orderDate > existing.last_order) existing.last_order = orderDate;
      for (const item of order.line_items) {
        existing.product_counts.set(
          item.title,
          (existing.product_counts.get(item.title) ?? 0) + item.quantity,
        );
      }
    } else {
      const productCounts = new Map<string, number>();
      for (const item of order.line_items) {
        productCounts.set(item.title, (productCounts.get(item.title) ?? 0) + item.quantity);
      }
      const firstName = order.customer.first_name ?? '';
      const lastName = order.customer.last_name ?? '';
      customerMap.set(cid, {
        name: `${firstName} ${lastName}`.trim() || 'Unknown',
        email: order.customer.email,
        total_spent: parseFloat(order.total_price),
        order_count: 1,
        first_order: orderDate,
        last_order: orderDate,
        product_counts: productCounts,
      });
    }
  }
  const topCustomersAlltime: TopCustomerAlltime[] = Array.from(customerMap.values())
    .map((c) => {
      // Find favorite product (most purchased by quantity)
      let favoriteProduct = 'Unknown';
      let maxQty = 0;
      for (const [title, qty] of c.product_counts) {
        if (qty > maxQty) { maxQty = qty; favoriteProduct = title; }
      }
      return {
        name: c.name,
        email: c.email,
        total_spent: round2(c.total_spent),
        order_count: c.order_count,
        first_order: c.first_order,
        last_order: c.last_order,
        favorite_product: favoriteProduct,
      };
    })
    .sort((a, b) => b.total_spent - a.total_spent)
    .slice(0, 50);

  // Customer segments
  const totalCustomers = customerMap.size;
  let oneTime = 0, occasional = 0, regular = 0, vip = 0;
  for (const c of customerMap.values()) {
    if (c.order_count === 1) oneTime++;
    else if (c.order_count <= 3) occasional++;
    else if (c.order_count <= 9) regular++;
    else vip++;
  }
  const customerSegments: CustomerSegments = {
    total: totalCustomers,
    one_time: oneTime,
    occasional,
    regular,
    vip,
  };

  // Seasonal patterns — group by month-of-year (1-12)
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  const seasonalMap = new Map<number, { revenue: number; orders: number; years: Set<string>; products: Map<string, number> }>();
  for (const order of completedOrders) {
    const date = new Date(order.created_at);
    const monthIdx = date.getUTCMonth(); // 0-11
    const yearStr = String(date.getUTCFullYear());

    const entry = seasonalMap.get(monthIdx) ?? { revenue: 0, orders: 0, years: new Set(), products: new Map() };
    entry.revenue += parseFloat(order.total_price);
    entry.orders += 1;
    entry.years.add(yearStr);
    for (const item of order.line_items) {
      entry.products.set(item.title, (entry.products.get(item.title) ?? 0) + parseFloat(item.price) * item.quantity);
    }
    seasonalMap.set(monthIdx, entry);
  }

  const seasonalPatterns: SeasonalPattern[] = Array.from(seasonalMap.entries())
    .map(([monthIdx, data]) => {
      const yearCount = data.years.size || 1;
      // Top 3 products by revenue for this month
      const bestProducts = Array.from(data.products.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([title]) => title);

      return {
        month_name: MONTH_NAMES[monthIdx],
        avg_revenue: round2(data.revenue / yearCount),
        avg_orders: round2(data.orders / yearCount),
        best_products: bestProducts,
      };
    })
    .sort((a, b) => MONTH_NAMES.indexOf(a.month_name) - MONTH_NAMES.indexOf(b.month_name));

  // 5. Save
  await upsertStoreHistory({
    account_id: accountId,
    total_orders: completedOrders.length,
    total_revenue: round2(totalRevenue),
    first_order_date: firstOrderDate,
    last_order_date: lastOrderDate,
    monthly_revenue: monthlyRevenue,
    top_products_alltime: topProductsAlltime,
    top_customers_alltime: topCustomersAlltime,
    customer_segments: customerSegments,
    seasonal_patterns: seasonalPatterns,
    synced_at: new Date().toISOString(),
  });

  // 6. Summary
  console.log(`${LOG} === SYNC COMPLETE ===`);
  console.log(`${LOG}   Orders: ${completedOrders.length} (of ${allOrders.length} total incl. cancelled/voided)`);
  console.log(`${LOG}   Revenue: ${round2(totalRevenue)}`);
  console.log(`${LOG}   Period: ${firstOrderDate.slice(0, 10)} → ${lastOrderDate.slice(0, 10)}`);
  console.log(`${LOG}   Months: ${monthlyRevenue.length}`);
  console.log(`${LOG}   Unique customers: ${totalCustomers}`);
  console.log(`${LOG}   Segments: 1x=${oneTime} occasional=${occasional} regular=${regular} VIP=${vip}`);
  console.log(`${LOG}   Top product: ${topProductsAlltime[0]?.title ?? 'N/A'}`);
}

// ── Fetch all historical orders with cursor pagination ───────────────────────

async function fetchAllHistoricalOrders(shopDomain: string, accessToken: string): Promise<ShopifyOrder[]> {
  const LOG = '[fullHistorySync]';
  const allOrders: ShopifyOrder[] = [];
  // created_at_min is required to get orders older than 60 days (even with read_all_orders scope)
  let url: string | null = `https://${shopDomain}/admin/api/2024-04/orders.json?status=any&limit=250&created_at_min=2010-01-01T00:00:00Z`;

  while (url) {
    let response;
    try {
      response = await axios.get(url, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 429) {
        // Rate limited — wait and retry
        const retryAfter = parseFloat(err.response.headers['retry-after'] ?? '2') * 1000;
        console.log(`${LOG} Rate limited (429) — waiting ${retryAfter}ms`);
        await sleep(retryAfter);
        continue; // retry same URL
      }
      throw err;
    }

    const orders = response.data.orders as ShopifyOrder[];
    allOrders.push(...orders);

    if (allOrders.length % 500 < 250 && allOrders.length >= 500) {
      console.log(`${LOG} Progress: ${allOrders.length} orders fetched...`);
    }

    // Parse Link header for next page
    const linkHeader = response.headers['link'] as string | undefined;
    url = null;
    if (linkHeader) {
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (nextMatch) {
        url = nextMatch[1];
      }
    }

    // Respect rate limits: wait between requests
    if (url) await sleep(550);
  }

  return allOrders;
}

// ── Upsert to store_history ──────────────────────────────────────────────────

async function upsertStoreHistory(data: StoreHistoryData): Promise<void> {
  const LOG = '[fullHistorySync]';

  const { error } = await supabase
    .from('store_history')
    .upsert(data, { onConflict: 'account_id' });

  if (error) {
    console.error(`${LOG} Failed to save store_history:`, error.message);
    throw new Error(`Failed to save store_history: ${error.message}`);
  }

  console.log(`${LOG} store_history saved for account ${data.account_id}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
