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
import { ensureTokenFresh } from '../lib/shopify.js';

const ADMIN_EMAIL = 'tony@richmondpartner.com';
const LOG = '[auditor]';

// ── Alert deduplication ─────────────────────────────────────────────────────

interface CriticalAlert {
  alert_type: string;
  account_id: string | null;
  message: string;
}

/**
 * Check if an alert of the same type+account was already sent in the last 24h.
 * If not, record it and return true (should send). If yes, return false (skip).
 */
async function shouldSendAlert(alert: CriticalAlert): Promise<boolean> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 3600000).toISOString();

  try {
    let query = supabase
      .from('admin_alerts')
      .select('id')
      .eq('alert_type', alert.alert_type)
      .gte('sent_at', twentyFourHoursAgo)
      .limit(1);

    if (alert.account_id) {
      query = query.eq('account_id', alert.account_id);
    } else {
      query = query.is('account_id', null);
    }

    const { data: existing } = await query;
    if (existing && existing.length > 0) {
      console.log(`${LOG} Skipping duplicate alert: ${alert.alert_type} (sent within 24h)`);
      return false;
    }

    // Record this alert
    await supabase.from('admin_alerts').insert({
      alert_type: alert.alert_type,
      account_id: alert.account_id,
      message: alert.message,
    });

    return true;
  } catch {
    // Table may not exist yet — send anyway to be safe
    return true;
  }
}

// ── Start auditor (runs every 6 hours) ──────────────────────────────────────

export function startAuditor(): void {
  cron.schedule('30 */6 * * *', () => {
    runAudit().catch(err => {
      console.error(`${LOG} Unhandled error:`, err);
    });
  });

  console.log(`${LOG} Started — auditing every 6 hours at :30`);
}

// ── Main audit ──────────────────────────────────────────────────────────────

export async function runAudit(): Promise<void> {
  const start = Date.now();
  console.log(`${LOG} ══════ Audit started at ${new Date().toISOString()} ══════`);

  const criticalAlerts: CriticalAlert[] = [];

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
  await checkBriefs(accounts, criticalAlerts);
  await checkTokens(accounts, criticalAlerts);
  await checkStaleActions(criticalAlerts);
  await checkDataFreshness(accounts, criticalAlerts);
  await measurePreviousActions(accounts);

  // Filter to only NEW alerts (not sent in last 24h)
  const newAlerts: CriticalAlert[] = [];
  for (const alert of criticalAlerts) {
    if (await shouldSendAlert(alert)) {
      newAlerts.push(alert);
    }
  }

  if (newAlerts.length > 0) {
    console.log(`${LOG} ${newAlerts.length} NEW critical alert(s) — sending email`);
    await sendAlertEmail(newAlerts.map(a => a.message));
  } else if (criticalAlerts.length > 0) {
    console.log(`${LOG} ${criticalAlerts.length} alert(s) found but all already sent within 24h — no email`);
  } else {
    console.log(`${LOG} All clear — no issues found`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`${LOG} ══════ Audit complete in ${elapsed}s ══════`);

  // Record this audit run
  try {
    await supabase.from('audit_log').insert({
      ran_at: new Date().toISOString(),
      alerts_count: criticalAlerts.length,
      alerts: criticalAlerts.length > 0 ? criticalAlerts.map(a => a.message) : null,
      duration_ms: Date.now() - start,
    });
  } catch {
    // table may not exist yet
  }
}

// ── CHECK 1: Briefs al día ──────────────────────────────────────────────────

async function checkBriefs(
  accounts: Array<{ id: string; email: string; language: string | null }>,
  alerts: CriticalAlert[],
): Promise<void> {
  console.log(`${LOG} [briefs] Checking brief freshness...`);

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  for (const account of accounts) {
    const { data: brief } = await supabase
      .from('intelligence_briefs')
      .select('brief_date, status, generation_error')
      .eq('account_id', account.id)
      .in('brief_date', [today, yesterday])
      .order('brief_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!brief) {
      const { data: lastSnap } = await supabase
        .from('shopify_daily_snapshots')
        .select('snapshot_date')
        .eq('account_id', account.id)
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastSnap) {
        // Try to generate — only alert if retry ALSO fails
        console.log(`${LOG} [briefs] No brief for ${account.email} — retrying...`);
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
          } else {
            // Retry succeeded but brief not ready — CRITICAL
            alerts.push({
              alert_type: 'brief_failed',
              account_id: account.id,
              message: `Brief generation failed for ${account.email} after retry (status: ${newBrief?.status})`,
            });
          }
        } catch (err) {
          // Retry failed — CRITICAL
          alerts.push({
            alert_type: 'brief_failed',
            account_id: account.id,
            message: `Brief generation failed for ${account.email}: ${err instanceof Error ? err.message : err}`,
          });
        }
      } else {
        // No snapshots at all — NOT critical (new account), just log
        console.log(`${LOG} [briefs] ${account.email} — no snapshots (new account)`);
      }
    } else if (brief.status === 'failed') {
      // Try to retry
      console.log(`${LOG} [briefs] Brief ${brief.brief_date} FAILED for ${account.email} — retrying...`);
      try {
        await generateBrief({ accountId: account.id, briefDate: brief.brief_date });
        console.log(`${LOG} [briefs] ✅ Brief retried for ${account.email}`);
      } catch (err) {
        // Retry also failed — CRITICAL
        alerts.push({
          alert_type: 'brief_failed',
          account_id: account.id,
          message: `Brief ${brief.brief_date} FAILED for ${account.email} and retry failed: ${err instanceof Error ? err.message : err}`,
        });
      }
    } else {
      console.log(`${LOG} [briefs] ✅ ${account.email} — brief ${brief.brief_date} status: ${brief.status}`);
    }
  }
}

// ── CHECK 2: Tokens válidos ─────────────────────────────────────────────────

async function checkTokens(
  accounts: Array<{ id: string; email: string; language: string | null }>,
  alerts: CriticalAlert[],
): Promise<void> {
  console.log(`${LOG} [tokens] Checking Shopify tokens...`);

  const { data: connections } = await supabase
    .from('shopify_connections')
    .select('id, account_id, shop_domain, access_token, token_status, token_failing_since, token_retry_count');

  if (!connections || connections.length === 0) return;

  for (const conn of connections) {
    if (conn.token_status === 'invalid') {
      const account = accounts.find(a => a.id === conn.account_id);
      const hoursSinceFailure = conn.token_failing_since
        ? Math.floor((Date.now() - new Date(conn.token_failing_since).getTime()) / 3600000)
        : 0;

      console.log(`${LOG} [tokens] ⏳ ${conn.shop_domain} — invalid for ${hoursSinceFailure}h`);

      // Only alert for CRITICAL: >72h invalid
      if (hoursSinceFailure > 72) {
        alerts.push({
          alert_type: 'token_invalid_critical',
          account_id: conn.account_id,
          message: `CRITICAL: ${conn.shop_domain} (${account?.email}) token invalid for ${hoursSinceFailure}h — send reconnect link manually`,
        });
      }
      continue;
    }

    if (conn.token_status === 'failing' && conn.token_failing_since) {
      if (!shouldRetryNow(conn.token_retry_count ?? 0, conn.token_failing_since)) {
        console.log(`${LOG} [tokens] ⏳ ${conn.shop_domain} — failing (retry ${conn.token_retry_count}/3), waiting`);
        continue;
      }
    }

    await ensureTokenFresh(conn.shop_domain, 2 * 3600000);

    const { data: freshConn } = await supabase
      .from('shopify_connections')
      .select('access_token')
      .eq('id', conn.id)
      .single();
    const currentToken = freshConn?.access_token ?? conn.access_token;

    try {
      await axios.get(`https://${conn.shop_domain}/admin/api/2024-04/shop.json`, {
        headers: { 'X-Shopify-Access-Token': currentToken },
        timeout: 10000,
      });
      await markTokenHealthy(conn.shop_domain);
      console.log(`${LOG} [tokens] ✅ ${conn.shop_domain} — token valid`);
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : null;
      if (status === 401 || status === 403) {
        const canRetry = await handleTokenFailure(conn.shop_domain);
        const account = accounts.find(a => a.id === conn.account_id);

        if (!canRetry) {
          // Token exhausted all retries — CRITICAL, first time going invalid
          alerts.push({
            alert_type: 'token_invalid_new',
            account_id: conn.account_id,
            message: `Token INVALID for ${conn.shop_domain} (${account?.email}) — all retries exhausted`,
          });
        } else {
          console.log(`${LOG} [tokens] ⚠️  ${conn.shop_domain} — failing, will retry later`);
        }
      } else {
        console.log(`${LOG} [tokens] ⚠️  ${conn.shop_domain} — non-auth error: ${axios.isAxiosError(err) ? err.response?.status : err}`);
      }
    }
  }
}

// ── CHECK 3: Acciones estancadas ────────────────────────────────────────────

async function checkStaleActions(alerts: CriticalAlert[]): Promise<void> {
  console.log(`${LOG} [actions] Checking stale actions...`);

  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();

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

  // Only alert if >3 stale actions (occasional stale is normal)
  if (stale.length >= 3) {
    alerts.push({
      alert_type: 'stale_actions',
      account_id: null,
      message: `${stale.length} action(s) stuck in 'approved' without execution for >1 hour`,
    });
  }

  for (const action of stale) {
    console.log(`${LOG} [actions] Retrying: ${action.type} "${action.title}" (${action.id})`);
    await supabase
      .from('pending_actions')
      .update({ status: 'pending', approved_at: null })
      .eq('id', action.id);
  }
}

// ── CHECK 4: Data freshness ─────────────────────────────────────────────────

async function checkDataFreshness(
  accounts: Array<{ id: string; email: string; language: string | null }>,
  alerts: CriticalAlert[],
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
      console.log(`${LOG} [freshness] ⚠️  ${account.email} — data is ${daysBehind} day(s) behind`);

      // Try to sync silently
      try {
        await syncYesterdayForAccount(account.id);
        console.log(`${LOG} [freshness] ✅ Sync successful for ${account.email}`);
      } catch (err) {
        const status = axios.isAxiosError(err) ? err.response?.status : null;
        if (status === 401 || status === 403) {
          console.log(`${LOG} [freshness] ${account.email} — token invalid, can't sync`);
        } else {
          console.error(`${LOG} [freshness] Sync failed for ${account.email}:`, err instanceof Error ? err.message : err);
        }
      }

      // Only alert if data is 3+ days stale (not for 1-2 day gaps — those self-resolve)
      if (daysBehind >= 3) {
        alerts.push({
          alert_type: 'data_stale',
          account_id: account.id,
          message: `${account.email} data is ${daysBehind} days stale (last: ${latestSnap.snapshot_date}). Sync attempted.`,
        });
      }
    } else {
      console.log(`${LOG} [freshness] ✅ ${account.email} — data up to date (${latestSnap.snapshot_date})`);
    }
  }
}

// ── CHECK 5: Measure previous actions ────────────────────────────────────────

async function measurePreviousActions(
  accounts: Array<{ id: string; email: string; language: string | null }>,
): Promise<void> {
  console.log(`${LOG} [measure] Measuring impact of completed actions...`);

  const twoDaysAgo = new Date(Date.now() - 48 * 3600000).toISOString();

  const { data: completedActions } = await supabase
    .from('pending_actions')
    .select('id, account_id, type, title, content, result, executed_at')
    .eq('status', 'completed')
    .gte('executed_at', twoDaysAgo)
    .not('result', 'is', null);

  if (!completedActions || completedActions.length === 0) {
    console.log(`${LOG} [measure] No recent completed actions to measure`);
    return;
  }

  for (const action of completedActions) {
    const result = action.result as Record<string, unknown> | null;
    if (result?.measured_impact) continue;

    try {
      if (action.type === 'discount_code') {
        await measureDiscount(action);
      } else if (action.type === 'product_highlight') {
        await measureProductHighlight(action);
      }
    } catch (err) {
      console.error(`${LOG} [measure] Failed to measure action ${action.id}:`, err instanceof Error ? err.message : err);
    }
  }
}

async function measureDiscount(action: {
  id: string; account_id: string; content: Record<string, unknown>; result: Record<string, unknown> | null;
}): Promise<void> {
  const discountCode = (action.content?.discount_code as string) ?? (action.result?.code as string);
  if (!discountCode) return;

  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token, token_status')
    .eq('account_id', action.account_id)
    .single();

  if (!conn || conn.token_status === 'invalid') return;

  try {
    const resp = await axios.get(
      `https://${conn.shop_domain}/admin/api/2024-04/orders.json`,
      {
        headers: { 'X-Shopify-Access-Token': conn.access_token },
        params: { status: 'any', limit: 50, fields: 'id,total_price,discount_codes,created_at' },
        timeout: 10000,
      },
    );

    const orders = resp.data.orders as Array<{
      id: number; total_price: string; discount_codes: Array<{ code: string; amount: string }>;
    }>;

    const matchingOrders = orders.filter(o =>
      o.discount_codes?.some(dc => dc.code.toUpperCase() === discountCode.toUpperCase()),
    );

    const timesUsed = matchingOrders.length;
    const revenueGenerated = matchingOrders.reduce((sum, o) => sum + parseFloat(o.total_price), 0);

    await supabase
      .from('pending_actions')
      .update({
        result: {
          ...(action.result ?? {}),
          measured_impact: { times_used: timesUsed, revenue_generated: revenueGenerated, measured_at: new Date().toISOString() },
        },
      })
      .eq('id', action.id);

    console.log(`${LOG} [measure] Discount ${discountCode}: ${timesUsed} uses, €${revenueGenerated.toFixed(2)}`);
  } catch (err) {
    console.error(`${LOG} [measure] Failed to check discount ${discountCode}:`, err instanceof Error ? err.message : err);
  }
}

async function measureProductHighlight(action: {
  id: string; account_id: string; result: Record<string, unknown> | null;
}): Promise<void> {
  const productTitle = action.result?.product as string;
  if (!productTitle) return;

  const executedAt = action.result?.executed_at ?? new Date().toISOString();
  const executedDate = typeof executedAt === 'string' ? executedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);

  const { data: snapshots } = await supabase
    .from('shopify_daily_snapshots')
    .select('snapshot_date, top_products')
    .eq('account_id', action.account_id)
    .gte('snapshot_date', executedDate)
    .order('snapshot_date', { ascending: true })
    .limit(7);

  if (!snapshots || snapshots.length === 0) return;

  let totalUnits = 0;
  let totalRevenue = 0;
  for (const snap of snapshots) {
    const products = snap.top_products as Array<{ title: string; quantity_sold: number; revenue: number }> | null;
    const match = products?.find(p => p.title.toLowerCase().includes(productTitle.toLowerCase()));
    if (match) {
      totalUnits += match.quantity_sold;
      totalRevenue += match.revenue;
    }
  }

  await supabase
    .from('pending_actions')
    .update({
      result: {
        ...(action.result ?? {}),
        measured_impact: {
          sales_after_highlight: totalUnits,
          revenue_after_highlight: totalRevenue,
          days_measured: snapshots.length,
          measured_at: new Date().toISOString(),
        },
      },
    })
    .eq('id', action.id);

  console.log(`${LOG} [measure] Product "${productTitle}": ${totalUnits} units, €${totalRevenue.toFixed(2)} in ${snapshots.length} days`);
}

// ── Alert email to admin (only for NEW critical alerts) ─────────────────────

async function sendAlertEmail(messages: string[]): Promise<void> {
  const alertList = messages.map((a, i) => `<li style="margin:8px 0;color:#2A1F14;">${i + 1}. ${a}</li>`).join('');

  const html = `
    <div style="max-width:600px;margin:0 auto;padding:32px 24px;font-family:'Helvetica Neue',Arial,sans-serif;">
      <h2 style="color:#D35400;margin:0 0 16px;">⚠️ Sillages — Critical Alert</h2>
      <p style="color:#2A1F14;font-size:14px;">${messages.length} new issue(s) found at ${new Date().toISOString().slice(0, 16)}:</p>
      <ol style="font-size:14px;line-height:1.6;">${alertList}</ol>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
      <p style="font-size:11px;color:#A89880;">These alerts won't repeat for 24h. Check <a href="${env.FRONTEND_URL}/admin/status">admin status</a> for live view.</p>
    </div>
  `;

  try {
    await resend.emails.send({
      from: `Sillages Auditor <alerts@sillages.app>`,
      to: ADMIN_EMAIL,
      subject: `[Sillages] ${messages.length} critical alert(s)`,
      html,
    });
    console.log(`${LOG} Alert email sent to ${ADMIN_EMAIL}`);
  } catch (err) {
    console.error(`${LOG} Failed to send alert email:`, err instanceof Error ? err.message : err);
  }
}
