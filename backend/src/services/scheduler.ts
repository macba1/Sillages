import cron from 'node-cron';
import axios from 'axios';
import { toZonedTime } from 'date-fns-tz';
import { supabase } from '../lib/supabase.js';
import { syncYesterdayForAccount } from './shopifySync.js';
import { syncAbandonedCarts } from './abandonedCartsSync.js';
import { detectEvents } from './eventDetector.js';
import { generateEventAction } from './eventActionGenerator.js';
import { sendPushNotification } from './pushNotifier.js';
import { generateWeeklyBrief } from './weeklyBriefGenerator.js';
import { sendWeeklyBriefEmail } from './weeklyEmailSender.js';
import { logCommunication } from './commLog.js';
import { handleTokenFailure, markTokenHealthy } from '../lib/tokenGuard.js';
import { ensureTokenFresh } from '../lib/shopify.js';

// ═══════════════════════════════════════════════════════════════════════════
// EVENT-DRIVEN SCHEDULER
// 3 loops: event detection (hourly), daily summary (at send_hour), weekly (Monday)
// ═══════════════════════════════════════════════════════════════════════════

export function startScheduler(): void {
  // Event detection: every hour at :10
  cron.schedule('10 * * * *', () => {
    runEventLoop().catch(err => {
      console.error('[scheduler] Event loop error:', err);
    });
  });

  // Daily summary + weekly: every hour at :05 (checks send_hour)
  cron.schedule('5 * * * *', () => {
    runDailyAndWeeklyCheck().catch(err => {
      console.error('[scheduler] Daily/weekly check error:', err);
    });
  });

  console.log('[scheduler] Started — event detection at :10, daily/weekly at :05');
}

// Force run for testing
export async function runSchedulerForced(): Promise<string[]> {
  return runDailyAndWeeklyCheck(true);
}

// ═══════════════════════════════════════════════════════════════════════════
// LOOP 1: EVENT DETECTION (every hour)
// Sync data, detect events, generate actions, send push notifications
// ═══════════════════════════════════════════════════════════════════════════

async function runEventLoop(): Promise<void> {
  const now = new Date();
  console.log(`[scheduler] Event loop at ${now.toISOString()}`);

  const accounts = await getEligibleAccounts();
  if (accounts.length === 0) return;

  for (const accountId of accounts) {
    try {
      await processEventsForAccount(accountId);
    } catch (err) {
      console.error(`[scheduler] [${accountId}] Event processing failed: ${(err as Error).message}`);
    }
  }
}

// Max event push notifications per day per merchant (daily_summary doesn't count)
const MAX_EVENT_PUSHES_PER_DAY = 2;

// Priority order for push notifications: higher priority events get sent first
const EVENT_PRIORITY: Record<string, number> = {
  abandoned_cart: 1,    // highest — money on the table
  new_first_buyer: 2,
  overdue_customer: 3,  // lowest — can wait a day
};

async function processEventsForAccount(accountId: string): Promise<void> {
  // 1. Sync Shopify data
  await ensureShopifySync(accountId);

  // 2. Sync abandoned carts
  try {
    await syncAbandonedCarts(accountId);
  } catch (err) {
    console.warn(`[scheduler] [${accountId}] Cart sync failed (non-fatal): ${(err as Error).message}`);
  }

  // 3. Detect events
  const events = await detectEvents(accountId);
  if (events.length === 0) return;

  console.log(`[scheduler] [${accountId}] ${events.length} event(s) detected`);

  // 4. Load account metadata
  const [{ data: acc }, { data: conn }] = await Promise.all([
    supabase.from('accounts').select('language, full_name').eq('id', accountId).single(),
    supabase.from('shopify_connections').select('shop_name, shop_currency').eq('account_id', accountId).maybeSingle(),
  ]);

  const lang: 'en' | 'es' = acc?.language === 'es' ? 'es' : 'en';
  const storeName = conn?.shop_name ?? 'Tu tienda';
  const currency = conn?.shop_currency ?? 'EUR';

  // 5. Sort events by priority (cart_recovery > welcome > reactivation)
  const sortedEvents = [...events].sort((a, b) =>
    (EVENT_PRIORITY[a.type] ?? 99) - (EVENT_PRIORITY[b.type] ?? 99),
  );

  // 6. Check how many event pushes were already sent today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { count: pushesToday } = await supabase
    .from('email_log')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('channel', 'event_push')
    .eq('status', 'sent')
    .gte('sent_at', todayStart.toISOString());

  const pushesRemaining = MAX_EVENT_PUSHES_PER_DAY - (pushesToday ?? 0);

  if (pushesRemaining <= 0) {
    console.log(`[scheduler] [${accountId}] Already sent ${pushesToday} event pushes today — max ${MAX_EVENT_PUSHES_PER_DAY}/day. Actions still generated, push deferred.`);
  }

  // 7. Generate actions for ALL events, but only send push for top priority ones
  let pushesSent = 0;

  for (const event of sortedEvents) {
    const actionId = await generateEventAction(accountId, event, lang, storeName, currency);
    if (!actionId) continue;

    // Send push only if we haven't hit the daily limit
    if (pushesSent < pushesRemaining) {
      const push = buildEventPush(event, lang, storeName, currency, actionId);

      try {
        await sendPushNotification(accountId, push);
        pushesSent++;
        console.log(`[scheduler] [${accountId}] Push ${pushesSent}/${MAX_EVENT_PUSHES_PER_DAY} sent: ${event.type}`);

        // Mark push as sent in event_log
        await supabase
          .from('event_log')
          .update({ push_sent: true })
          .eq('account_id', accountId)
          .eq('event_key', event.key);

        await logCommunication({
          account_id: accountId,
          channel: 'event_push',
          status: 'sent',
        });
      } catch (pushErr) {
        console.warn(`[scheduler] [${accountId}] Push failed: ${(pushErr as Error).message}`);
      }
    } else {
      console.log(`[scheduler] [${accountId}] Action generated for ${event.type} — push deferred (daily limit reached)`);
    }
  }
}

// ── Build event-specific push notification ──────────────────────────────

function buildEventPush(
  event: import('./eventDetector.js').DetectedEvent,
  lang: 'en' | 'es',
  storeName: string,
  currency: string,
  actionId: string,
): { title: string; body: string; url: string } {
  const isEs = lang === 'es';
  const cs = currency === 'EUR' ? '€' : '$';

  switch (event.type) {
    case 'new_first_buyer': {
      const d = event.data as import('./eventDetector.js').NewFirstBuyerData;
      return {
        title: storeName,
        body: isEs
          ? `${d.customer_name} compró ${d.product_purchased} por primera vez. ¿Le mandamos un agradecimiento?`
          : `${d.customer_name} bought ${d.product_purchased} for the first time. Send a thank you?`,
        url: `/actions?highlight=${actionId}`,
      };
    }

    case 'abandoned_cart': {
      const d = event.data as import('./eventDetector.js').AbandonedCartData;
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
      const d = event.data as import('./eventDetector.js').OverdueCustomerData;
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

// ═══════════════════════════════════════════════════════════════════════════
// LOOP 2: DAILY SUMMARY + WEEKLY EMAIL (at send_hour)
// Daily: simple push with yesterday's numbers
// Monday: full weekly email pipeline
// ═══════════════════════════════════════════════════════════════════════════

async function runDailyAndWeeklyCheck(force = false): Promise<string[]> {
  const now = new Date();
  console.log(`[scheduler] ${force ? 'FORCED' : 'Hourly'} daily/weekly check at ${now.toISOString()}`);

  const accounts = await getEligibleAccounts();
  if (accounts.length === 0) return [];

  // Get configs to check send_hour
  const { data: configs } = await supabase
    .from('user_intelligence_config')
    .select('account_id, timezone, send_hour')
    .eq('send_enabled', true)
    .in('account_id', accounts);

  if (!configs || configs.length === 0) return [];

  const due: string[] = [];

  for (const config of configs) {
    const localHour = getLocalHour(config.timezone, now);
    if (force || localHour === config.send_hour) {
      due.push(config.account_id);
    }
  }

  if (due.length === 0) {
    console.log('[scheduler] No accounts due this hour');
    return [];
  }

  console.log(`[scheduler] ${due.length} account(s) due for daily summary`);

  for (const accountId of due) {
    try {
      // Daily summary push (every day)
      await sendDailySummaryPush(accountId);

      // Monday → weekly email
      const tz = configs.find(c => c.account_id === accountId)?.timezone ?? 'UTC';
      const localDay = getLocalDayOfWeek(tz, now);
      if (localDay === 1) {
        console.log(`[scheduler] [${accountId}] Monday — running weekly pipeline`);
        await runWeeklyPipeline(accountId, now);
      }

      // Pending actions reminder
      await sendPendingActionsReminder(accountId);
    } catch (err) {
      console.error(`[scheduler] [${accountId}] Daily/weekly error: ${(err as Error).message}`);
    }
  }

  return due;
}

// ── Daily summary push (Type 4) ─────────────────────────────────────────

async function sendDailySummaryPush(accountId: string): Promise<void> {
  // Get yesterday's snapshot
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const [{ data: snap }, { data: conn }, { data: acc }] = await Promise.all([
    supabase.from('shopify_daily_snapshots').select('total_revenue, total_orders, new_customers')
      .eq('account_id', accountId).eq('snapshot_date', yesterday).maybeSingle(),
    supabase.from('shopify_connections').select('shop_name, shop_currency').eq('account_id', accountId).maybeSingle(),
    supabase.from('accounts').select('language').eq('id', accountId).single(),
  ]);

  if (!snap) {
    console.log(`[scheduler] [${accountId}] No snapshot for ${yesterday} — skipping daily summary`);
    return;
  }

  const isEs = acc?.language === 'es';
  const cs = (conn?.shop_currency === 'EUR' ? '€' : '$');
  const storeName = conn?.shop_name ?? 'Tu tienda';
  const ordersWord = isEs ? 'pedidos' : 'orders';
  const yesterdayWord = isEs ? 'Ayer' : 'Yesterday';

  // Build one-liner body
  let body = `${yesterdayWord} ${cs}${snap.total_revenue.toFixed(0)} · ${snap.total_orders} ${ordersWord}`;
  if (snap.new_customers > 0) {
    body += isEs
      ? `. ${snap.new_customers} ${snap.new_customers === 1 ? 'cliente nuevo' : 'clientes nuevos'}.`
      : `. ${snap.new_customers} new ${snap.new_customers === 1 ? 'customer' : 'customers'}.`;
  }

  await sendPushNotification(accountId, {
    title: storeName,
    body,
    url: '/dashboard',
  });

  await logCommunication({
    account_id: accountId,
    channel: 'daily_summary_push',
    status: 'sent',
  });

  console.log(`[scheduler] [${accountId}] Daily summary push sent: ${body}`);
}

// ── Pending actions reminder (Type 5) ───────────────────────────────────

async function sendPendingActionsReminder(accountId: string): Promise<void> {
  const { count } = await supabase
    .from('pending_actions')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('status', 'pending');

  const n = count ?? 0;
  if (n === 0) return;

  const { data: acc } = await supabase
    .from('accounts').select('language').eq('id', accountId).single();
  const { data: conn } = await supabase
    .from('shopify_connections').select('shop_name').eq('account_id', accountId).maybeSingle();

  const isEs = acc?.language === 'es';
  const storeName = conn?.shop_name ?? 'Sillages';

  await sendPushNotification(accountId, {
    title: storeName,
    body: isEs
      ? `Tienes ${n} ${n === 1 ? 'acción lista' : 'acciones listas'} para aprobar.`
      : `You have ${n} ${n === 1 ? 'action ready' : 'actions ready'} to approve.`,
    url: '/actions',
  });

  console.log(`[scheduler] [${accountId}] Pending actions reminder: ${n} actions`);
}

// ═══════════════════════════════════════════════════════════════════════════
// LOOP 3: WEEKLY PIPELINE (Monday only)
// Full Analyst → Growth Hacker → Auditor → Email
// ═══════════════════════════════════════════════════════════════════════════

async function runWeeklyPipeline(accountId: string, now: Date): Promise<void> {
  const weeklyStart = Date.now();
  try {
    const yesterday = new Date(now.getTime() - 86400000);
    const weekEndDate = yesterday.toISOString().slice(0, 10);

    console.log(`[scheduler] [${accountId}] Weekly brief generation START for week ending ${weekEndDate}`);
    const weeklyBriefId = await generateWeeklyBrief(accountId, weekEndDate);
    const genDuration = Date.now() - weeklyStart;
    console.log(`[scheduler] [${accountId}] Weekly brief generation END — ${genDuration}ms`);

    console.log(`[scheduler] [${accountId}] Sending weekly email`);
    await sendWeeklyBriefEmail(weeklyBriefId);
    console.log(`[scheduler] [${accountId}] Weekly email sent`);

    await logCommunication({
      account_id: accountId,
      weekly_brief_id: weeklyBriefId,
      channel: 'weekly_email',
      status: 'sent',
    });

    // Push notification about weekly email
    const { data: conn } = await supabase
      .from('shopify_connections').select('shop_name').eq('account_id', accountId).maybeSingle();
    const { data: acc } = await supabase
      .from('accounts').select('language').eq('id', accountId).single();
    const isEs = acc?.language === 'es';

    await sendPushNotification(accountId, {
      title: conn?.shop_name ?? 'Sillages',
      body: isEs
        ? 'Tu resumen semanal está en tu email.'
        : 'Your weekly summary is in your email.',
      url: '/dashboard',
    });

    const totalDuration = Date.now() - weeklyStart;
    console.log(`[scheduler] [${accountId}] Weekly pipeline complete — ${totalDuration}ms`);
  } catch (err) {
    const message = (err as Error).message;
    const totalDuration = Date.now() - weeklyStart;
    console.error(`[scheduler] [${accountId}] Weekly pipeline failed after ${totalDuration}ms: ${message}`);
    await logCommunication({
      account_id: accountId,
      channel: 'weekly_email',
      status: 'failed',
      error_message: message,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════════

async function getEligibleAccounts(): Promise<string[]> {
  const { data: accounts, error } = await supabase
    .from('accounts')
    .select('id')
    .or('subscription_status.in.(active,trialing,beta),subscription_status.is.null');

  if (error || !accounts) {
    console.error('[scheduler] Failed to load accounts:', error?.message);
    return [];
  }

  return accounts.map(a => a.id);
}

async function ensureShopifySync(accountId: string): Promise<string | null> {
  const { data: connRow } = await supabase
    .from('shopify_connections')
    .select('shop_domain, token_status')
    .eq('account_id', accountId)
    .maybeSingle();

  if (connRow?.token_status === 'invalid') {
    console.log(`[scheduler] [${accountId}] Skipping — token invalid`);
    return null;
  }

  if (connRow?.shop_domain) {
    await ensureTokenFresh(connRow.shop_domain);
  }

  try {
    const result = await syncYesterdayForAccount(accountId);
    if (connRow?.shop_domain) {
      await markTokenHealthy(connRow.shop_domain);
    }
    return result.snapshotDate;
  } catch (syncErr) {
    const httpStatus = axios.isAxiosError(syncErr) ? syncErr.response?.status : null;

    if ((httpStatus === 403 || httpStatus === 401) && connRow?.shop_domain) {
      console.log(`[scheduler] Shopify ${httpStatus} for ${connRow.shop_domain} — running tokenGuard`);
      const canRetry = await handleTokenFailure(connRow.shop_domain);

      if (canRetry) {
        try {
          const retryResult = await syncYesterdayForAccount(accountId);
          await markTokenHealthy(connRow.shop_domain);
          return retryResult.snapshotDate;
        } catch {
          console.log(`[scheduler] Retry also failed for ${connRow.shop_domain}`);
        }
      }

      // Fall back to last snapshot
      const { data: last } = await supabase
        .from('shopify_daily_snapshots')
        .select('snapshot_date')
        .eq('account_id', accountId)
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      return last?.snapshot_date ?? null;
    }

    console.error(`[scheduler] [${accountId}] Sync failed: ${(syncErr as Error).message}`);
    return null;
  }
}

function getLocalHour(timezone: string, utcDate: Date): number {
  try {
    return toZonedTime(utcDate, timezone).getHours();
  } catch {
    return utcDate.getUTCHours();
  }
}

function getLocalDayOfWeek(timezone: string, utcDate: Date): number {
  try {
    return toZonedTime(utcDate, timezone).getDay();
  } catch {
    return utcDate.getUTCDay();
  }
}
