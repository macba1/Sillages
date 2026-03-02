import cron from 'node-cron';
import { toZonedTime } from 'date-fns-tz';
import { supabase } from '../lib/supabase.js';
import { syncYesterdayForAccount } from './shopifySync.js';
import { generateBrief } from './briefGenerator.js';
import { sendBriefEmail } from './emailSender.js';

// Runs every hour at :05 — checks which accounts are due for their brief
// based on their configured timezone and send_hour
export function startScheduler(): void {
  cron.schedule('5 * * * *', () => {
    runHourlyCheck().catch((err) => {
      console.error('[scheduler] Unhandled error in hourly check:', err);
    });
  });

  console.log('[scheduler] Started — checking every hour at :05 for due briefs');
}

async function runHourlyCheck(): Promise<void> {
  const now = new Date();
  console.log(`[scheduler] Hourly check at ${now.toISOString()}`);

  // Load all configs for accounts with an active/trialing subscription
  const { data: configs, error } = await supabase
    .from('user_intelligence_config')
    .select(
      `
      account_id,
      timezone,
      send_hour,
      accounts!inner (
        subscription_status
      )
    `,
    )
    .eq('send_enabled', true)
    .in('accounts.subscription_status', ['active', 'trialing']);

  if (error) {
    console.error('[scheduler] Failed to load configs:', error.message);
    return;
  }

  if (!configs || configs.length === 0) {
    console.log('[scheduler] No enabled accounts found');
    return;
  }

  const due: string[] = [];

  for (const config of configs) {
    const localHour = getLocalHour(config.timezone, now);
    if (localHour === config.send_hour) {
      due.push(config.account_id);
    }
  }

  console.log(`[scheduler] ${due.length} account(s) due for brief generation`);

  // Process each account sequentially to avoid overloading external APIs
  for (const accountId of due) {
    await runBriefPipeline(accountId);
  }
}

async function runBriefPipeline(accountId: string): Promise<void> {
  console.log(`[scheduler] Starting brief pipeline for account: ${accountId}`);

  try {
    // Step 1: Sync yesterday's Shopify data
    console.log(`[scheduler] [${accountId}] Step 1/3 — Shopify sync`);
    const { snapshotDate } = await syncYesterdayForAccount(accountId);

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
