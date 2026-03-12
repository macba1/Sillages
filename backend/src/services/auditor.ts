import axios from 'axios';
import cron from 'node-cron';
import { supabase } from '../lib/supabase.js';
import { resend } from '../lib/resend.js';
import { env } from '../config/env.js';
import { syncYesterdayForAccount } from './shopifySync.js';
import { generateBrief } from './briefGenerator.js';
import { sendBriefEmail } from './emailSender.js';
import { sendPushNotification } from './pushNotifier.js';
import { handleTokenFailure, markTokenHealthy, shouldRetryNow } from '../lib/tokenGuard.js';

const ADMIN_EMAIL = 'tony@richmondpartner.com';
const LOG = '[auditor]';

// ── Start auditor (runs every hour at :30) ──────────────────────────────────

export function startAuditor(): void {
  cron.schedule('30 * * * *', () => {
    runAudit().catch(err => {
      console.error(`${LOG} Unhandled error:`, err);
    });
  });

  console.log(`${LOG} Started — auditing every hour at :30`);
}

// ── Main audit ──────────────────────────────────────────────────────────────

export async function runAudit(): Promise<void> {
  const start = Date.now();
  console.log(`${LOG} ══════ Audit started at ${new Date().toISOString()} ══════`);

  const alerts: string[] = [];

  // Load all active accounts
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, email, language')
    .or('subscription_status.in.(active,trialing,beta),subscription_status.is.null');

  if (!accounts || accounts.length === 0) {
    console.log(`${LOG} No active accounts found`);
    return;
  }

  console.log(`${LOG} Auditing ${accounts.length} active account(s)`);

  // Run all checks
  await checkBriefs(accounts, alerts);
  await checkTokens(accounts, alerts);
  await checkStaleActions(alerts);
  await checkDataFreshness(accounts, alerts);

  // Send alert email if anything critical was found
  if (alerts.length > 0) {
    console.log(`${LOG} ${alerts.length} alert(s) found — sending email to admin`);
    await sendAlertEmail(alerts);
  } else {
    console.log(`${LOG} All clear — no issues found`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`${LOG} ══════ Audit complete in ${elapsed}s ══════`);

  // Record this audit run (audit_log table may not exist — non-fatal)
  try {
    await supabase.from('audit_log').insert({
      ran_at: new Date().toISOString(),
      alerts_count: alerts.length,
      alerts: alerts.length > 0 ? alerts : null,
      duration_ms: Date.now() - start,
    });
  } catch {
    // table may not exist yet
  }
}

// ── CHECK 1: Briefs al día ──────────────────────────────────────────────────

async function checkBriefs(
  accounts: Array<{ id: string; email: string; language: string | null }>,
  alerts: string[],
): Promise<void> {
  console.log(`${LOG} [briefs] Checking brief freshness...`);

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  for (const account of accounts) {
    // Check if there's a brief for today or yesterday
    const { data: brief } = await supabase
      .from('intelligence_briefs')
      .select('brief_date, status, generation_error')
      .eq('account_id', account.id)
      .in('brief_date', [today, yesterday])
      .order('brief_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!brief) {
      // No brief at all — check if they have any snapshot to work with
      const { data: lastSnap } = await supabase
        .from('shopify_daily_snapshots')
        .select('snapshot_date')
        .eq('account_id', account.id)
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastSnap) {
        const msg = `No brief for today/yesterday for ${account.email} (last snapshot: ${lastSnap.snapshot_date})`;
        console.log(`${LOG} [briefs] ⚠️  ${msg}`);
        alerts.push(msg);

        // Try to generate a brief from the latest snapshot
        console.log(`${LOG} [briefs] Retrying brief generation for ${account.email}...`);
        try {
          await generateBrief({ accountId: account.id, briefDate: lastSnap.snapshot_date });

          const { data: newBrief } = await supabase
            .from('intelligence_briefs')
            .select('id, status')
            .eq('account_id', account.id)
            .eq('brief_date', lastSnap.snapshot_date)
            .single();

          if (newBrief?.status === 'ready') {
            console.log(`${LOG} [briefs] ✅ Brief regenerated for ${account.email}`);
            await sendBriefEmail(newBrief.id);
          }
        } catch (err) {
          console.error(`${LOG} [briefs] Retry failed for ${account.email}:`, err instanceof Error ? err.message : err);
        }
      } else {
        console.log(`${LOG} [briefs] ${account.email} — no snapshots at all (new account or disconnected)`);
      }
    } else if (brief.status === 'failed') {
      const msg = `Brief ${brief.brief_date} FAILED for ${account.email}: ${brief.generation_error}`;
      console.log(`${LOG} [briefs] ⚠️  ${msg}`);
      alerts.push(msg);

      // Retry generation
      console.log(`${LOG} [briefs] Retrying failed brief for ${account.email}...`);
      try {
        await generateBrief({ accountId: account.id, briefDate: brief.brief_date });
      } catch (err) {
        console.error(`${LOG} [briefs] Retry failed:`, err instanceof Error ? err.message : err);
      }
    } else {
      console.log(`${LOG} [briefs] ✅ ${account.email} — brief ${brief.brief_date} status: ${brief.status}`);
    }
  }
}

// ── CHECK 2: Tokens válidos ─────────────────────────────────────────────────

async function checkTokens(
  accounts: Array<{ id: string; email: string; language: string | null }>,
  alerts: string[],
): Promise<void> {
  console.log(`${LOG} [tokens] Checking Shopify tokens...`);

  const { data: connections } = await supabase
    .from('shopify_connections')
    .select('id, account_id, shop_domain, access_token, token_status, token_failing_since, token_retry_count');

  if (!connections || connections.length === 0) return;

  for (const conn of connections) {
    // Skip already-invalid tokens (merchant has been alerted, waiting for reconnection)
    if (conn.token_status === 'invalid') {
      const account = accounts.find(a => a.id === conn.account_id);
      const hoursSinceFailure = conn.token_failing_since
        ? Math.floor((Date.now() - new Date(conn.token_failing_since).getTime()) / 3600000)
        : 0;

      console.log(`${LOG} [tokens] ⏳ ${conn.shop_domain} — invalid for ${hoursSinceFailure}h, waiting for reconnection`);

      // Send escalated alert if >72h
      if (hoursSinceFailure > 72) {
        alerts.push(`CRITICAL: ${conn.shop_domain} (${account?.email}) token invalid for ${hoursSinceFailure}h — merchant has not reconnected`);
      } else if (hoursSinceFailure > 24) {
        alerts.push(`${conn.shop_domain} (${account?.email}) token invalid for ${hoursSinceFailure}h`);
      }
      continue;
    }

    // For 'failing' tokens, check if enough time has passed for a retry
    if (conn.token_status === 'failing' && conn.token_failing_since) {
      if (!shouldRetryNow(conn.token_retry_count ?? 0, conn.token_failing_since)) {
        console.log(`${LOG} [tokens] ⏳ ${conn.shop_domain} — failing (retry ${conn.token_retry_count}/3), waiting for backoff`);
        continue;
      }
    }

    // Test the token
    try {
      await axios.get(`https://${conn.shop_domain}/admin/api/2024-04/shop.json`, {
        headers: { 'X-Shopify-Access-Token': conn.access_token },
        timeout: 10000,
      });

      // Token works — reset to healthy
      await markTokenHealthy(conn.shop_domain);
      console.log(`${LOG} [tokens] ✅ ${conn.shop_domain} — token valid`);
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : null;
      if (status === 401 || status === 403) {
        // Use tokenGuard for graduated retry + alerting
        const canRetry = await handleTokenFailure(conn.shop_domain);
        const account = accounts.find(a => a.id === conn.account_id);

        if (canRetry) {
          console.log(`${LOG} [tokens] ⚠️  ${conn.shop_domain} — failing, will retry later`);
        } else {
          const msg = `Token INVALID for ${conn.shop_domain} (${account?.email}) — merchant alerted to reconnect`;
          console.log(`${LOG} [tokens] ❌ ${msg}`);
          alerts.push(msg);
        }
      } else {
        console.log(`${LOG} [tokens] ⚠️  ${conn.shop_domain} — non-auth error: ${axios.isAxiosError(err) ? err.response?.status : err}`);
      }
    }
  }
}

// ── CHECK 3: Acciones estancadas ────────────────────────────────────────────

async function checkStaleActions(alerts: string[]): Promise<void> {
  console.log(`${LOG} [actions] Checking stale actions...`);

  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();

  // Find actions that are 'approved' but never executed (approved_at > 1 hour ago)
  const { data: stale } = await supabase
    .from('pending_actions')
    .select('id, account_id, type, title, approved_at')
    .eq('status', 'approved')
    .is('executed_at', null)
    .lt('approved_at', oneHourAgo);

  if (!stale || stale.length === 0) {
    console.log(`${LOG} [actions] ✅ No stale actions`);
    return;
  }

  console.log(`${LOG} [actions] ⚠️  Found ${stale.length} stale action(s) — retrying execution`);
  alerts.push(`${stale.length} action(s) stuck in 'approved' without execution for >1 hour`);

  for (const action of stale) {
    console.log(`${LOG} [actions] Retrying: ${action.type} "${action.title}" (${action.id})`);

    // Re-set to pending so the approve flow can re-execute
    await supabase
      .from('pending_actions')
      .update({ status: 'pending', approved_at: null })
      .eq('id', action.id);

    console.log(`${LOG} [actions] Reset ${action.id} to pending for retry`);
  }
}

// ── CHECK 4: Data freshness ─────────────────────────────────────────────────

async function checkDataFreshness(
  accounts: Array<{ id: string; email: string; language: string | null }>,
  alerts: string[],
): Promise<void> {
  console.log(`${LOG} [freshness] Checking data freshness...`);

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  for (const account of accounts) {
    const { data: latestSnap } = await supabase
      .from('shopify_daily_snapshots')
      .select('snapshot_date')
      .eq('account_id', account.id)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestSnap) {
      console.log(`${LOG} [freshness] ${account.email} — no snapshots (new account)`);
      continue;
    }

    if (latestSnap.snapshot_date < yesterday) {
      const daysBehind = Math.floor(
        (new Date(yesterday).getTime() - new Date(latestSnap.snapshot_date).getTime()) / 86400000,
      );
      console.log(`${LOG} [freshness] ⚠️  ${account.email} — data is ${daysBehind} day(s) behind (last: ${latestSnap.snapshot_date})`);

      if (daysBehind >= 2) {
        alerts.push(`${account.email} data is ${daysBehind} days stale (last snapshot: ${latestSnap.snapshot_date})`);
      }

      // Try to sync
      console.log(`${LOG} [freshness] Attempting sync for ${account.email}...`);
      try {
        await syncYesterdayForAccount(account.id);
        console.log(`${LOG} [freshness] ✅ Sync successful for ${account.email}`);
      } catch (err) {
        const status = axios.isAxiosError(err) ? err.response?.status : null;
        if (status === 401 || status === 403) {
          console.log(`${LOG} [freshness] ${account.email} — Shopify token invalid, can't sync`);
        } else {
          console.error(`${LOG} [freshness] Sync failed for ${account.email}:`, err instanceof Error ? err.message : err);
        }
      }
    } else {
      console.log(`${LOG} [freshness] ✅ ${account.email} — data up to date (${latestSnap.snapshot_date})`);
    }
  }
}

// ── Alert email to admin ────────────────────────────────────────────────────

async function sendAlertEmail(alerts: string[]): Promise<void> {
  const alertList = alerts.map((a, i) => `<li style="margin:8px 0;color:#2A1F14;">${i + 1}. ${a}</li>`).join('');

  const html = `
    <div style="max-width:600px;margin:0 auto;padding:32px 24px;font-family:'Helvetica Neue',Arial,sans-serif;">
      <h2 style="color:#D35400;margin:0 0 16px;">⚠️ Sillages Auditor Alert</h2>
      <p style="color:#2A1F14;font-size:14px;">The auditor found ${alerts.length} issue(s) at ${new Date().toISOString()}:</p>
      <ol style="font-size:14px;line-height:1.6;">${alertList}</ol>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
      <p style="font-size:11px;color:#A89880;">Sillages Auditor — automated system health check</p>
    </div>
  `;

  try {
    await resend.emails.send({
      from: `Sillages Auditor <alerts@sillages.app>`,
      to: ADMIN_EMAIL,
      subject: `[Sillages] ${alerts.length} auditor alert(s) — ${new Date().toISOString().slice(0, 16)}`,
      html,
    });
    console.log(`${LOG} Alert email sent to ${ADMIN_EMAIL}`);
  } catch (err) {
    console.error(`${LOG} Failed to send alert email:`, err instanceof Error ? err.message : err);
  }
}
