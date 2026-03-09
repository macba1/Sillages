import cron from 'node-cron';
import axios from 'axios';
import { toZonedTime } from 'date-fns-tz';
import { supabase } from '../lib/supabase.js';
import { syncYesterdayForAccount } from './shopifySync.js';
import { generateBrief } from './briefGenerator.js';
import { sendBriefEmail } from './emailSender.js';

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
  console.log(`[scheduler] [${accountId}] Step 1/3 — Shopify sync`);
  let snapshotDate: string;

  try {
    const result = await syncYesterdayForAccount(accountId);
    snapshotDate = result.snapshotDate;
  } catch (syncErr) {
    const httpStatus = axios.isAxiosError(syncErr) ? syncErr.response?.status : null;
    const is403or401 = httpStatus === 403 || httpStatus === 401;

    if (is403or401) {
      console.log(`[scheduler] Shopify ${httpStatus} — falling back to last available snapshot for account ${accountId}`);

      const { data: lastSnapshot } = await supabase
        .from('shopify_daily_snapshots')
        .select('snapshot_date')
        .eq('account_id', accountId)
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!lastSnapshot) {
        console.log(`[scheduler] No data available for account ${accountId} — skipping until Shopify access is confirmed`);
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

  try {
    // Step 2: Generate the AI brief
    console.log(`[scheduler] [${accountId}] Step 2/3 — Brief generation`);
    await generateBrief({ accountId, briefDate: snapshotDate });

    // Step 3: Look up the brief record and send the email
    const { data: brief, error: briefError } = await supabase
      .from('intelligence_briefs')
      .select('id, status')
      .eq('account_id', accountId)
      .eq('brief_date', snapshotDate)
      .single();

    if (briefError || !brief) {
      console.warn(`[scheduler] [${accountId}] Could not find brief after generation — skipping email`);
      return;
    }

    if (brief.status === 'failed') {
      console.warn(`[scheduler] [${accountId}] Brief generation failed — skipping email`);
      return;
    }

    console.log(`[scheduler] [${accountId}] Step 3/3 — Email delivery`);
    await sendBriefEmail(brief.id);

    console.log(`[scheduler] [${accountId}] Pipeline complete`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] [${accountId}] Pipeline error: ${message}`);
    // Don't rethrow — one account's failure shouldn't block the rest
  }
}

function getLocalHour(timezone: string, utcDate: Date): number {
  try {
    const zonedDate = toZonedTime(utcDate, timezone);
    return zonedDate.getHours();
  } catch {
    // Invalid timezone — fall back to UTC
    return utcDate.getUTCHours();
  }
}
