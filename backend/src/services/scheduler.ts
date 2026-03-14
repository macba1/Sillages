import cron from 'node-cron';
import axios from 'axios';
import { toZonedTime } from 'date-fns-tz';
import { supabase } from '../lib/supabase.js';
import { syncYesterdayForAccount } from './shopifySync.js';
import { generateBrief } from './briefGenerator.js';
import { sendBriefEmail } from './emailSender.js';
import { sendPushNotification } from './pushNotifier.js';
import { generateWeeklyBrief } from './weeklyBriefGenerator.js';
import { sendWeeklyBriefEmail } from './weeklyEmailSender.js';
import { logCommunication } from './commLog.js';
import { handleTokenFailure, markTokenHealthy } from '../lib/tokenGuard.js';
import { ensureTokenFresh } from '../lib/shopify.js';

// Runs every hour at :05 — checks which accounts are due for their brief
// based on their configured timezone and send_hour
export async function runSchedulerForced(): Promise<string[]> {
  return runHourlyCheck(true);
}

export function startScheduler(): void {
  cron.schedule('5 * * * *', () => {
    runHourlyCheck(false).catch((err) => {
      console.error('[scheduler] Unhandled error in hourly check:', err);
    });
  });

  console.log('[scheduler] Started — checking every hour at :05 for due briefs');
}

async function runHourlyCheck(force: boolean): Promise<string[]> {
  const now = new Date();
  console.log(`[scheduler] ${force ? 'FORCED run' : 'Hourly check'} at ${now.toISOString()}`);

  // Step 1: get all eligible accounts — active, trialing, beta, or null (beta fallback)
  const { data: accounts, error: accountsError } = await supabase
    .from('accounts')
    .select('id, subscription_status')
    .or('subscription_status.in.(active,trialing,beta),subscription_status.is.null');

  if (accountsError) {
    console.error('[scheduler] Failed to load accounts:', accountsError.message);
    return [];
  }

  if (!accounts || accounts.length === 0) {
    console.log('[scheduler] No eligible accounts found');
    return [];
  }

  const eligibleIds = accounts.map(a => a.id);
  console.log(`[scheduler] ${eligibleIds.length} eligible account(s) — statuses: ${accounts.map(a => a.subscription_status ?? 'null').join(', ')}`);

  // Step 2: get send-enabled configs for those accounts
  const { data: configs, error: configsError } = await supabase
    .from('user_intelligence_config')
    .select('account_id, timezone, send_hour')
    .eq('send_enabled', true)
    .in('account_id', eligibleIds);

  if (configsError) {
    console.error('[scheduler] Failed to load configs:', configsError.message);
    return [];
  }

  if (!configs || configs.length === 0) {
    console.log('[scheduler] No send-enabled configs found');
    return [];
  }

  console.log(`[scheduler] ${configs.length} send-enabled config(s) to check`);

  const due: string[] = [];

  for (const config of configs) {
    const localHour = getLocalHour(config.timezone, now);
    console.log(`[scheduler] Account ${config.account_id} — localHour=${localHour} send_hour=${config.send_hour} timezone=${config.timezone} force=${force}`);
    if (force || localHour === config.send_hour) {
      due.push(config.account_id);
    }
  }

  if (due.length === 0) {
    console.log('[scheduler] No accounts due this hour');
    return [];
  }

  console.log(`[scheduler] ${due.length} account(s) due — running pipelines`);

  // Process each account sequentially to avoid overloading external APIs
  for (const accountId of due) {
    console.log(`[scheduler] Account ${accountId} is due — running pipeline`);
    await runBriefPipeline(accountId);
  }

  return due;
}

async function runBriefPipeline(accountId: string): Promise<void> {
  console.log(`[scheduler] Starting brief pipeline for account: ${accountId}`);

  // Step 1: Sync yesterday's Shopify data — with 403 fallback
  console.log(`[scheduler] [${accountId}] Step 1 — Shopify sync`);
  let snapshotDate: string;

  // Get shop domain for tokenGuard tracking
  const { data: connRow } = await supabase
    .from('shopify_connections')
    .select('shop_domain, token_status')
    .eq('account_id', accountId)
    .maybeSingle();

  // Skip accounts with definitively invalid tokens (they need to reconnect)
  if (connRow?.token_status === 'invalid') {
    console.log(`[scheduler] [${accountId}] Skipping — token marked invalid for ${connRow.shop_domain}. Merchant needs to reconnect.`);
    return;
  }

  // Proactive token refresh — if token expires within 1 hour, refresh now
  if (connRow?.shop_domain) {
    await ensureTokenFresh(connRow.shop_domain);
  }

  try {
    const result = await syncYesterdayForAccount(accountId);
    snapshotDate = result.snapshotDate;

    // Sync succeeded — mark token healthy
    if (connRow?.shop_domain) {
      await markTokenHealthy(connRow.shop_domain);
    }
  } catch (syncErr) {
    const httpStatus = axios.isAxiosError(syncErr) ? syncErr.response?.status : null;
    const is403or401 = httpStatus === 403 || httpStatus === 401;

    if (is403or401 && connRow?.shop_domain) {
      console.log(`[scheduler] Shopify ${httpStatus} for ${connRow.shop_domain} — running tokenGuard`);
      const canRetry = await handleTokenFailure(connRow.shop_domain);

      if (canRetry) {
        // Try once more
        try {
          const retryResult = await syncYesterdayForAccount(accountId);
          snapshotDate = retryResult.snapshotDate;
          await markTokenHealthy(connRow.shop_domain);
        } catch {
          // Retry also failed — fall back to last snapshot
          console.log(`[scheduler] Retry also failed for ${connRow.shop_domain} — falling back to last snapshot`);
        }
      }
    }

    // If snapshotDate is not set, fall back to last available
    if (!snapshotDate!) {
      if (is403or401) {
        const { data: lastSnapshot } = await supabase
          .from('shopify_daily_snapshots')
          .select('snapshot_date')
          .eq('account_id', accountId)
          .order('snapshot_date', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!lastSnapshot) {
          console.log(`[scheduler] No data available for account ${accountId} — skipping`);
          return;
        }
        snapshotDate = lastSnapshot.snapshot_date;
      } else {
        const msg = axios.isAxiosError(syncErr)
          ? `HTTP ${syncErr.response?.status}: ${JSON.stringify(syncErr.response?.data)}`
          : String(syncErr);
        console.error(`[scheduler] Shopify sync failed for account ${accountId}: ${msg}`);
        return;
      }
    }
  }

  try {
    // Step 2: Generate the AI brief
    console.log(`[scheduler] [${accountId}] Step 2 — Brief generation`);
    await generateBrief({ accountId, briefDate: snapshotDate });

    // Step 3: Look up the brief record
    const { data: brief, error: briefError } = await supabase
      .from('intelligence_briefs')
      .select('id, status')
      .eq('account_id', accountId)
      .eq('brief_date', snapshotDate)
      .single();

    if (briefError || !brief) {
      console.warn(`[scheduler] [${accountId}] Could not find brief after generation — skipping delivery`);
      return;
    }

    if (brief.status === 'failed') {
      console.warn(`[scheduler] [${accountId}] Brief generation failed — skipping delivery`);
      return;
    }

    // Step 3: Deliver daily brief — PUSH ONLY (email as fallback)
    console.log(`[scheduler] [${accountId}] Step 3 — Daily delivery (push-first)`);
    await deliverDailyBrief(accountId, brief.id, snapshotDate);

    // Step 4: Monday → also generate + send weekly brief email
    const now = new Date();
    const localDay = getLocalDayOfWeek(
      (await getAccountTimezone(accountId)) ?? 'UTC',
      now,
    );

    if (localDay === 1) {
      // Monday — generate weekly brief for the previous week (Mon→Sun)
      console.log(`[scheduler] [${accountId}] Step 4 — Monday: generating weekly brief`);
      await runWeeklyPipeline(accountId, now);
    }

    console.log(`[scheduler] [${accountId}] Pipeline complete`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] [${accountId}] Pipeline error: ${message}`);
    // Don't rethrow — one account's failure shouldn't block the rest
  }
}

// ── Daily delivery: push-first, email fallback ─────────────────────────────

async function deliverDailyBrief(
  accountId: string,
  briefId: string,
  snapshotDate: string,
): Promise<void> {
  // Check if account has push subscriptions
  const { count: pushCount } = await supabase
    .from('push_subscriptions')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId);

  const hasPush = (pushCount ?? 0) > 0;

  // Load data for push notification content
  const [{ data: fullBrief }, { data: conn }, { data: acc }, { count: actionCount }] = await Promise.all([
    supabase.from('intelligence_briefs').select('section_yesterday, section_activation').eq('id', briefId).single(),
    supabase.from('shopify_connections').select('shop_name, shop_currency').eq('account_id', accountId).maybeSingle(),
    supabase.from('accounts').select('language').eq('id', accountId).single(),
    supabase.from('pending_actions').select('*', { count: 'exact', head: true }).eq('account_id', accountId).eq('brief_date', snapshotDate).eq('status', 'pending'),
  ]);

  const lang: 'en' | 'es' = (acc as { language?: string } | null)?.language === 'es' ? 'es' : 'en';

  if (hasPush) {
    // ── Push notification (primary channel) ──
    console.log(`[scheduler] [${accountId}] Sending daily push notification`);
    try {
      if (fullBrief?.section_yesterday) {
        const y = fullBrief.section_yesterday as { revenue: number; orders: number };
        const defaultStore = lang === 'es' ? 'Tu tienda' : 'Your store';
        const storeName = (conn as { shop_name: string | null } | null)?.shop_name ?? defaultStore;
        const cur = (conn as { shop_currency: string | null } | null)?.shop_currency ?? 'USD';
        const sym: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', MXN: 'MX$' };
        const cs = sym[cur] ?? `${cur} `;

        const ordersWord = lang === 'es' ? 'pedidos' : 'orders';
        const yesterdayWord = lang === 'es' ? 'Ayer' : 'Yesterday';
        const n = actionCount ?? 0;

        let body: string;
        if (n > 0) {
          body = lang === 'es'
            ? `${n} ${n === 1 ? 'acción preparada' : 'acciones preparadas'}. Toca para aprobar.`
            : `${n} ${n === 1 ? 'action ready' : 'actions ready'}. Tap to approve.`;
        } else {
          body = lang === 'es' ? 'Tu brief diario está listo — Toca para verlo →' : 'Your daily brief is ready — Tap to view →';
        }

        await sendPushNotification(accountId, {
          title: `${storeName} — ${yesterdayWord} ${cs}${y.revenue.toFixed(0)} · ${y.orders} ${ordersWord}`,
          body,
          url: '/dashboard',
        });
      }

      await logCommunication({
        account_id: accountId,
        brief_id: briefId,
        channel: 'push',
        status: 'sent',
      });
    } catch (pushErr) {
      console.error(`[scheduler] [${accountId}] Push failed: ${(pushErr as Error).message}`);
      await logCommunication({
        account_id: accountId,
        brief_id: briefId,
        channel: 'push',
        status: 'failed',
        error_message: (pushErr as Error).message,
      });

      // Push failed — fall back to email
      console.log(`[scheduler] [${accountId}] Falling back to email`);
      await sendDailyEmail(accountId, briefId);
    }
  } else {
    // ── No push subscriptions → email fallback ──
    console.log(`[scheduler] [${accountId}] No push subscriptions — sending email fallback`);
    await sendDailyEmail(accountId, briefId);
  }
}

async function sendDailyEmail(accountId: string, briefId: string): Promise<void> {
  try {
    await sendBriefEmail(briefId);
    await logCommunication({
      account_id: accountId,
      brief_id: briefId,
      channel: 'email',
      status: 'sent',
    });
  } catch (emailErr) {
    console.error(`[scheduler] [${accountId}] Email fallback failed: ${(emailErr as Error).message}`);
    await logCommunication({
      account_id: accountId,
      brief_id: briefId,
      channel: 'email',
      status: 'failed',
      error_message: (emailErr as Error).message,
    });
  }
}

// ── Weekly pipeline (Monday only) ──────────────────────────────────────────

async function runWeeklyPipeline(accountId: string, now: Date): Promise<void> {
  try {
    // Week end = yesterday (Sunday)
    const yesterday = new Date(now.getTime() - 86400000);
    const weekEndDate = yesterday.toISOString().slice(0, 10);

    console.log(`[scheduler] [${accountId}] Generating weekly brief for week ending ${weekEndDate}`);
    const weeklyBriefId = await generateWeeklyBrief(accountId, weekEndDate);

    console.log(`[scheduler] [${accountId}] Sending weekly email`);
    await sendWeeklyBriefEmail(weeklyBriefId);

    await logCommunication({
      account_id: accountId,
      weekly_brief_id: weeklyBriefId,
      channel: 'weekly_email',
      status: 'sent',
    });

    console.log(`[scheduler] [${accountId}] Weekly pipeline complete`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] [${accountId}] Weekly pipeline failed: ${message}`);
    await logCommunication({
      account_id: accountId,
      channel: 'weekly_email',
      status: 'failed',
      error_message: message,
    });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getLocalHour(timezone: string, utcDate: Date): number {
  try {
    const zonedDate = toZonedTime(utcDate, timezone);
    return zonedDate.getHours();
  } catch {
    // Invalid timezone — fall back to UTC
    return utcDate.getUTCHours();
  }
}

function getLocalDayOfWeek(timezone: string, utcDate: Date): number {
  try {
    const zonedDate = toZonedTime(utcDate, timezone);
    return zonedDate.getDay(); // 0=Sunday, 1=Monday, ...
  } catch {
    return utcDate.getUTCDay();
  }
}

async function getAccountTimezone(accountId: string): Promise<string | null> {
  const { data } = await supabase
    .from('user_intelligence_config')
    .select('timezone')
    .eq('account_id', accountId)
    .maybeSingle();
  return data?.timezone ?? null;
}
