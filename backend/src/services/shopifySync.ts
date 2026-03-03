import { subDays, startOfDay, endOfDay, formatISO, format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { supabase } from '../lib/supabase.js';
import { shopifyClient } from '../lib/shopify.js';
import type { ShopifyOrder, ShopifyConnection } from '../lib/shopify.js';
import type { TopProduct } from '../types.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface SyncResult {
  snapshotId: string;
  snapshotDate: string;
}

interface WowComparison {
  revenuePct: number | null;
  ordersPct: number | null;
  aovPct: number | null;
  conversionPct: number | null;
  newCustomersPct: number | null;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function syncYesterdayForAccount(accountId: string): Promise<SyncResult> {
  // Load connection
  const { data: connection, error: connError } = await supabase
    .from('shopify_connections')
    .select('*')
    .eq('account_id', accountId)
    .eq('sync_status', 'active')
    .single();

  if (connError || !connection) {
    throw new Error(`No active Shopify connection for account ${accountId}`);
  }

  const conn = connection as ShopifyConnection;

  // Determine yesterday in the shop's timezone.
  // conn.shop_timezone may be a Shopify/Rails name ("Eastern Time (US & Canada)")
  // rather than an IANA name ("America/New_York"). date-fns-tz requires IANA, so
  // we validate and fall back to UTC rather than crashing with "Invalid time value".
  const shopTz = resolveTimezone(conn.shop_timezone);
  const nowInShopTz = toZonedTime(new Date(), shopTz);
  const yesterdayInShopTz = subDays(nowInShopTz, 1);
  const dayStart = formatISO(startOfDay(yesterdayInShopTz));
  const dayEnd = formatISO(endOfDay(yesterdayInShopTz));
  // Use date-fns format() — safer than .toISOString() on a toZonedTime result
  const snapshotDate = format(yesterdayInShopTz, 'yyyy-MM-dd');

  console.log(`[shopifySync] Syncing ${conn.shop_domain} for ${snapshotDate}`);

  try {
    const client = shopifyClient(conn.shop_domain, conn.access_token);

    // ── Fetch all data in parallel ──────────────────────────────────────────
    const [orders, abandonedCheckouts] = await Promise.all([
      fetchAllOrders(client, dayStart, dayEnd),
      fetchAbandonedCheckouts(client, dayStart, dayEnd),
    ]);

    // ── Compute metrics ─────────────────────────────────────────────────────
    const metrics = computeOrderMetrics(orders);
    const productMetrics = computeTopProducts(orders);
    const customerMetrics = computeCustomerMetrics(orders);
    const abandonedRate = computeAbandonedCartRate(orders.length, abandonedCheckouts);

    // ── Week-over-week comparison ────────────────────────────────────────────
    const lastWeekDate = subDays(yesterdayInShopTz, 7).toISOString().slice(0, 10);
    const { data: lastWeekSnap } = await supabase
      .from('shopify_daily_snapshots')
      .select('total_revenue, total_orders, average_order_value, new_customers')
      .eq('account_id', accountId)
      .eq('snapshot_date', lastWeekDate)
      .maybeSingle();

    const wow = computeWoW(metrics, customerMetrics, lastWeekSnap);

    // ── Upsert snapshot ─────────────────────────────────────────────────────
    const { data: snapshot, error: upsertError } = await supabase
      .from('shopify_daily_snapshots')
      .upsert(
        {
          account_id: accountId,
          snapshot_date: snapshotDate,
          total_revenue: metrics.totalRevenue,
          net_revenue: metrics.netRevenue,
          total_orders: metrics.totalOrders,
          average_order_value: metrics.aov,
          sessions: 0, // Sessions require Shopify Analytics API — populated separately if available
          conversion_rate: 0,
          returning_customer_rate: customerMetrics.returningRate,
          new_customers: customerMetrics.newCustomers,
          returning_customers: customerMetrics.returningCustomers,
          total_customers: customerMetrics.totalCustomers,
          top_products: productMetrics.topByRevenue,
          total_refunds: metrics.totalRefunds,
          cancelled_orders: metrics.cancelledOrders,
          wow_revenue_pct: wow.revenuePct,
          wow_orders_pct: wow.ordersPct,
          wow_aov_pct: wow.aovPct,
          wow_conversion_pct: wow.conversionPct,
          wow_new_customers_pct: wow.newCustomersPct,
          raw_shopify_payload: {
            order_count: orders.length,
            abandoned_checkouts: abandonedCheckouts,
            abandoned_cart_rate: abandonedRate,
            top_products_no_conversion: productMetrics.topNoConversion,
            sync_window: { start: dayStart, end: dayEnd },
          },
        },
        { onConflict: 'account_id,snapshot_date' },
      )
      .select('id')
      .single();

    if (upsertError || !snapshot) {
      throw new Error(`Failed to save snapshot: ${upsertError?.message}`);
    }

    // Update last_synced_at on connection
    await supabase
      .from('shopify_connections')
      .update({ last_synced_at: new Date().toISOString(), sync_error: null })
      .eq('account_id', accountId);

    console.log(`[shopifySync] Done — ${snapshotDate} for ${conn.shop_domain}`);
    return { snapshotId: snapshot.id, snapshotDate };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from('shopify_connections')
      .update({ sync_status: 'error', sync_error: message })
      .eq('account_id', accountId);
    throw err;
  }
}

// ── Order fetching (paginated) ────────────────────────────────────────────────

async function fetchAllOrders(
  client: ReturnType<typeof shopifyClient>,
  createdAtMin: string,
  createdAtMax: string,
): Promise<ShopifyOrder[]> {
  const allOrders: ShopifyOrder[] = [];
  let pageInfo: string | undefined;
  let isFirstPage = true;

  while (isFirstPage || pageInfo) {
    isFirstPage = false;

    const page = await client.getOrders({
      created_at_min: createdAtMin,
      created_at_max: createdAtMax,
      status: 'any',
      limit: 250,
      ...(pageInfo ? { page_info: pageInfo } : {}),
    });

    allOrders.push(...page.orders);
    pageInfo = page.nextPageInfo;

    // Respect Shopify rate limit: 2 req/s
    if (pageInfo) await sleep(550);
  }

  return allOrders;
}

// ── Abandoned checkouts ───────────────────────────────────────────────────────

async function fetchAbandonedCheckouts(
  client: ReturnType<typeof shopifyClient>,
  createdAtMin: string,
  createdAtMax: string,
): Promise<number> {
  try {
    return await client.getAbandonedCheckoutsCount({ created_at_min: createdAtMin, created_at_max: createdAtMax });
  } catch {
    // Abandoned checkout endpoint requires read_checkouts scope — fail gracefully
    return 0;
  }
}

// ── Metric computations ───────────────────────────────────────────────────────

interface OrderMetrics {
  totalRevenue: number;
  netRevenue: number;
  totalOrders: number;
  aov: number;
  totalRefunds: number;
  cancelledOrders: number;
}

function computeOrderMetrics(orders: ShopifyOrder[]): OrderMetrics {
  const completedOrders = orders.filter(
    (o) => o.financial_status !== 'voided' && o.cancel_reason === null,
  );

  const totalRevenue = completedOrders.reduce(
    (sum, o) => sum + parseFloat(o.total_price),
    0,
  );

  const totalRefunds = orders.reduce((sum, o) => {
    const refundTotal = o.refunds.reduce(
      (rs, r) =>
        rs + r.transactions.reduce((ts, t) => ts + parseFloat(t.amount), 0),
      0,
    );
    return sum + refundTotal;
  }, 0);

  const netRevenue = totalRevenue - totalRefunds;
  const totalOrders = completedOrders.length;
  const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const cancelledOrders = orders.filter((o) => o.cancel_reason !== null).length;

  return {
    totalRevenue: round2(totalRevenue),
    netRevenue: round2(netRevenue),
    totalOrders,
    aov: round2(aov),
    totalRefunds: round2(totalRefunds),
    cancelledOrders,
  };
}

interface ProductMetrics {
  topByRevenue: TopProduct[];
  topNoConversion: TopProduct[];
}

function computeTopProducts(orders: ShopifyOrder[]): ProductMetrics {
  const productMap = new Map<
    number,
    {
      product_id: number;
      title: string;
      quantity_sold: number;
      revenue: number;
      variants: Map<number, { title: string; quantity: number }>;
    }
  >();

  for (const order of orders) {
    if (order.cancel_reason !== null) continue;
    for (const item of order.line_items) {
      const existing = productMap.get(item.product_id);
      if (existing) {
        existing.quantity_sold += item.quantity;
        existing.revenue += parseFloat(item.price) * item.quantity;
        const variant = existing.variants.get(item.variant_id);
        if (variant) {
          variant.quantity += item.quantity;
        } else {
          existing.variants.set(item.variant_id, {
            title: item.variant_title || 'Default',
            quantity: item.quantity,
          });
        }
      } else {
        const variants = new Map<number, { title: string; quantity: number }>();
        variants.set(item.variant_id, {
          title: item.variant_title || 'Default',
          quantity: item.quantity,
        });
        productMap.set(item.product_id, {
          product_id: item.product_id,
          title: item.title,
          quantity_sold: item.quantity,
          revenue: parseFloat(item.price) * item.quantity,
          variants,
        });
      }
    }
  }

  const allProducts: TopProduct[] = Array.from(productMap.values())
    .map((p) => ({
      product_id: String(p.product_id),
      title: p.title,
      quantity_sold: p.quantity_sold,
      revenue: round2(p.revenue),
      variant_breakdown: Array.from(p.variants.entries()).map(([vid, v]) => ({
        variant_id: String(vid),
        title: v.title,
        quantity: v.quantity,
      })),
    }));

  // Top 5 by revenue
  const topByRevenue = [...allProducts]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // Top 5 with visits but no/low conversion — we approximate using low quantity_sold
  // (products that appeared in few orders despite being in inventory)
  const topNoConversion = [...allProducts]
    .filter((p) => p.quantity_sold <= 2)
    .sort((a, b) => a.quantity_sold - b.quantity_sold)
    .slice(0, 5);

  return { topByRevenue, topNoConversion };
}

interface CustomerMetrics {
  newCustomers: number;
  returningCustomers: number;
  totalCustomers: number;
  returningRate: number;
}

function computeCustomerMetrics(orders: ShopifyOrder[]): CustomerMetrics {
  const ordersWithCustomers = orders.filter(
    (o) => o.customer !== null && o.cancel_reason === null,
  );

  // first-time buyers: orders_count === 1 on this order
  const newCustomers = ordersWithCustomers.filter(
    (o) => o.customer!.orders_count === 1,
  ).length;

  const returningCustomers = ordersWithCustomers.length - newCustomers;
  const totalCustomers = ordersWithCustomers.length;
  const returningRate =
    totalCustomers > 0 ? round4(returningCustomers / totalCustomers) : 0;

  return { newCustomers, returningCustomers, totalCustomers, returningRate };
}

function computeAbandonedCartRate(
  completedOrders: number,
  abandonedCount: number,
): number {
  const total = completedOrders + abandonedCount;
  if (total === 0) return 0;
  return round4(abandonedCount / total);
}

// ── Week-over-week comparison ─────────────────────────────────────────────────

type LastWeekSnap = {
  total_revenue: number;
  total_orders: number;
  average_order_value: number;
  new_customers: number;
} | null;

function pctChange(current: number, prev: number): number | null {
  if (prev === 0) return null;
  return round2(((current - prev) / prev) * 100);
}

function computeWoW(
  metrics: OrderMetrics,
  customerMetrics: CustomerMetrics,
  lastWeek: LastWeekSnap,
): WowComparison {
  if (!lastWeek) {
    return {
      revenuePct: null,
      ordersPct: null,
      aovPct: null,
      conversionPct: null,
      newCustomersPct: null,
    };
  }
  return {
    revenuePct: pctChange(metrics.totalRevenue, lastWeek.total_revenue),
    ordersPct: pctChange(metrics.totalOrders, lastWeek.total_orders),
    aovPct: pctChange(metrics.aov, lastWeek.average_order_value),
    conversionPct: null, // sessions not yet available — skip conversion WoW
    newCustomersPct: pctChange(customerMetrics.newCustomers, lastWeek.new_customers),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Validate that `tz` is a timezone string accepted by date-fns-tz (IANA format).
 * Shopify stores the timezone as a Rails ActiveSupport name which is NOT IANA.
 * Falls back to 'UTC' so the rest of the sync continues rather than crashing.
 */
function resolveTimezone(tz: string | null | undefined): string {
  if (!tz) return 'UTC';
  try {
    toZonedTime(new Date(), tz); // throws if tz is unrecognised
    return tz;
  } catch {
    console.warn(`[shopifySync] Unrecognised timezone "${tz}", falling back to UTC`);
    return 'UTC';
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
