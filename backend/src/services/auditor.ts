import axios from 'axios';
import cron from 'node-cron';
import { supabase } from '../lib/supabase.js';
import { resend } from '../lib/resend.js';
import { env } from '../config/env.js';
import { syncYesterdayForAccount } from './shopifySync.js';
import { handleTokenFailure, markTokenHealthy, shouldRetryNow } from '../lib/tokenGuard.js';
import { ensureTokenFresh } from '../lib/shopify.js';
import { isSendEnabled } from './commsGate.js';

const ADMIN_EMAIL = 'tony@richmondpartner.com';
const LOG = '[auditor]';

// ── Alert deduplication ─────────────────────────────────────────────────────

interface CriticalAlert {
  alert_type: string;
  account_id: string | null;
  message: string;
}

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

    await supabase.from('admin_alerts').insert({
      alert_type: alert.alert_type,
      account_id: alert.account_id,
      message: alert.message,
    });

    return true;
  } catch {
    return true;
  }
}

// ── Start auditor (runs every 6 hours) ──────────────────────────────────────

export function startAuditor(): void {
  // Full audit every 6 hours
  cron.schedule('30 */6 * * *', () => {
    runAudit().catch(err => {
      console.error(`${LOG} Unhandled error:`, err);
    });
  });

  // Token-only check every 2 hours (offset from full audit)
  cron.schedule('30 1-23/2 * * *', () => {
    runTokenCheckOnly().catch(err => {
      console.error(`${LOG} Token check error:`, err);
    });
  });

  console.log(`${LOG} Started — full audit every 6h, token check every 2h`);
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

  // Filter out accounts with send_enabled = false
  const enabledAccounts: typeof accounts = [];
  for (const account of accounts) {
    if (await isSendEnabled(account.id)) {
      enabledAccounts.push(account);
    } else {
      console.log(`${LOG} Skipping ${account.email} — send_enabled=false`);
    }
  }

  console.log(`${LOG} Auditing ${enabledAccounts.length} enabled account(s) (${accounts.length - enabledAccounts.length} disabled)`);

  // Run all checks — MONITOR ONLY, no merchant comms
  await checkBriefs(enabledAccounts, criticalAlerts);
  await checkTokens(enabledAccounts, criticalAlerts);
  await checkStaleActions(criticalAlerts);
  await checkDataFreshness(enabledAccounts, criticalAlerts);
  await measurePreviousActions(enabledAccounts);

  // Filter to only NEW alerts (not sent in last 24h)
  const newAlerts: CriticalAlert[] = [];
  for (const alert of criticalAlerts) {
    if (await shouldSendAlert(alert)) {
      newAlerts.push(alert);
    }
  }

  if (newAlerts.length > 0) {
    console.log(`${LOG} ${newAlerts.length} NEW critical alert(s) — sending email to admin`);
    await sendAlertEmail(newAlerts.map(a => a.message));
  } else if (criticalAlerts.length > 0) {
    console.log(`${LOG} ${criticalAlerts.length} alert(s) found but all already sent within 24h — no email`);
  } else {
    console.log(`${LOG} All clear — no issues found`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`${LOG} ══════ Audit complete in ${elapsed}s ══════`);

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

// ── Token-only check (runs every 2 hours, lightweight) ──────────────────────

async function runTokenCheckOnly(): Promise<void> {
  console.log(`${LOG} ── Token check at ${new Date().toISOString()} ──`);

  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, email, language')
    .or('subscription_status.in.(active,trialing,beta),subscription_status.is.null');

  if (!accounts || accounts.length === 0) return;

  const alerts: CriticalAlert[] = [];
  await checkTokens(accounts, alerts);

  // Send URGENTE alerts immediately (bypass 24h dedup for first-time failures)
  const urgentAlerts = alerts.filter(a =>
    a.alert_type === 'token_invalid_new' || a.alert_type === 'token_failing_first',
  );

  if (urgentAlerts.length > 0) {
    const messages = urgentAlerts.map(a => a.message);
    await sendUrgentTokenAlert(messages);
  }

  // Still log all alerts normally (with dedup)
  for (const alert of alerts) {
    await shouldSendAlert(alert);
  }

  console.log(`${LOG} ── Token check done — ${alerts.length} alert(s) ──`);
}

async function sendUrgentTokenAlert(messages: string[]): Promise<void> {
  const alertList = messages.map((m, i) => `<li style="margin:8px 0;color:#2A1F14;">${i + 1}. ${m}</li>`).join('');

  const html = `
    <div style="max-width:600px;margin:0 auto;padding:32px 24px;font-family:'Helvetica Neue',Arial,sans-serif;">
      <h2 style="color:#C0392B;margin:0 0 16px;">URGENTE — Token Shopify en riesgo</h2>
      <p style="color:#2A1F14;font-size:14px;">${messages.length} token(s) con problemas detectados a las ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}:</p>
      <ol style="font-size:14px;line-height:1.6;">${alertList}</ol>
      <p style="color:#C0392B;font-size:14px;font-weight:600;">Actuar AHORA para evitar interrupción del servicio.</p>
      <p style="font-size:13px;color:#2A1F14;">
        <a href="${env.FRONTEND_URL}/admin/status" style="color:#C9964A;font-weight:600;">Ver admin status</a>
      </p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
      <p style="font-size:11px;color:#A89880;">Sillages Token Monitor — alerta urgente cada 2h</p>
    </div>
  `;

  try {
    await resend.emails.send({
      from: `Sillages Alerts <alerts@sillages.app>`,
      to: ADMIN_EMAIL,
      subject: `URGENTE: Token Shopify fallando — acción requerida`,
      html,
    });
    console.log(`${LOG} URGENT token alert sent to ${ADMIN_EMAIL}`);
  } catch (err) {
    console.error(`${LOG} Failed to send urgent alert:`, err instanceof Error ? err.message : err);
  }
}

// ── CHECK 1: Briefs al día (MONITOR ONLY — no email, no generation) ────────

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
        alerts.push({
          alert_type: 'brief_missing',
          account_id: account.id,
          message: `No brief for ${account.email} (last snapshot: ${lastSnap.snapshot_date}). Needs manual investigation.`,
        });
      } else {
        console.log(`${LOG} [briefs] ${account.email} — no snapshots (new account)`);
      }
    } else if (brief.status === 'failed') {
      alerts.push({
        alert_type: 'brief_failed',
        account_id: account.id,
        message: `Brief ${brief.brief_date} FAILED for ${account.email}: ${brief.generation_error ?? 'unknown error'}`,
      });
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
    .select('id, account_id, shop_domain, access_token, refresh_token, token_status, token_failing_since, token_retry_count');

  if (!connections || connections.length === 0) return;

  // Only check connections for enabled accounts
  const enabledIds = new Set(accounts.map(a => a.id));

  for (const conn of connections) {
    if (!enabledIds.has(conn.account_id)) continue;

    if (conn.token_status === 'invalid') {
      const account = accounts.find(a => a.id === conn.account_id);
      const hoursSinceFailure = conn.token_failing_since
        ? Math.floor((Date.now() - new Date(conn.token_failing_since).getTime()) / 3600000)
        : 0;

      console.log(`${LOG} [tokens] ⏳ ${conn.shop_domain} — invalid for ${hoursSinceFailure}h`);

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
          alerts.push({
            alert_type: 'token_invalid_new',
            account_id: conn.account_id,
            message: `Token INVALID for ${conn.shop_domain} (${account?.email}) — all retries exhausted`,
          });
        } else {
          // Alert on FIRST failure too — urgent for shpca_ tokens without refresh_token
          if ((conn.token_retry_count ?? 0) === 0) {
            alerts.push({
              alert_type: 'token_failing_first',
              account_id: conn.account_id,
              message: `Token FAILING for ${conn.shop_domain} (${account?.email}) — first 401/403 detected, retrying. Token type: ${conn.access_token?.startsWith('shpca_') ? 'TEMPORARY (shpca_)' : 'permanent'}. Refresh token: ${conn.refresh_token ? 'YES' : 'NO'}`,
            });
          }
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

  console.log(`${LOG} [actions] ⚠️  Found ${stale.length} stale action(s) — resetting to pending`);

  if (stale.length >= 3) {
    alerts.push({
      alert_type: 'stale_actions',
      account_id: null,
      message: `${stale.length} action(s) stuck in 'approved' without execution for >1 hour`,
    });
  }

  for (const action of stale) {
    console.log(`${LOG} [actions] Resetting: ${action.type} "${action.title}" (${action.id})`);
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
  const accountIds = accounts.map(a => a.id);

  const { data: completedActions } = await supabase
    .from('pending_actions')
    .select('id, account_id, type, title, content, result, executed_at')
    .eq('status', 'completed')
    .in('account_id', accountIds)
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

    console.log(`${LOG} [measure] Discount ${discountCode}: ${timesUsed} uses, ${revenueGenerated.toFixed(2)}`);
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

  console.log(`${LOG} [measure] Product "${productTitle}": ${totalUnits} units, ${totalRevenue.toFixed(2)} in ${snapshots.length} days`);
}

// ── Alert email to ADMIN ONLY ───────────────────────────────────────────────

async function sendAlertEmail(messages: string[]): Promise<void> {
  const alertList = messages.map((a, i) => `<li style="margin:8px 0;color:#2A1F14;">${i + 1}. ${a}</li>`).join('');

  const html = `
    <div style="max-width:600px;margin:0 auto;padding:32px 24px;font-family:'Helvetica Neue',Arial,sans-serif;">
      <h2 style="color:#D35400;margin:0 0 16px;">Sillages — Critical Alert</h2>
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
