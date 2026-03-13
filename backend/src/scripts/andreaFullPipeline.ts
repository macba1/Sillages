import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { shopifyClient } from '../lib/shopify.js';
import type { ShopifyConnection } from '../lib/shopify.js';
import { generateBrief } from '../services/briefGenerator.js';
import { sendBriefEmail } from '../services/emailSender.js';
import { sendPushNotification } from '../services/pushNotifier.js';
import { syncYesterdayForAccount } from '../services/shopifySync.js';
import axios from 'axios';

const ACCOUNT_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';
const SHOP_DOMAIN = 'taart-madrid.myshopify.com';

async function main() {
  console.log('=== ANDREA FULL PIPELINE ===\n');

  // ── Step 1: Clean duplicate actions ──────────────────────────────────────
  console.log('── STEP 1: Cleaning duplicate actions ──');
  const { data: allActions } = await supabase
    .from('pending_actions')
    .select('id, type, title, status, created_at')
    .eq('account_id', ACCOUNT_ID)
    .order('created_at', { ascending: false });

  if (allActions && allActions.length > 0) {
    // Keep only the most recent action per type+title combination
    const seen = new Set<string>();
    const toDelete: string[] = [];
    for (const action of allActions) {
      const key = `${action.type}::${action.title}`;
      if (seen.has(key)) {
        toDelete.push(action.id);
      } else {
        seen.add(key);
      }
    }
    if (toDelete.length > 0) {
      // Delete in batches of 50
      for (let i = 0; i < toDelete.length; i += 50) {
        const batch = toDelete.slice(i, i + 50);
        await supabase.from('pending_actions').delete().in('id', batch);
      }
      console.log(`Deleted ${toDelete.length} duplicate actions (kept ${allActions.length - toDelete.length} unique)`);
    } else {
      console.log('No duplicates found');
    }
  }

  // ── Step 2: Verify connection ────────────────────────────────────────────
  console.log('\n── STEP 2: Verifying connection ──');
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('*')
    .eq('shop_domain', SHOP_DOMAIN)
    .single();

  if (!conn) { console.log('NO CONNECTION'); return; }

  // Test API
  try {
    const resp = await axios.get(`https://${SHOP_DOMAIN}/admin/api/2024-04/shop.json`, {
      headers: { 'X-Shopify-Access-Token': conn.access_token },
      timeout: 10000,
    });
    console.log(`API OK — ${resp.data.shop.name} (${resp.data.shop.currency})`);
  } catch (err: any) {
    console.log(`API FAILED: ${err.response?.status ?? err.message}`);
    return;
  }

  // ── Step 3: Sync last 60 days ────────────────────────────────────────────
  console.log('\n── STEP 3: Syncing last 60 days ──');
  const client = shopifyClient(conn.shop_domain, conn.access_token);

  // Get existing snapshot dates to avoid re-syncing
  const { data: existingSnaps } = await supabase
    .from('shopify_daily_snapshots')
    .select('snapshot_date')
    .eq('account_id', ACCOUNT_ID);
  const existingDates = new Set(existingSnaps?.map(s => s.snapshot_date) ?? []);

  // Generate date list for last 60 days
  const dates: string[] = [];
  for (let i = 1; i <= 60; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    if (!existingDates.has(dateStr)) {
      dates.push(dateStr);
    }
  }

  console.log(`${existingDates.size} days already synced, ${dates.length} days to fetch`);

  let synced = 0;
  let errors = 0;

  for (const dateStr of dates) {
    const dayStart = dateStr + 'T00:00:00Z';
    const dayEnd = dateStr + 'T23:59:59Z';

    try {
      // Fetch orders for this day
      const allOrders: any[] = [];
      let pageInfo: string | undefined;
      let isFirstPage = true;

      while (isFirstPage || pageInfo) {
        isFirstPage = false;
        const page = await client.getOrders({
          created_at_min: dayStart,
          created_at_max: dayEnd,
          status: 'any',
          limit: 250,
          ...(pageInfo ? { page_info: pageInfo } : {}),
        });
        allOrders.push(...page.orders);
        pageInfo = page.nextPageInfo;
        if (pageInfo) await sleep(550);
      }

      // Fetch abandoned checkouts
      let abandonedCheckouts = 0;
      try {
        abandonedCheckouts = await client.getAbandonedCheckoutsCount({ created_at_min: dayStart, created_at_max: dayEnd });
      } catch { /* scope may not exist */ }

      // Compute metrics
      const completedOrders = allOrders.filter((o: any) => o.financial_status !== 'voided' && o.cancel_reason === null);
      const totalRevenue = completedOrders.reduce((sum: number, o: any) => sum + parseFloat(o.total_price), 0);
      const totalRefunds = allOrders.reduce((sum: number, o: any) => {
        return sum + (o.refunds || []).reduce((rs: number, r: any) => rs + (r.transactions || []).reduce((ts: number, t: any) => ts + parseFloat(t.amount), 0), 0);
      }, 0);
      const totalOrders = completedOrders.length;
      const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      // Top products
      const productMap = new Map<string, { title: string; quantity: number; revenue: number }>();
      for (const order of completedOrders) {
        for (const item of (order as any).line_items) {
          const key = String(item.product_id);
          const existing = productMap.get(key);
          if (existing) {
            existing.quantity += item.quantity;
            existing.revenue += parseFloat(item.price) * item.quantity;
          } else {
            productMap.set(key, { title: item.title, quantity: item.quantity, revenue: parseFloat(item.price) * item.quantity });
          }
        }
      }
      const topProducts = Array.from(productMap.entries())
        .map(([pid, p]) => ({ product_id: pid, title: p.title, quantity_sold: p.quantity, revenue: Math.round(p.revenue * 100) / 100 }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);

      // Customer metrics
      const ordersWithCustomer = completedOrders.filter((o: any) => o.customer);
      const newCustomers = ordersWithCustomer.filter((o: any) => o.customer.orders_count === 1).length;
      const returningCustomers = ordersWithCustomer.length - newCustomers;

      // Abandoned cart rate
      const cartTotal = totalOrders + abandonedCheckouts;
      const abandonedRate = cartTotal > 0 ? Math.round((abandonedCheckouts / cartTotal) * 10000) / 10000 : 0;

      // Upsert
      await supabase.from('shopify_daily_snapshots').upsert({
        account_id: ACCOUNT_ID,
        snapshot_date: dateStr,
        total_revenue: Math.round(totalRevenue * 100) / 100,
        net_revenue: Math.round((totalRevenue - totalRefunds) * 100) / 100,
        total_orders: totalOrders,
        average_order_value: Math.round(aov * 100) / 100,
        sessions: 0,
        conversion_rate: 0,
        returning_customer_rate: ordersWithCustomer.length > 0 ? Math.round((returningCustomers / ordersWithCustomer.length) * 10000) / 10000 : 0,
        new_customers: newCustomers,
        returning_customers: returningCustomers,
        total_customers: ordersWithCustomer.length,
        top_products: topProducts,
        total_refunds: Math.round(totalRefunds * 100) / 100,
        cancelled_orders: allOrders.filter((o: any) => o.cancel_reason !== null).length,
        raw_shopify_payload: {
          order_count: allOrders.length,
          abandoned_checkouts: abandonedCheckouts,
          abandoned_cart_rate: abandonedRate,
          sync_window: { start: dayStart, end: dayEnd },
        },
      }, { onConflict: 'account_id,snapshot_date' });

      synced++;
      const icon = totalOrders > 0 ? '📦' : '·';
      if (totalOrders > 0) {
        console.log(`  ${icon} ${dateStr}: ${totalOrders} orders, €${Math.round(totalRevenue)}`);
      }

      // Rate limit — wait between days
      await sleep(600);
    } catch (err: any) {
      errors++;
      console.log(`  ❌ ${dateStr}: ${err.response?.status ?? err.message}`);
      if (err.response?.status === 401 || err.response?.status === 403) {
        console.log('TOKEN EXPIRED — stopping sync');
        break;
      }
      await sleep(1000);
    }
  }

  console.log(`\nSync complete: ${synced} days synced, ${errors} errors`);

  // Update last_synced_at
  await supabase.from('shopify_connections')
    .update({ last_synced_at: new Date().toISOString(), sync_error: null })
    .eq('account_id', ACCOUNT_ID);

  // ── Step 4: Generate brief with agent pipeline ───────────────────────────
  console.log('\n── STEP 4: Generating brief (Analyst → Growth Hacker) ──');
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const briefDate = yesterday.toISOString().slice(0, 10);

  try {
    await generateBrief({ accountId: ACCOUNT_ID, briefDate });
    console.log(`Brief generated for ${briefDate}`);
  } catch (err: any) {
    console.log(`Brief generation failed: ${err.message}`);
  }

  // ── Step 5: Find the brief and send email + push ─────────────────────────
  console.log('\n── STEP 5: Sending email + push ──');
  const { data: brief } = await supabase
    .from('intelligence_briefs')
    .select('id, brief_date, status')
    .eq('account_id', ACCOUNT_ID)
    .eq('brief_date', briefDate)
    .single();

  if (brief && brief.status === 'ready') {
    // Send email
    try {
      await sendBriefEmail(brief.id);
      console.log(`Email sent for brief ${brief.brief_date}`);
    } catch (err: any) {
      console.log(`Email failed: ${err.message}`);
    }

    // Send push notification
    try {
      await sendPushNotification(ACCOUNT_ID, {
        title: 'Tu brief de hoy está listo',
        body: 'Toca para leer lo que pasó ayer en tu tienda',
        url: `/briefs/${brief.id}`,
      });
      console.log('Push notification sent');
    } catch (err: any) {
      console.log(`Push failed: ${err.message}`);
    }
  } else {
    console.log(`Brief status: ${brief?.status ?? 'not found'} — skipping send`);
  }

  // ── Step 6: Final status ─────────────────────────────────────────────────
  console.log('\n── FINAL STATUS ──');
  const { count: totalSnaps } = await supabase
    .from('shopify_daily_snapshots')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', ACCOUNT_ID);

  const { count: totalBriefs } = await supabase
    .from('intelligence_briefs')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', ACCOUNT_ID);

  const { data: finalActions, count: totalActions } = await supabase
    .from('pending_actions')
    .select('type, title, status', { count: 'exact' })
    .eq('account_id', ACCOUNT_ID);

  console.log(`Snapshots: ${totalSnaps}`);
  console.log(`Briefs: ${totalBriefs}`);
  console.log(`Actions: ${totalActions}`);
  if (finalActions) {
    finalActions.forEach(a => console.log(`  [${a.status}] ${a.type}: ${a.title}`));
  }

  console.log('\n=== PIPELINE COMPLETE ===');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('PIPELINE ERROR:', err);
  process.exit(1);
});
