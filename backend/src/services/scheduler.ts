import cron from 'node-cron';
import axios from 'axios';
import { toZonedTime } from 'date-fns-tz';
import { supabase } from '../lib/supabase.js';
import { syncYesterdayForAccount } from './shopifySync.js';
import { generateBrief } from './briefGenerator.js';
import { sendBriefEmail } from './emailSender.js';
import { runBriefWorkflow } from '../workflows/brief.js';
import { runRecoveryWorkflow } from '../workflows/recovery.js';
import { runHealthWorkflow } from '../workflows/health.js';
import { runLeadsWorkflow } from '../workflows/leads.js';
import { runOutreachWorkflow } from '../workflows/outreach.js';
import { runNurtureWorkflow } from '../workflows/nurture.js';
import { runInboxWorkflow } from '../workflows/inbox.js';
import { env } from '../config/env.js';
import { executeCartRecovery } from '../routes/actions.js';
import { syncAbandonedCarts } from './abandonedCartsSync.js';
import { detectEvents } from './eventDetector.js';
import type { AbandonedCartData } from './eventDetector.js';
import { generateEventAction } from './eventActionGenerator.js';
import { shopifyClient } from '../lib/shopify.js';
import { generateWeeklyBrief } from './weeklyBriefGenerator.js';
import { logCommunication } from './commLog.js';
import { isSendEnabled, gatePush, gateWeeklyEmail } from './commsGate.js';
import { handleTokenFailure, markTokenHealthy } from '../lib/tokenGuard.js';
import { ensureTokenFresh } from '../lib/shopify.js';
import { runOrchestrator } from './orchestrator.js';
import { verifyAllWebhooks } from './shopifyWebhooks.js';
import { runTrialReminders } from './trialReminders.js';

// ═══════════════════════════════════════════════════════════════════════════
// EVENT-DRIVEN SCHEDULER
// 3 loops: event detection (hourly), daily summary (at send_hour), weekly (Monday)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Acquire a scheduler lock to prevent double execution (e.g. multiple Railway instances).
 * Returns true if lock acquired, false if another process holds it.
 */
async function acquireSchedulerLock(lockName: string, ttlMs: number = 300000): Promise<boolean> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  try {
    // Delete expired locks first
    await supabase.from('scheduler_locks').delete().lt('expires_at', now);

    // Try to insert — unique constraint on lock_name prevents duplicates
    const { error } = await supabase.from('scheduler_locks').insert({
      lock_name: lockName,
      acquired_at: now,
      expires_at: expiresAt,
    });

    if (error) {
      if (error.code === '23505') {
        console.log(`[scheduler] Lock "${lockName}" already held — skipping`);
        return false;
      }
      // Table might not exist yet — proceed without lock
      console.warn(`[scheduler] Lock table error (proceeding): ${error.message}`);
      return true;
    }

    return true;
  } catch {
    // Table might not exist — proceed without lock
    return true;
  }
}

async function releaseSchedulerLock(lockName: string): Promise<void> {
  try {
    await supabase.from('scheduler_locks').delete().eq('lock_name', lockName);
  } catch { /* non-fatal */ }
}

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

  // Orchestrator / Health workflow: every 30 minutes (at :00 and :30)
  cron.schedule('0,30 * * * *', () => {
    if (env.USE_DYNAMIC_HEALTH) {
      console.log('[scheduler] USE_DYNAMIC_HEALTH=true — running health workflow');
      runHealthWorkflow().catch(err => {
        console.error('[scheduler] Health workflow error:', err);
      });
    } else {
      runOrchestrator().catch(err => {
        console.error('[scheduler] Orchestrator error:', err);
      });
    }
  });

  // Trial reminders: once daily at 02:00 UTC
  cron.schedule('0 2 * * *', () => {
    runTrialReminders().catch(err => {
      console.error('[scheduler] Trial reminders error:', err);
    });
  });

  // Leads workflow: daily at 06:00 UTC
  if (env.USE_DYNAMIC_LEADS) {
    cron.schedule('0 6 * * *', () => {
      console.log('[scheduler] USE_DYNAMIC_LEADS=true — running leads workflow');
      runLeadsWorkflow().catch(err => {
        console.error('[scheduler] Leads workflow error:', err);
      });
    });
  }

  // Outreach workflow: daily at 09:00 UTC
  if (env.USE_DYNAMIC_OUTREACH) {
    cron.schedule('0 9 * * *', () => {
      console.log('[scheduler] USE_DYNAMIC_OUTREACH=true — running outreach workflow');
      runOutreachWorkflow().catch(err => {
        console.error('[scheduler] Outreach workflow error:', err);
      });
    });
  }

  // Nurture workflow: daily at 10:00 UTC
  if (env.USE_DYNAMIC_NURTURE) {
    cron.schedule('0 10 * * *', () => {
      console.log('[scheduler] USE_DYNAMIC_NURTURE=true — running nurture workflow');
      runNurtureWorkflow().catch(err => {
        console.error('[scheduler] Nurture workflow error:', err);
      });
    });
  }

  // Inbox workflow: every 15 minutes
  if (env.USE_DYNAMIC_INBOX) {
    cron.schedule('*/15 * * * *', () => {
      runInboxWorkflow().catch(err => {
        console.error('[scheduler] Inbox workflow error:', err);
      });
    });
  }

  // Webhook verification: once daily at 03:15 UTC
  cron.schedule('15 3 * * *', () => {
    verifyAllWebhooks().catch(err => {
      console.error('[scheduler] Webhook verification error:', err);
    });
  });

  // Verify webhooks on startup (fire-and-forget)
  void verifyAllWebhooks().catch(err => {
    console.warn('[scheduler] Startup webhook verification failed (non-fatal):', err);
  });

  console.log('[scheduler] Started — events at :10, daily/weekly at :05, orchestrator at :00/:30, trials at 02:00, webhooks at 03:15');
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
  if (!await acquireSchedulerLock('event_loop')) return;

  try {
    const now = new Date();
    console.log(`[scheduler] Event loop at ${now.toISOString()}`);

    const accounts = await getEligibleAccounts();
    if (accounts.length === 0) return;

    // ── Dynamic workflow path: parallel recovery for all merchants ──
    if (env.USE_DYNAMIC_RECOVERY) {
      console.log(`[scheduler] USE_DYNAMIC_RECOVERY=true — running parallel recovery for ${accounts.length} merchant(s)`);

      // Sync data sequentially (Shopify rate limits)
      for (const accountId of accounts) {
        try { await ensureShopifySync(accountId); } catch { /* non-fatal */ }
      }

      await runRecoveryWorkflow(accounts.map(accountId => ({ accountId })));
      return;
    }

    // ── Legacy sequential path ──
    for (const accountId of accounts) {
      try {
        await processEventsForAccount(accountId);
      } catch (err) {
        console.error(`[scheduler] [${accountId}] Event processing failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await releaseSchedulerLock('event_loop');
  }
}

// Priority order for events: higher priority events get processed first
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

  // Load Shopify connection for real-time purchase checks
  const { data: shopConn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token')
    .eq('account_id', accountId)
    .maybeSingle();

  // 6. Generate actions for ALL events (no individual pushes — one grouped push at the end)
  let actionsGenerated = 0;

  for (const event of sortedEvents) {
    // ── PRE-CHECK: For abandoned carts, verify customer hasn't purchased since detection ──
    if (event.type === 'abandoned_cart' && shopConn) {
      const cartData = event.data as AbandonedCartData;
      try {
        const client = shopifyClient(shopConn.shop_domain, shopConn.access_token);
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
        const { orders } = await client.getOrders({
          created_at_min: sevenDaysAgo,
          created_at_max: new Date().toISOString(),
        });
        const alreadyBought = orders.some(
          o => o.customer?.email?.toLowerCase() === cartData.customer_email.toLowerCase() &&
               o.financial_status !== 'voided' && !o.cancel_reason,
        );
        if (alreadyBought) {
          console.log(`[scheduler] [${accountId}] SKIP ${cartData.customer_name} — already purchased. No action created.`);
          await supabase
            .from('abandoned_carts')
            .update({ recovered: true, recovered_at: new Date().toISOString(), recovery_attribution: 'organic' })
            .eq('account_id', accountId)
            .eq('customer_email', cartData.customer_email)
            .or('recovered.is.null,recovered.eq.false');
          continue;
        }
      } catch (err) {
        console.warn(`[scheduler] [${accountId}] Cannot verify purchase for ${cartData.customer_email} — skipping (fail-closed): ${(err as Error).message}`);
        continue;
      }
    }

    const actionId = await generateEventAction(accountId, event, lang, storeName, currency);
    if (!actionId) continue;

    actionsGenerated++;

    // Auto-approve actions if merchant opted in for the action type
    const autoApproveMap: Record<string, string> = {
      abandoned_cart: 'auto_approve_cart_recovery',
      new_first_buyer: 'auto_approve_welcome',
      overdue_customer: 'auto_approve_reactivation',
    };
    const autoApproveColumn = autoApproveMap[event.type];
    if (autoApproveColumn && actionId) {
      const { data: config } = await supabase
        .from('user_intelligence_config')
        .select(autoApproveColumn)
        .eq('account_id', accountId)
        .maybeSingle();

      if ((config as Record<string, unknown> | null)?.[autoApproveColumn]) {
        try {
          const { data: action } = await supabase
            .from('pending_actions')
            .select('content')
            .eq('id', actionId)
            .single();

          if (action) {
            await executeCartRecovery(accountId, actionId, action.content as Record<string, unknown>);
            console.log(`[scheduler] [${accountId}] Auto-approved ${event.type} action ${actionId}`);
          }
        } catch (autoErr) {
          console.warn(`[scheduler] [${accountId}] Auto-approve failed for ${actionId}: ${(autoErr as Error).message}`);
        }
      }
    }

    // Mark in event_log
    await supabase
      .from('event_log')
      .update({ push_sent: true })
      .eq('account_id', accountId)
      .eq('event_key', event.key);
  }

  // 7. Send ONE grouped push for all new actions (commsGate enforces daily limits)
  if (actionsGenerated > 0) {
    const isEs = lang === 'es';
    const body = actionsGenerated === 1
      ? (isEs ? 'Tienes 1 acción lista para revisar.' : 'You have 1 action ready to review.')
      : (isEs ? `Tienes ${actionsGenerated} acciones listas para revisar.` : `You have ${actionsGenerated} actions ready to review.`);

    try {
      const result = await gatePush(accountId, { title: storeName, body, url: '/actions' }, 'event_push');
      console.log(`[scheduler] [${accountId}] Grouped push for ${actionsGenerated} actions: ${result.sent ? 'sent' : result.queued ? 'queued' : 'skipped (limit)'}`);
    } catch (pushErr) {
      console.warn(`[scheduler] [${accountId}] Grouped push failed: ${(pushErr as Error).message}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LOOP 2: DAILY SUMMARY + WEEKLY EMAIL (at send_hour)
// Daily: simple push with yesterday's numbers
// Monday: full weekly email pipeline
// ═══════════════════════════════════════════════════════════════════════════

async function runDailyAndWeeklyCheck(force = false): Promise<string[]> {
  if (!force && !await acquireSchedulerLock('daily_weekly')) return [];

  try {
    return await _runDailyAndWeeklyCheckInner(force);
  } finally {
    if (!force) await releaseSchedulerLock('daily_weekly');
  }
}

async function _runDailyAndWeeklyCheckInner(force: boolean): Promise<string[]> {
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

  // ── Dynamic workflow path: run all merchants in parallel ──
  if (env.USE_DYNAMIC_BRIEF && due.length > 0) {
    console.log(`[scheduler] USE_DYNAMIC_BRIEF=true — running parallel workflow for ${due.length} merchant(s)`);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    // Step 1: sync data for all merchants (still sequential — Shopify rate limits)
    for (const accountId of due) {
      try {
        let snapshotDate = await ensureShopifySync(accountId);
        if (!snapshotDate) {
          // Create empty-day snapshot
          await supabase.from('shopify_daily_snapshots').upsert({
            account_id: accountId, snapshot_date: yesterday,
            total_revenue: 0, net_revenue: 0, total_orders: 0, average_order_value: 0,
            sessions: 0, conversion_rate: 0, returning_customer_rate: 0,
            new_customers: 0, returning_customers: 0, total_customers: 0,
            top_products: [], total_refunds: 0, cancelled_orders: 0,
            raw_shopify_payload: { empty_day: true },
          }, { onConflict: 'account_id,snapshot_date' });
          snapshotDate = yesterday;
        }
      } catch (syncErr) {
        console.error(`[scheduler] [${accountId}] Sync failed: ${(syncErr as Error).message}`);
      }
    }

    // Step 2: generate briefs in parallel via workflow
    const workflowResult = await runBriefWorkflow(
      due.map(accountId => ({ accountId, briefDate: yesterday })),
    );

    // Step 3: send emails + push for succeeded merchants
    for (const r of workflowResult.merchants) {
      if (!r.success || !r.briefId) continue;
      try {
        await sendBriefEmail(r.briefId);
        console.log(`[scheduler] [${r.accountId}] Brief email sent via workflow`);
      } catch (emailErr) {
        console.error(`[scheduler] [${r.accountId}] Brief email failed: ${(emailErr as Error).message}`);
      }
      await sendDailySummaryPush(r.accountId);
    }

    // Step 4: weekly pipeline for Monday (still per-merchant)
    for (const accountId of due) {
      try {
        const tz = configs.find(c => c.account_id === accountId)?.timezone ?? 'UTC';
        const localDay = getLocalDayOfWeek(tz, now);
        if (localDay === 1) {
          const { hasFeature } = await import('../lib/plans.js');
          if (await hasFeature(accountId, 'weekly_brief')) {
            await runWeeklyPipeline(accountId, now);
          }
        }
      } catch (err) {
        console.error(`[scheduler] [${accountId}] Weekly error: ${(err as Error).message}`);
      }
    }

    return due;
  }

  // ── Legacy sequential path (USE_DYNAMIC_BRIEF=false or unset) ──
  for (const accountId of due) {
    try {
      // Daily: sync data, generate brief, send push summary
      await runDailyBriefPipeline(accountId);

      // Monday → weekly email (queued separately as weekly_email type, not a push)
      const tz = configs.find(c => c.account_id === accountId)?.timezone ?? 'UTC';
      const localDay = getLocalDayOfWeek(tz, now);
      if (localDay === 1) {
        const { hasFeature } = await import('../lib/plans.js');
        const canWeekly = await hasFeature(accountId, 'weekly_brief');
        if (canWeekly) {
          console.log(`[scheduler] [${accountId}] Monday — running weekly pipeline`);
          await runWeeklyPipeline(accountId, now);
        } else {
          console.log(`[scheduler] [${accountId}] Monday — weekly_brief not in plan, skipping`);
        }
      }

      // No reminders — actions wait silently until approved or expired after 7 days
    } catch (err) {
      console.error(`[scheduler] [${accountId}] Daily/weekly error: ${(err as Error).message}`);
    }
  }

  return due;
}

// ── Daily brief pipeline: sync → generate brief → send push ──────────────

async function runDailyBriefPipeline(accountId: string): Promise<void> {
  const pipelineStart = Date.now();
  console.log(`[scheduler] [${accountId}] Starting daily brief pipeline`);

  // 1. Sync yesterday's data
  let snapshotDate = await ensureShopifySync(accountId);

  // If no snapshot (no orders yesterday), create an empty-day snapshot so brief can still generate
  if (!snapshotDate) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    console.log(`[scheduler] [${accountId}] No snapshot from sync — creating empty-day snapshot for ${yesterday}`);

    const { error: emptySnapErr } = await supabase
      .from('shopify_daily_snapshots')
      .upsert({
        account_id: accountId,
        snapshot_date: yesterday,
        total_revenue: 0,
        net_revenue: 0,
        total_orders: 0,
        average_order_value: 0,
        sessions: 0,
        conversion_rate: 0,
        returning_customer_rate: 0,
        new_customers: 0,
        returning_customers: 0,
        total_customers: 0,
        top_products: [],
        total_refunds: 0,
        cancelled_orders: 0,
        raw_shopify_payload: { empty_day: true },
      }, { onConflict: 'account_id,snapshot_date' });

    if (emptySnapErr) {
      console.error(`[scheduler] [${accountId}] Failed to create empty snapshot: ${emptySnapErr.message}`);
      return;
    }
    snapshotDate = yesterday;
  }

  // 2. Check if brief already exists for this date
  const { data: existingBrief } = await supabase
    .from('intelligence_briefs')
    .select('id')
    .eq('account_id', accountId)
    .eq('brief_date', snapshotDate)
    .maybeSingle();

  if (existingBrief) {
    console.log(`[scheduler] [${accountId}] Brief already exists for ${snapshotDate} — skipping generation`);
  } else {
    // 3. Generate the brief
    try {
      await generateBrief({ accountId, briefDate: snapshotDate });
      console.log(`[scheduler] [${accountId}] Daily brief generated for ${snapshotDate} (${Date.now() - pipelineStart}ms)`);
    } catch (err) {
      console.error(`[scheduler] [${accountId}] Brief generation failed: ${(err as Error).message}`);
      // Continue to push even if brief fails — merchant still gets snapshot summary
    }
  }

  // 4. Send daily brief by email
  const { data: briefToSend } = await supabase
    .from('intelligence_briefs')
    .select('id, status')
    .eq('account_id', accountId)
    .eq('brief_date', snapshotDate)
    .eq('status', 'ready')
    .maybeSingle();

  if (briefToSend) {
    try {
      await sendBriefEmail(briefToSend.id);
      console.log(`[scheduler] [${accountId}] Daily brief email sent for ${snapshotDate}`);
    } catch (err) {
      console.error(`[scheduler] [${accountId}] Brief email failed: ${(err as Error).message}`);
    }
  }

  // 5. Send push summary
  await sendDailySummaryPush(accountId);
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

  const result = await gatePush(accountId, { title: storeName, body, url: '/dashboard' }, 'daily_summary_push');
  console.log(`[scheduler] [${accountId}] Daily summary push ${result.sent ? 'sent' : 'queued'}: ${body}`);
}

// Reminders removed — actions wait silently until approved or auto-expired after 7 days.

// ═══════════════════════════════════════════════════════════════════════════
// LOOP 3: WEEKLY PIPELINE (Monday only)
// Full Analyst → Growth Hacker → Auditor → Email
// ═══════════════════════════════════════════════════════════════════════════

async function runWeeklyPipeline(accountId: string, now: Date): Promise<void> {
  const weeklyStart = Date.now();
  try {
    const yesterday = new Date(now.getTime() - 86400000);
    const weekEndDate = yesterday.toISOString().slice(0, 10);
    const weekEnd = new Date(weekEndDate + 'T23:59:59Z');
    const weekStart = new Date(weekEnd.getTime() - 6 * 86400000);
    const weekStartStr = weekStart.toISOString().slice(0, 10);

    // Check if weekly brief already exists for this week (prevent duplicate key)
    const { data: existing } = await supabase
      .from('weekly_briefs')
      .select('id, status')
      .eq('account_id', accountId)
      .eq('week_start', weekStartStr)
      .eq('week_end', weekEndDate)
      .maybeSingle();

    if (existing) {
      console.log(`[scheduler] [${accountId}] Weekly brief already exists (id=${existing.id}, status=${existing.status}) — skipping`);
      return;
    }

    console.log(`[scheduler] [${accountId}] Weekly brief generation START for week ending ${weekEndDate}`);
    const weeklyBriefId = await generateWeeklyBrief(accountId, weekEndDate);
    const genDuration = Date.now() - weeklyStart;
    console.log(`[scheduler] [${accountId}] Weekly brief generation END — ${genDuration}ms`);

    console.log(`[scheduler] [${accountId}] Gating weekly email`);
    const emailResult = await gateWeeklyEmail(accountId, weeklyBriefId);
    console.log(`[scheduler] [${accountId}] Weekly email ${emailResult.sent ? 'sent' : 'queued for approval'}`);

    // Weekly email is already queued in pending_comms via gateWeeklyEmail — no extra push needed
    console.log(`[scheduler] [${accountId}] Weekly email queued — no extra push notification`);

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

// Accounts temporarily excluded from event detection + push notifications.
// Empty = all eligible accounts are active.
const PAUSED_ACCOUNTS: Set<string> = new Set([
  // 'e77572ee-83df-43e8-8f69-f143a227fe56', // marketing@nicolina.es (Andrea) — reactivated 2026-03-16
]);

async function getEligibleAccounts(): Promise<string[]> {
  const { data: accounts, error } = await supabase
    .from('accounts')
    .select('id, email')
    .or('subscription_status.in.(active,trialing,beta),subscription_status.is.null');

  if (error || !accounts) {
    console.error('[scheduler] Failed to load accounts:', error?.message);
    return [];
  }

  // Filter out ghost accounts (Shopify testers/reviewers) + paused accounts
  const GHOST_DOMAINS = ['@shopify.com'];
  const GHOST_EMAILS = new Set(['reviewer@sillages.app']);
  const allIds = accounts
    .filter(a => {
      const email = (a as { email?: string }).email ?? '';
      if (GHOST_EMAILS.has(email)) return false;
      if (GHOST_DOMAINS.some(d => email.endsWith(d))) return false;
      return true;
    })
    .map(a => a.id)
    .filter(id => !PAUSED_ACCOUNTS.has(id));
  const eligible: string[] = [];
  for (const id of allIds) {
    if (await isSendEnabled(id)) {
      eligible.push(id);
    }
  }

  if (eligible.length < accounts.length) {
    console.log(`[scheduler] ${accounts.length - eligible.length} account(s) filtered out, ${eligible.length} eligible`);
  }

  return eligible;
}

async function ensureShopifySync(accountId: string): Promise<string | null> {
  // Pick the most recently synced active connection (multi-store safe)
  const { data: connRow } = await supabase
    .from('shopify_connections')
    .select('shop_domain, token_status')
    .eq('account_id', accountId)
    .eq('token_status', 'active')
    .order('last_synced_at', { ascending: false, nullsFirst: false })
    .limit(1)
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
