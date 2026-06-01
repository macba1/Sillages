/**
 * Dynamic Health Workflow — parallel health checks for N merchants + global system health.
 *
 * Replaces orchestrator.ts health checks when USE_DYNAMIC_HEALTH=true.
 * Per-merchant: token guard, webhook verify, billing check (in parallel).
 * Global: system health (Supabase, Resend).
 * Per-merchant error isolation.
 */

import { supabase } from '../lib/supabase.js';
import { shopifyClient, ensureTokenFresh, getAppSubscriptionStatus, SHOPIFY_PLANS } from '../lib/shopify.js';
import { handleTokenFailure, markTokenHealthy } from '../lib/tokenGuard.js';
import { registerShopifyWebhooks } from '../services/shopifyWebhooks.js';
import { resend } from '../lib/resend.js';
import { env } from '../config/env.js';

const LOG = '[workflow:health]';
const REQUIRED_WEBHOOKS = ['orders/create', 'checkouts/create', 'checkouts/update', 'app/uninstalled', 'app_subscriptions/update'];

// ── Types ──────────────────────────────────────────────────────────────────

type CheckStatus = 'ok' | 'warning' | 'critical' | 'fixed';

interface SubAgentResult {
  name: string;
  status: CheckStatus;
  details: Record<string, unknown>;
  duration_ms: number;
}

interface MerchantHealthResult {
  accountId: string;
  shopDomain: string;
  success: boolean;
  error?: string;
  subagents: SubAgentResult[];
  totalDuration_ms: number;
}

interface SystemHealthResult {
  supabase: { status: CheckStatus; latency_ms: number };
  resend: { status: CheckStatus; domains: number };
  backend: { status: CheckStatus; uptime_s: number };
  duration_ms: number;
}

export interface HealthWorkflowResult {
  system: SystemHealthResult;
  merchants: MerchantHealthResult[];
  totalDuration_ms: number;
  succeeded: number;
  failed: number;
}

// ── Main entry ─────────────────────────────────────────────────────────────

export async function runHealthWorkflow(): Promise<HealthWorkflowResult> {
  const workflowStart = Date.now();
  console.log(`${LOG} Starting health workflow`);

  // Load all active connections
  const { data: connections } = await supabase
    .from('shopify_connections')
    .select('account_id, shop_domain, access_token, token_status, token_failing_since, token_retry_count')
    .order('last_synced_at', { ascending: false, nullsFirst: false });

  const activeConns = connections ?? [];

  // Run system health + all merchant checks in parallel
  const [systemResult, ...merchantResults] = await Promise.all([
    runSystemHealth(),
    ...activeConns.map(conn => runSingleMerchantHealth(conn).catch(err => ({
      accountId: conn.account_id,
      shopDomain: conn.shop_domain,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      subagents: [],
      totalDuration_ms: Date.now() - workflowStart,
    } satisfies MerchantHealthResult))),
  ]);

  const totalDuration = Date.now() - workflowStart;
  const succeeded = merchantResults.filter(r => r.success).length;
  const failed = merchantResults.filter(r => !r.success).length;

  // Log to workflow_runs
  try {
    await supabase.from('workflow_runs').insert({
      workflow: 'health',
      started_at: new Date(workflowStart).toISOString(),
      duration_ms: totalDuration,
      merchants_total: activeConns.length,
      merchants_succeeded: succeeded,
      merchants_failed: failed,
      results: {
        system: systemResult,
        merchants: merchantResults.map(r => ({
          accountId: r.accountId,
          shopDomain: r.shopDomain,
          success: r.success,
          error: r.error ?? null,
          subagents: r.subagents,
        })),
      },
    });
  } catch { /* table may not exist */ }

  // Log summary
  console.log(`${LOG} System: supabase=${systemResult.supabase.status} resend=${systemResult.resend.status} (${systemResult.duration_ms}ms)`);
  for (const r of merchantResults) {
    if (r.success) {
      const summary = r.subagents.map(s => `${s.name}:${s.status}`).join(' ');
      console.log(`${LOG} [${r.shopDomain}] ${summary} (${r.totalDuration_ms}ms)`);
    } else {
      console.error(`${LOG} [${r.shopDomain}] FAILED — ${r.error}`);
    }
  }
  console.log(`${LOG} Complete: ${succeeded}/${activeConns.length} merchants OK, ${totalDuration}ms`);

  return { system: systemResult, merchants: merchantResults, totalDuration_ms: totalDuration, succeeded, failed };
}

// ── SubAgent D: System Health (global) ────────────────────────────────────

async function runSystemHealth(): Promise<SystemHealthResult> {
  const start = Date.now();

  // Supabase check
  let supabaseStatus: CheckStatus = 'ok';
  let supabaseLatency = 0;
  try {
    const sbStart = Date.now();
    await supabase.from('accounts').select('id').limit(1);
    supabaseLatency = Date.now() - sbStart;
    if (supabaseLatency > 5000) supabaseStatus = 'warning';
  } catch {
    supabaseStatus = 'critical';
  }

  // Resend check
  let resendStatus: CheckStatus = 'ok';
  let resendDomains = 0;
  try {
    const domains = await resend.domains.list();
    resendDomains = domains.data?.data?.length ?? 0;
    const sillagesDomain = domains.data?.data?.find((d: { name: string; status: string }) => d.name === 'sillages.app');
    if (!sillagesDomain || sillagesDomain.status !== 'verified') resendStatus = 'warning';
  } catch {
    resendStatus = 'critical';
  }

  // Backend uptime (process uptime)
  const uptimeS = Math.floor(process.uptime());

  return {
    supabase: { status: supabaseStatus, latency_ms: supabaseLatency },
    resend: { status: resendStatus, domains: resendDomains },
    backend: { status: 'ok', uptime_s: uptimeS },
    duration_ms: Date.now() - start,
  };
}

// ── Per-merchant health check ─────────────────────────────────────────────

interface ConnectionRow {
  account_id: string;
  shop_domain: string;
  access_token: string;
  token_status: string | null;
  token_failing_since: string | null;
  token_retry_count: number | null;
}

async function runSingleMerchantHealth(conn: ConnectionRow): Promise<MerchantHealthResult> {
  const merchantStart = Date.now();

  // Run all 3 subagents in parallel
  const [tokenResult, webhookResult, billingResult] = await Promise.all([
    subAgentTokenGuard(conn),
    subAgentWebhookVerify(conn),
    subAgentBillingCheck(conn),
  ]);

  return {
    accountId: conn.account_id,
    shopDomain: conn.shop_domain,
    success: true,
    subagents: [tokenResult, webhookResult, billingResult],
    totalDuration_ms: Date.now() - merchantStart,
  };
}

// ── SubAgent A: Token Guard ───────────────────────────────────────────────

async function subAgentTokenGuard(conn: ConnectionRow): Promise<SubAgentResult> {
  const start = Date.now();
  let status: CheckStatus = 'ok';
  const details: Record<string, unknown> = { shop: conn.shop_domain, tokenStatus: conn.token_status };

  try {
    if (conn.token_status === 'invalid') {
      // Already invalid — try to recover
      const canRetry = await handleTokenFailure(conn.shop_domain);
      if (canRetry) {
        status = 'fixed';
        details.action = 'token_refreshed';
      } else {
        status = 'critical';
        details.action = 'token_unrecoverable';
      }
    } else if (conn.token_status === 'failing') {
      // Failing — try to stabilize
      await ensureTokenFresh(conn.shop_domain);
      status = 'warning';
      details.action = 'token_refresh_attempted';
      details.retryCount = conn.token_retry_count;
    } else {
      // Active — validate with a lightweight API call
      try {
        const client = shopifyClient(conn.shop_domain, conn.access_token);
        await client.getShop();
        await markTokenHealthy(conn.shop_domain);
        details.action = 'validated';
      } catch (apiErr) {
        // API call failed — trigger token failure handler
        const canRetry = await handleTokenFailure(conn.shop_domain);
        status = canRetry ? 'warning' : 'critical';
        details.action = canRetry ? 'failure_detected_retrying' : 'failure_detected_invalid';
        details.error = apiErr instanceof Error ? apiErr.message : String(apiErr);
      }
    }
  } catch (err) {
    status = 'critical';
    details.error = err instanceof Error ? err.message : String(err);
  }

  return { name: 'token', status, details, duration_ms: Date.now() - start };
}

// ── SubAgent B: Webhook Verify ────────────────────────────────────────────

async function subAgentWebhookVerify(conn: ConnectionRow): Promise<SubAgentResult> {
  const start = Date.now();
  let status: CheckStatus = 'ok';
  const details: Record<string, unknown> = {};

  if (conn.token_status === 'invalid') {
    return { name: 'webhooks', status: 'warning', details: { skipped: 'token_invalid' }, duration_ms: Date.now() - start };
  }

  try {
    const client = shopifyClient(conn.shop_domain, conn.access_token);
    const existingWebhooks = await client.listWebhooks();
    const existingTopics = existingWebhooks.map(w => w.topic);

    const missing = REQUIRED_WEBHOOKS.filter(t => !existingTopics.includes(t));
    details.registered = existingTopics.length;
    details.required = REQUIRED_WEBHOOKS.length;
    details.missing = missing;

    if (missing.length > 0) {
      // Re-register missing webhooks
      const { registered, failed } = await registerShopifyWebhooks(conn.shop_domain, conn.access_token);
      details.reregistered = registered;
      details.failedReregister = failed;
      status = failed.length > 0 ? 'warning' : 'fixed';
    }
  } catch (err) {
    status = 'warning';
    details.error = err instanceof Error ? err.message : String(err);
  }

  return { name: 'webhooks', status, details, duration_ms: Date.now() - start };
}

// ── SubAgent C: Billing Check (+ trial_ends_at auto-fix) ──────────────────

async function subAgentBillingCheck(conn: ConnectionRow): Promise<SubAgentResult> {
  const start = Date.now();
  let status: CheckStatus = 'ok';
  const details: Record<string, unknown> = {};

  try {
    // Load account + subscription
    const [{ data: account }, { data: sub }] = await Promise.all([
      supabase.from('accounts').select('id, subscription_status, trial_ends_at, stripe_subscription_id').eq('id', conn.account_id).single(),
      supabase.from('account_subscriptions').select('plan_id, status, is_beta').eq('account_id', conn.account_id).in('status', ['active', 'trialing']).maybeSingle(),
    ]);

    if (!account) {
      return { name: 'billing', status: 'critical', details: { error: 'account_not_found' }, duration_ms: Date.now() - start };
    }

    details.subscriptionStatus = account.subscription_status;
    details.plan = sub?.plan_id ?? 'none';
    details.isBeta = sub?.is_beta ?? false;

    // ── Fix P1-1: trial_ends_at null for trialing accounts ──
    if (account.subscription_status === 'trialing' && !account.trial_ends_at) {
      const planKey = sub?.plan_id ?? 'basico';
      const trialDays = SHOPIFY_PLANS[planKey]?.trialDays ?? 14;
      const trialEndsAt = new Date(Date.now() + trialDays * 86400000).toISOString();

      await supabase.from('accounts').update({ trial_ends_at: trialEndsAt, updated_at: new Date().toISOString() }).eq('id', account.id);

      status = 'fixed';
      details.action = 'trial_ends_at_set';
      details.trial_ends_at = trialEndsAt;
      console.log(`${LOG} [${conn.shop_domain}] Fixed trial_ends_at: ${trialEndsAt}`);
    }

    // ── Check if trial expired without paid plan ──
    if (account.subscription_status === 'trialing' && account.trial_ends_at) {
      const trialEnd = new Date(account.trial_ends_at).getTime();
      if (Date.now() > trialEnd) {
        status = 'warning';
        details.issue = 'trial_expired_no_paid_plan';
        details.expiredAt = account.trial_ends_at;
        console.log(`${LOG} [${conn.shop_domain}] Trial expired at ${account.trial_ends_at} — no paid plan active`);
      }
    }

    // ── Verify Shopify subscription if we have a GID ──
    if (account.stripe_subscription_id && conn.token_status === 'active') {
      try {
        const { status: shopifyStatus } = await getAppSubscriptionStatus(
          conn.shop_domain, conn.access_token, account.stripe_subscription_id,
        );
        details.shopifyBillingStatus = shopifyStatus;

        if (shopifyStatus === 'CANCELLED' || shopifyStatus === 'EXPIRED') {
          if (account.subscription_status !== 'canceled') {
            await supabase.from('accounts').update({ subscription_status: 'canceled', updated_at: new Date().toISOString() }).eq('id', account.id);
            status = 'fixed';
            details.action = 'subscription_status_synced_to_canceled';
          }
        }
      } catch {
        // Non-fatal — Shopify API might be temporarily down
        details.shopifyBillingCheck = 'failed';
      }
    }
  } catch (err) {
    status = 'critical';
    details.error = err instanceof Error ? err.message : String(err);
  }

  return { name: 'billing', status, details, duration_ms: Date.now() - start };
}
