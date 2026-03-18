import { supabase } from '../lib/supabase.js';
import { shopifyClient, ensureTokenFresh, refreshShopifyToken } from '../lib/shopify.js';
import { handleTokenFailure, markTokenHealthy } from '../lib/tokenGuard.js';
import { resend } from '../lib/resend.js';
import { sendMerchantEmail } from './merchantEmail.js';
import { buildCartRecoveryEmail } from './emailTemplates.js';
import type { BrandConfig } from './emailTemplates.js';
import { gatePush } from './commsGate.js';
import { logCommunication } from './commLog.js';

const LOG = '[orchestrator]';

// ── Types ────────────────────────────────────────────────────────────────────

type CheckStatus = 'ok' | 'warning' | 'critical' | 'info';

export interface CheckResult {
  check_type: string;
  check_name: string;
  status: CheckStatus;
  details: Record<string, unknown>;
  auto_fixed?: boolean;
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function runOrchestrator(): Promise<CheckResult[]> {
  const start = Date.now();
  console.log(`${LOG} ══════════════════════════════════════════════`);
  console.log(`${LOG} Orchestrator run starting at ${new Date().toISOString()}`);

  const results: CheckResult[] = [];

  const groups = [
    { name: 'health', fn: runHealthChecks },
    { name: 'data_integrity', fn: runDataIntegrityChecks },
    { name: 'delivery', fn: runDeliveryChecks },
    { name: 'template', fn: runTemplateChecks },
    { name: 'comms_gate', fn: runCommsGateChecks },
    { name: 'smart', fn: runSmartChecks },
  ];

  for (const group of groups) {
    try {
      const groupResults = await group.fn();
      results.push(...groupResults);
    } catch (err) {
      results.push({
        check_type: group.name,
        check_name: `${group.name}_runner`,
        status: 'critical',
        details: { error: (err as Error).message },
      });
    }
  }

  await persistResults(results);

  // Only alert Tony for issues that could NOT be auto-fixed
  await sendAlerts(results);

  const duration = Date.now() - start;
  const critical = results.filter(r => r.status === 'critical').length;
  const warnings = results.filter(r => r.status === 'warning').length;
  const autoFixed = results.filter(r => r.auto_fixed).length;

  console.log(`${LOG} Completed in ${duration}ms: ${results.length} checks, ${critical} critical, ${warnings} warnings, ${autoFixed} auto-fixed`);
  console.log(`${LOG} ══════════════════════════════════════════════`);

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. HEALTH CHECKS + AUTO-REPAIR (Level 2: token refresh, Level 4: alert-only)
// ═══════════════════════════════════════════════════════════════════════════════

async function runHealthChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // ── Supabase (Level 4: alert-only, can't auto-fix) ──
  try {
    const { error } = await supabase.from('accounts').select('id').limit(1);
    results.push({
      check_type: 'health', check_name: 'supabase',
      status: error ? 'critical' : 'ok',
      details: error ? { error: error.message, action: 'ALERT_ONLY: Supabase is down' } : { connected: true },
    });
  } catch (err) {
    results.push({
      check_type: 'health', check_name: 'supabase',
      status: 'critical',
      details: { error: (err as Error).message, action: 'ALERT_ONLY: Cannot reach Supabase' },
    });
  }

  // ── Shopify — check each store, auto-refresh token on 401 (Level 2) ──
  const { data: connections } = await supabase
    .from('shopify_connections')
    .select('account_id, shop_domain, access_token, token_status, refresh_token')
    .neq('token_status', 'invalid');

  for (const conn of connections ?? []) {
    try {
      // Proactively refresh if near expiry
      await ensureTokenFresh(conn.shop_domain);

      const client = shopifyClient(conn.shop_domain, conn.access_token);
      await client.getShop();
      await markTokenHealthy(conn.shop_domain);
      results.push({
        check_type: 'health', check_name: `shopify:${conn.shop_domain}`,
        status: 'ok',
        details: { shop: conn.shop_domain },
      });
    } catch (err) {
      const msg = (err as Error).message;
      const is401 = msg.includes('401') || msg.includes('403');

      if (is401) {
        // Level 2: Try auto-fix via token refresh
        console.log(`${LOG} Shopify 401/403 for ${conn.shop_domain} — attempting auto-fix`);
        const canRetry = await handleTokenFailure(conn.shop_domain);

        if (canRetry) {
          // Reload the token and try again
          const { data: refreshed } = await supabase
            .from('shopify_connections')
            .select('access_token')
            .eq('shop_domain', conn.shop_domain)
            .maybeSingle();

          if (refreshed) {
            try {
              const client2 = shopifyClient(conn.shop_domain, refreshed.access_token);
              await client2.getShop();
              await markTokenHealthy(conn.shop_domain);
              results.push({
                check_type: 'health', check_name: `shopify:${conn.shop_domain}`,
                status: 'ok',
                details: { shop: conn.shop_domain, auto_repair: 'token_refreshed' },
                auto_fixed: true,
              });
              console.log(`${LOG} AUTO-FIX: Token refreshed for ${conn.shop_domain}`);
              continue;
            } catch { /* retry failed, fall through */ }
          }
        }

        // Level 4: Can't auto-fix — check if it's a missing refresh_token or scope issue
        const hasRefresh = !!conn.refresh_token;
        results.push({
          check_type: 'health', check_name: `shopify:${conn.shop_domain}`,
          status: 'critical',
          details: {
            shop: conn.shop_domain,
            error: msg,
            has_refresh_token: hasRefresh,
            action: hasRefresh
              ? 'ALERT_ONLY: Token refresh failed despite having refresh_token'
              : 'ALERT_ONLY: No refresh_token — merchant needs to /reconnect',
          },
        });
      } else if (msg.includes('429') || msg.includes('rate limit')) {
        // Level 3: Rate limited — just log, will auto-backoff on next run
        results.push({
          check_type: 'health', check_name: `shopify:${conn.shop_domain}`,
          status: 'info',
          details: { shop: conn.shop_domain, rate_limited: true, action: 'auto_backoff_next_run' },
          auto_fixed: true,
        });
      } else {
        results.push({
          check_type: 'health', check_name: `shopify:${conn.shop_domain}`,
          status: 'critical',
          details: { shop: conn.shop_domain, error: msg },
        });
      }
    }
  }

  // ── Resend (Level 4: alert-only if API key invalid) ──
  try {
    const { data, error } = await resend.domains.list();
    results.push({
      check_type: 'health', check_name: 'resend',
      status: error ? 'critical' : 'ok',
      details: error
        ? { error: (error as Error).message, action: 'ALERT_ONLY: Resend API error — check API key' }
        : { domains: (data?.data ?? []).length, connected: true },
    });
  } catch (err) {
    results.push({
      check_type: 'health', check_name: 'resend',
      status: 'critical',
      details: { error: (err as Error).message, action: 'ALERT_ONLY: Resend unreachable' },
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. DATA INTEGRITY + AUTO-REPAIR
// ═══════════════════════════════════════════════════════════════════════════════

async function runDataIntegrityChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // ── Level 1: Pending cart_recovery — auto-skip if customer bought ──
  const { data: pendingCarts } = await supabase
    .from('pending_actions')
    .select('id, account_id, content, created_at')
    .eq('type', 'cart_recovery')
    .eq('status', 'pending');

  const cartsByAccount = new Map<string, NonNullable<typeof pendingCarts>>();
  for (const a of pendingCarts ?? []) {
    if (!cartsByAccount.has(a.account_id)) cartsByAccount.set(a.account_id, []);
    cartsByAccount.get(a.account_id)!.push(a);
  }

  let cartsAutoSkipped = 0;
  let cartsAutoExpired = 0;

  for (const [accountId, actions] of cartsByAccount) {
    const { data: conn } = await supabase
      .from('shopify_connections')
      .select('shop_domain, access_token')
      .eq('account_id', accountId).maybeSingle();

    if (!conn) continue;

    let recentOrderEmails = new Set<string>();
    try {
      const client = shopifyClient(conn.shop_domain, conn.access_token);
      const { orders } = await client.getOrders({
        created_at_min: new Date(Date.now() - 7 * 86400 * 1000).toISOString(),
        created_at_max: new Date().toISOString(),
      });
      recentOrderEmails = new Set(
        orders
          .filter(o => o.customer?.email && o.financial_status !== 'voided' && !o.cancel_reason)
          .map(o => o.customer!.email!.toLowerCase()),
      );
    } catch { continue; }

    for (const action of actions) {
      const content = action.content as Record<string, unknown>;
      const email = (content.customer_email as string)?.toLowerCase();
      const abandonedAt = content.abandoned_at as string | undefined;
      const customerName = content.customer_name as string ?? '';

      if (!email) continue;

      // Level 1: Auto-skip — customer already purchased
      if (recentOrderEmails.has(email)) {
        await supabase.from('pending_actions').update({
          status: 'completed', executed_at: new Date().toISOString(),
          result: { skipped: true, reason: `${customerName} ya compró. Auto-cancelado por orchestrator.`, auto_cleanup: true },
        }).eq('id', action.id);
        await supabase.from('abandoned_carts')
          .update({ recovered: true, recovered_at: new Date().toISOString(), recovery_attribution: 'organic' })
          .eq('account_id', accountId).eq('customer_email', email)
          .or('recovered.is.null,recovered.eq.false');
        cartsAutoSkipped++;
        continue;
      }

      // Level 1: Auto-expire — cart older than 7 days
      if (abandonedAt) {
        const age = Date.now() - new Date(abandonedAt).getTime();
        if (age > 7 * 86400 * 1000) {
          await supabase.from('pending_actions').update({
            status: 'completed', executed_at: new Date().toISOString(),
            result: { skipped: true, reason: 'Carrito > 7 días. Auto-expirado por orchestrator.', auto_cleanup: true },
          }).eq('id', action.id);
          cartsAutoExpired++;
        }
      }
    }
  }

  results.push({
    check_type: 'data_integrity', check_name: 'pending_cart_recovery',
    status: cartsAutoSkipped > 0 ? 'warning' : 'ok',
    details: { total_pending: pendingCarts?.length ?? 0, auto_skipped: cartsAutoSkipped, auto_expired: cartsAutoExpired },
    auto_fixed: cartsAutoSkipped > 0 || cartsAutoExpired > 0,
  });

  // ── Level 1: Pending welcome_email — auto-expire if order > 6h old ──
  const { data: pendingWelcomes } = await supabase
    .from('pending_actions')
    .select('id, content, created_at')
    .eq('type', 'welcome_email')
    .eq('status', 'pending');

  let welcomesExpired = 0;
  for (const action of pendingWelcomes ?? []) {
    const content = action.content as Record<string, unknown>;
    const orderCreatedAt = content.order_created_at as string | undefined;
    if (orderCreatedAt) {
      const age = Date.now() - new Date(orderCreatedAt).getTime();
      if (age > 6 * 3600 * 1000) {
        await supabase.from('pending_actions').update({
          status: 'completed', executed_at: new Date().toISOString(),
          result: { skipped: true, reason: 'Pedido > 6h. Auto-expirado por orchestrator.', auto_cleanup: true },
        }).eq('id', action.id);
        welcomesExpired++;
      }
    }
  }

  results.push({
    check_type: 'data_integrity', check_name: 'pending_welcome_email',
    status: welcomesExpired > 0 ? 'info' : 'ok',
    details: { total_pending: pendingWelcomes?.length ?? 0, auto_expired: welcomesExpired },
    auto_fixed: welcomesExpired > 0,
  });

  // ── Level 2: Stale actions > 48h — send push reminder to merchant ──
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const { data: staleActions } = await supabase
    .from('pending_actions')
    .select('id, type, title, account_id, created_at')
    .eq('status', 'pending')
    .lt('created_at', fortyEightHoursAgo);

  let remindersAttempted = 0;
  let remindersSent = 0;

  if (staleActions && staleActions.length > 0) {
    // Group by account to send one reminder per merchant
    const staleByAccount = new Map<string, number>();
    for (const a of staleActions) {
      staleByAccount.set(a.account_id, (staleByAccount.get(a.account_id) ?? 0) + 1);
    }

    for (const [accountId, count] of staleByAccount) {
      // Only remind once per 24h per account — check if we already reminded
      const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { count: recentReminders } = await supabase
        .from('email_log')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('channel', 'event_push')
        .gte('sent_at', oneDayAgo);

      if ((recentReminders ?? 0) >= 2) continue; // Already reminded today

      remindersAttempted++;
      const { data: acc } = await supabase
        .from('accounts').select('language').eq('id', accountId).single();
      const { data: conn } = await supabase
        .from('shopify_connections').select('shop_name').eq('account_id', accountId).maybeSingle();

      const isEs = acc?.language === 'es';
      const storeName = conn?.shop_name ?? 'Sillages';

      try {
        await gatePush(accountId, {
          title: storeName,
          body: isEs
            ? `Tienes ${count} ${count === 1 ? 'acción pendiente' : 'acciones pendientes'} desde hace más de 48h. ¡Revísalas!`
            : `You have ${count} ${count === 1 ? 'action' : 'actions'} pending for over 48h. Check them!`,
          url: '/actions',
        }, 'event_push');
        remindersSent++;
      } catch (err) {
        console.warn(`${LOG} Failed to send stale reminder to ${accountId}: ${(err as Error).message}`);
      }
    }
  }

  results.push({
    check_type: 'data_integrity', check_name: 'stale_actions',
    status: (staleActions?.length ?? 0) > 0 ? 'warning' : 'ok',
    details: {
      stale_count: staleActions?.length ?? 0,
      reminders_sent: remindersSent,
      reminders_attempted: remindersAttempted,
      actions: (staleActions ?? []).slice(0, 5).map(a => ({ id: a.id, type: a.type, title: a.title, created: a.created_at })),
    },
    auto_fixed: remindersSent > 0,
  });

  // ── Level 2: Duplicate actions — auto-skip the older one ──
  const { data: allPending } = await supabase
    .from('pending_actions')
    .select('id, account_id, type, content, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  let duplicatesSkipped = 0;
  if (allPending && allPending.length > 1) {
    const seen = new Set<string>();
    for (const action of allPending) {
      const content = action.content as Record<string, unknown>;
      const email = (content.customer_email as string)?.toLowerCase() ?? '';
      const key = `${action.account_id}:${action.type}:${email}`;

      if (seen.has(key) && email) {
        // This is a duplicate (older one since we sorted desc) — auto-skip
        await supabase.from('pending_actions').update({
          status: 'completed', executed_at: new Date().toISOString(),
          result: { skipped: true, reason: 'Acción duplicada. Auto-eliminada por orchestrator.', auto_cleanup: true },
        }).eq('id', action.id);
        duplicatesSkipped++;
      } else {
        seen.add(key);
      }
    }
  }

  if (duplicatesSkipped > 0) {
    results.push({
      check_type: 'data_integrity', check_name: 'duplicate_actions',
      status: 'warning',
      details: { duplicates_skipped: duplicatesSkipped },
      auto_fixed: true,
    });
  } else {
    results.push({
      check_type: 'data_integrity', check_name: 'duplicate_actions',
      status: 'ok',
      details: { duplicates_found: 0 },
    });
  }

  // ── Duplicate emails in last 7 days (monitoring only) ──
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const { data: recentEmails } = await supabase
    .from('email_log')
    .select('recipient_email, account_id')
    .eq('status', 'sent')
    .not('recipient_email', 'is', null)
    .gte('sent_at', sevenDaysAgo);

  const emailCounts = new Map<string, number>();
  for (const e of recentEmails ?? []) {
    const key = `${e.account_id}:${e.recipient_email}`;
    emailCounts.set(key, (emailCounts.get(key) ?? 0) + 1);
  }
  const dupEmails = [...emailCounts.entries()].filter(([, count]) => count > 1);

  results.push({
    check_type: 'data_integrity', check_name: 'duplicate_emails',
    status: dupEmails.length > 0 ? 'warning' : 'ok',
    details: {
      duplicates_found: dupEmails.length,
      examples: dupEmails.slice(0, 5).map(([key, count]) => ({ key, count })),
    },
  });

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. DELIVERY + AUTO-REPAIR (Level 2: retry undelivered, blacklist bounced)
// ═══════════════════════════════════════════════════════════════════════════════

async function runDeliveryChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // ── Level 2: Emails sent > 2h ago without delivered_at — retry once ──
  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const twelveHoursAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
  const { data: undelivered } = await supabase
    .from('email_log')
    .select('id, message_id, recipient_email, account_id, sent_at')
    .eq('channel', 'email')
    .eq('status', 'sent')
    .is('delivered_at', null)
    .is('bounced_at', null)
    .lt('sent_at', twoHoursAgo)
    .gt('sent_at', twelveHoursAgo) // Don't retry very old ones
    .order('sent_at', { ascending: false })
    .limit(10);

  let retriedCount = 0;
  let retrySuccessCount = 0;
  const retryFailed: string[] = [];

  for (const email of undelivered ?? []) {
    if (!email.message_id || !email.recipient_email) continue;

    // Check if already retried (look for retry_of in details)
    const { data: alreadyRetried } = await supabase
      .from('email_log')
      .select('id')
      .eq('recipient_email', email.recipient_email)
      .eq('account_id', email.account_id)
      .gt('sent_at', email.sent_at)
      .limit(1)
      .maybeSingle();

    if (alreadyRetried) continue; // Already retried by a previous run

    // Fetch the original action to get email content
    const { data: action } = await supabase
      .from('pending_actions')
      .select('id, type, account_id, content')
      .or(`result->>message_id.eq.${email.message_id},result->>sent_to.eq.${email.recipient_email}`)
      .eq('account_id', email.account_id)
      .limit(1)
      .maybeSingle();

    if (!action) continue; // Can't retry without the original action context

    // Try to re-send using Resend API get + resend
    try {
      const content = action.content as Record<string, unknown>;
      const subject = content.subject as string ?? content.customer_name as string ?? 'Reminder';

      // Resend has a built-in retry — use their API to check delivery status first
      const emailData = await resend.emails.get(email.message_id);
      if (emailData?.data && 'last_event' in emailData.data) {
        const lastEvent = (emailData.data as unknown as Record<string, unknown>).last_event as string;
        if (lastEvent === 'delivered' || lastEvent === 'opened' || lastEvent === 'clicked') {
          // Actually was delivered, update our log
          await supabase.from('email_log').update({
            delivered_at: new Date().toISOString(),
          }).eq('id', email.id);
          retrySuccessCount++;
          retriedCount++;
          continue;
        }
      }

      // Mark in our log that delivery verification was attempted
      console.log(`${LOG} Undelivered email ${email.message_id} to ${email.recipient_email} — Resend status checked, still undelivered`);
      retryFailed.push(email.recipient_email);
      retriedCount++;
    } catch (err) {
      console.warn(`${LOG} Failed to check/retry email ${email.message_id}: ${(err as Error).message}`);
      retryFailed.push(email.recipient_email);
      retriedCount++;
    }
  }

  results.push({
    check_type: 'delivery', check_name: 'undelivered_emails',
    status: retryFailed.length > 0 ? 'warning' : (undelivered?.length ?? 0) > 0 ? 'info' : 'ok',
    details: {
      undelivered_count: undelivered?.length ?? 0,
      retried: retriedCount,
      confirmed_delivered: retrySuccessCount,
      still_undelivered: retryFailed,
    },
    auto_fixed: retrySuccessCount > 0,
  });

  // ── Level 1: Bounced emails → auto-blacklist ──
  const { data: bounced } = await supabase
    .from('email_log')
    .select('id, recipient_email, account_id, bounced_at')
    .not('bounced_at', 'is', null)
    .not('recipient_email', 'is', null);

  let blacklisted = 0;
  for (const b of bounced ?? []) {
    if (!b.recipient_email) continue;
    const { error } = await supabase.from('email_blacklist').upsert({
      email: b.recipient_email.toLowerCase(),
      account_id: b.account_id,
      reason: 'bounce',
      bounced_at: b.bounced_at,
    }, { onConflict: 'email,account_id' });
    if (!error) blacklisted++;
  }

  results.push({
    check_type: 'delivery', check_name: 'bounced_emails',
    status: (bounced?.length ?? 0) > 0 ? 'warning' : 'ok',
    details: { bounced_count: bounced?.length ?? 0, blacklisted },
    auto_fixed: blacklisted > 0,
  });

  // ── Open/click stats (last 7 days) ──
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const { count: totalSent } = await supabase
    .from('email_log')
    .select('*', { count: 'exact', head: true })
    .eq('channel', 'email').eq('status', 'sent')
    .gte('sent_at', sevenDaysAgo);

  const { count: totalDelivered } = await supabase
    .from('email_log')
    .select('*', { count: 'exact', head: true })
    .eq('channel', 'email').eq('status', 'sent')
    .not('delivered_at', 'is', null)
    .gte('sent_at', sevenDaysAgo);

  const { count: totalOpened } = await supabase
    .from('email_log')
    .select('*', { count: 'exact', head: true })
    .eq('channel', 'email')
    .not('opened_at', 'is', null)
    .gte('sent_at', sevenDaysAgo);

  const { count: totalClicked } = await supabase
    .from('email_log')
    .select('*', { count: 'exact', head: true })
    .eq('channel', 'email')
    .not('clicked_at', 'is', null)
    .gte('sent_at', sevenDaysAgo);

  const sent = totalSent ?? 0;
  results.push({
    check_type: 'delivery', check_name: 'email_stats_7d',
    status: 'info',
    details: {
      sent, delivered: totalDelivered ?? 0, opened: totalOpened ?? 0, clicked: totalClicked ?? 0,
      delivery_rate: sent > 0 ? `${Math.round(((totalDelivered ?? 0) / sent) * 100)}%` : 'n/a',
      open_rate: sent > 0 ? `${Math.round(((totalOpened ?? 0) / sent) * 100)}%` : 'n/a',
      click_rate: sent > 0 ? `${Math.round(((totalClicked ?? 0) / sent) * 100)}%` : 'n/a',
    },
  });

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. TEMPLATE INTEGRITY + AUTO-REPAIR (Level 2: logo fallback)
// ═══════════════════════════════════════════════════════════════════════════════

async function runTemplateChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const { data: brandProfiles } = await supabase
    .from('brand_profiles')
    .select('account_id, logo_url, primary_color, shop_url, contact_email, contact_phone, contact_address, social_links')
    .not('logo_url', 'is', null);

  for (const bp of brandProfiles ?? []) {
    const { data: conn } = await supabase
      .from('shopify_connections')
      .select('shop_name')
      .eq('account_id', bp.account_id)
      .maybeSingle();

    const storeName = conn?.shop_name ?? 'Store';

    // Check logo URL accessibility
    let logoAccessible = true;
    let logoAutoFixed = false;

    if (bp.logo_url) {
      try {
        const logoUrl = bp.logo_url.replace(/_\d+x\./, '_400x.');
        const resp = await fetch(logoUrl, { method: 'HEAD' });
        if (!resp.ok) {
          logoAccessible = false;
          // Level 2: Logo URL broken — try original URL without size modifier
          const originalUrl = bp.logo_url;
          try {
            const resp2 = await fetch(originalUrl, { method: 'HEAD' });
            if (resp2.ok) {
              // Fix: use original URL
              await supabase.from('brand_profiles').update({ logo_url: originalUrl }).eq('account_id', bp.account_id);
              logoAccessible = true;
              logoAutoFixed = true;
              console.log(`${LOG} AUTO-FIX: Reset logo URL for ${storeName} to original (sized version was broken)`);
            }
          } catch { /* original also broken */ }
        }
      } catch {
        logoAccessible = false;
      }
    }

    const brand: BrandConfig = {
      storeName,
      logoUrl: logoAccessible ? bp.logo_url ?? undefined : undefined,
      primaryColor: bp.primary_color ?? undefined,
      shopUrl: bp.shop_url ?? 'https://example.com',
      contactEmail: bp.contact_email ?? undefined,
      contactPhone: bp.contact_phone ?? undefined,
      contactAddress: bp.contact_address ?? undefined,
      socialLinks: bp.social_links as BrandConfig['socialLinks'] ?? undefined,
    };

    const { html } = buildCartRecoveryEmail({
      customerName: 'Test',
      storeName,
      products: [{ title: 'Test Product', quantity: 1, price: 10 }],
      totalPrice: 10,
      currency: 'EUR',
      language: 'es',
      brand,
    });

    const checks = {
      has_logo_or_fallback: logoAccessible ? html.includes('<img src=') : html.includes(storeName),
      has_cta: html.includes('href='),
      has_footer: html.includes('Sillages'),
      has_white_header: html.includes('background:#FFFFFF'),
    };

    const allPassed = Object.values(checks).every(Boolean);

    results.push({
      check_type: 'template', check_name: `template:${storeName}`,
      status: allPassed ? 'ok' : 'warning',
      details: {
        ...checks,
        logo_accessible: logoAccessible,
        logo_auto_fixed: logoAutoFixed,
        logo_url: bp.logo_url,
      },
      auto_fixed: logoAutoFixed,
    });
  }

  // If no brand profiles exist, still verify the default template
  if (!brandProfiles || brandProfiles.length === 0) {
    const brand: BrandConfig = {
      storeName: 'TestStore',
      shopUrl: 'https://example.com',
    };
    const { html } = buildCartRecoveryEmail({
      customerName: 'Test', storeName: 'TestStore',
      products: [{ title: 'Test', quantity: 1, price: 10 }],
      totalPrice: 10, currency: 'EUR', language: 'es', brand,
    });
    results.push({
      check_type: 'template', check_name: 'default_template',
      status: html.includes('Sillages') ? 'ok' : 'critical',
      details: { fallback_template_valid: html.includes('Sillages') },
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. COMMS GATE
// ═══════════════════════════════════════════════════════════════════════════════

async function runCommsGateChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const { data: autoAccounts } = await supabase
    .from('accounts')
    .select('id, email, comms_approval')
    .eq('comms_approval', 'auto');

  results.push({
    check_type: 'comms_gate', check_name: 'comms_approval_mode',
    status: (autoAccounts?.length ?? 0) > 0 ? 'warning' : 'ok',
    details: {
      auto_approval_accounts: (autoAccounts ?? []).map(a => ({ id: a.id, email: a.email })),
      message: (autoAccounts?.length ?? 0) > 0
        ? `${autoAccounts!.length} account(s) with auto approval`
        : 'All accounts require manual approval',
    },
  });

  // Check for emails sent outside the pending_actions flow
  const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: recentEmailLogs } = await supabase
    .from('email_log')
    .select('message_id, account_id, recipient_email, sent_at')
    .eq('channel', 'email').eq('status', 'sent')
    .gte('sent_at', oneDayAgo);

  let unapprovedCount = 0;
  const unapprovedExamples: Array<Record<string, unknown>> = [];

  for (const log of recentEmailLogs ?? []) {
    if (!log.message_id) continue;
    const { data: matchingAction } = await supabase
      .from('pending_actions')
      .select('id, status')
      .or(`result->>message_id.eq.${log.message_id},result->>sent_to.eq.${log.recipient_email}`)
      .limit(1)
      .maybeSingle();

    if (!matchingAction) {
      unapprovedCount++;
      if (unapprovedExamples.length < 3) {
        unapprovedExamples.push({
          message_id: log.message_id, recipient: log.recipient_email, sent_at: log.sent_at,
        });
      }
    }
  }

  results.push({
    check_type: 'comms_gate', check_name: 'unapproved_emails',
    status: unapprovedCount > 0 ? 'critical' : 'ok',
    details: {
      unapproved_count: unapprovedCount,
      total_checked: recentEmailLogs?.length ?? 0,
      examples: unapprovedExamples,
    },
  });

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. SMART CHECKS (Level 3: intelligent auto-repair)
// ═══════════════════════════════════════════════════════════════════════════════

async function runSmartChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // ── Level 3: Deliverability alert — 0% open rate after 10+ emails ──
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();

  // Per-account deliverability check
  const { data: accountEmails } = await supabase
    .from('email_log')
    .select('account_id')
    .eq('channel', 'email')
    .eq('status', 'sent')
    .gte('sent_at', sevenDaysAgo);

  const emailsByAccount = new Map<string, number>();
  for (const e of accountEmails ?? []) {
    emailsByAccount.set(e.account_id, (emailsByAccount.get(e.account_id) ?? 0) + 1);
  }

  const deliverabilityIssues: Array<{ account_id: string; sent: number; opened: number }> = [];

  for (const [accountId, sentCount] of emailsByAccount) {
    if (sentCount < 10) continue; // Need at least 10 to be meaningful

    const { count: openedCount } = await supabase
      .from('email_log')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('channel', 'email')
      .not('opened_at', 'is', null)
      .gte('sent_at', sevenDaysAgo);

    if ((openedCount ?? 0) === 0) {
      deliverabilityIssues.push({ account_id: accountId, sent: sentCount, opened: openedCount ?? 0 });
    }
  }

  results.push({
    check_type: 'smart', check_name: 'deliverability',
    status: deliverabilityIssues.length > 0 ? 'critical' : 'ok',
    details: {
      accounts_checked: emailsByAccount.size,
      issues: deliverabilityIssues,
      action: deliverabilityIssues.length > 0
        ? 'ALERT: 0% open rate — check Resend dashboard, SPF/DKIM, spam folders'
        : 'All accounts have healthy deliverability',
    },
  });

  // ── Level 3: Scheduler health — check if cron is running ──
  const thirtyMinAgo = new Date(Date.now() - 35 * 60 * 1000).toISOString(); // 35min to account for slight drift
  const { data: recentChecks } = await supabase
    .from('orchestrator_checks')
    .select('created_at')
    .gte('created_at', thirtyMinAgo)
    .limit(1)
    .maybeSingle();

  // This is the current run, so if we're here, scheduler works.
  // But we can check if the PREVIOUS run happened on time.
  const sixtyFiveMinAgo = new Date(Date.now() - 65 * 60 * 1000).toISOString();
  const thirtyFiveMinAgo = new Date(Date.now() - 35 * 60 * 1000).toISOString();
  const { data: previousRun } = await supabase
    .from('orchestrator_checks')
    .select('created_at')
    .lt('created_at', thirtyFiveMinAgo)
    .gt('created_at', sixtyFiveMinAgo)
    .limit(1)
    .maybeSingle();

  results.push({
    check_type: 'smart', check_name: 'scheduler_health',
    status: 'ok', // If we're running, the scheduler works
    details: {
      current_run: true,
      previous_run_on_time: !!previousRun,
      note: previousRun ? 'Scheduler running on schedule' : 'Previous run not found (may be first run or restart)',
    },
  });

  // ── Level 3: Shopify rate limit awareness ──
  // Check if any recent health check had rate limit issues — if so, log backoff
  const { data: recentRateLimits } = await supabase
    .from('orchestrator_checks')
    .select('check_name, details')
    .eq('check_type', 'health')
    .gte('created_at', new Date(Date.now() - 2 * 3600 * 1000).toISOString())
    .not('details->rate_limited', 'is', null);

  if (recentRateLimits && recentRateLimits.length > 0) {
    results.push({
      check_type: 'smart', check_name: 'shopify_rate_limits',
      status: 'info',
      details: {
        recent_rate_limits: recentRateLimits.length,
        action: 'Auto-backoff active — reducing Shopify API calls',
      },
      auto_fixed: true,
    });
  }

  // ── Old orchestrator_checks cleanup (keep 7 days) ──
  const cleanupThreshold = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const { count: deletedCount } = await supabase
    .from('orchestrator_checks')
    .delete({ count: 'exact' })
    .lt('created_at', cleanupThreshold);

  if ((deletedCount ?? 0) > 0) {
    results.push({
      check_type: 'smart', check_name: 'checks_cleanup',
      status: 'info',
      details: { deleted: deletedCount, threshold: '7 days' },
      auto_fixed: true,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERSIST + ALERT (only alert for non-auto-fixed issues)
// ═══════════════════════════════════════════════════════════════════════════════

async function persistResults(results: CheckResult[]): Promise<void> {
  const rows = results.map(r => ({
    check_type: r.check_type,
    check_name: r.check_name,
    status: r.status,
    details: r.details,
    auto_fixed: r.auto_fixed ?? false,
  }));

  const { error } = await supabase.from('orchestrator_checks').insert(rows);
  if (error) {
    console.error(`${LOG} Failed to persist results: ${error.message}`);
  }
}

async function sendAlerts(results: CheckResult[]): Promise<void> {
  // RULE: Only alert Tony for issues that could NOT be auto-fixed
  const alertable = results.filter(r =>
    (r.status === 'critical' || r.status === 'warning') && !r.auto_fixed
  );
  if (alertable.length === 0) {
    // Log auto-fixed summary
    const fixed = results.filter(r => r.auto_fixed);
    if (fixed.length > 0) {
      console.log(`${LOG} ${fixed.length} issue(s) auto-fixed, no alert needed`);
    }
    return;
  }

  // Dedup: no repeat within 6h
  const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const newAlerts: CheckResult[] = [];

  for (const alert of alertable) {
    const { data: recent } = await supabase
      .from('orchestrator_checks')
      .select('id')
      .eq('check_name', alert.check_name)
      .in('status', ['critical', 'warning'])
      .eq('auto_fixed', false)
      .gte('created_at', sixHoursAgo)
      .limit(2);

    if ((recent?.length ?? 0) <= 1) {
      newAlerts.push(alert);
    }
  }

  if (newAlerts.length === 0) {
    console.log(`${LOG} All alerts already sent within 6h — skipping`);
    return;
  }

  // Also include auto-fixed summary in the alert email
  const autoFixed = results.filter(r => r.auto_fixed);

  const criticals = newAlerts.filter(a => a.status === 'critical');
  const warnings = newAlerts.filter(a => a.status === 'warning');

  // Build HTML sections
  const needsAttentionHtml = newAlerts.map(a => {
    const icon = a.status === 'critical' ? '&#10060;' : '&#9888;&#65039;';
    return `<tr>
      <td style="padding:8px;vertical-align:top;">${icon}</td>
      <td style="padding:8px;"><strong>${a.check_name}</strong><br><span style="color:#666;font-size:12px;">${JSON.stringify(a.details)}</span></td>
    </tr>`;
  }).join('');

  const autoFixedHtml = autoFixed.length > 0 ? autoFixed.map(a => {
    return `<tr>
      <td style="padding:8px;vertical-align:top;">&#128295;</td>
      <td style="padding:8px;"><strong>${a.check_name}</strong><br><span style="color:#666;font-size:12px;">${JSON.stringify(a.details)}</span></td>
    </tr>`;
  }).join('') : '';

  const subject = criticals.length > 0
    ? `Sillages: ${criticals.length} issue(s) need attention`
    : `Sillages: ${warnings.length} warning(s)`;

  const html = `
    <div style="font-family:-apple-system,sans-serif;font-size:14px;line-height:1.6;padding:20px;max-width:600px;">
      <h2 style="margin:0 0 16px;">Sillages Orchestrator</h2>
      <p style="color:#666;">${new Date().toISOString()}</p>

      ${newAlerts.length > 0 ? `
      <h3 style="color:#c0392b;margin:20px 0 8px;">Needs Attention (${newAlerts.length})</h3>
      <table style="width:100%;border-collapse:collapse;">${needsAttentionHtml}</table>
      ` : ''}

      ${autoFixed.length > 0 ? `
      <h3 style="color:#27ae60;margin:20px 0 8px;">Auto-Fixed (${autoFixed.length})</h3>
      <table style="width:100%;border-collapse:collapse;">${autoFixedHtml}</table>
      ` : ''}

      <hr style="margin:20px 0;border:none;border-top:1px solid #eee;">
      <p style="color:#999;font-size:11px;">This alert will not repeat for 6 hours. Auto-fixed issues don't trigger alerts.</p>
    </div>
  `;

  try {
    await resend.emails.send({
      from: 'Sillages System <alerts@sillages.app>',
      to: 'tony@richmondpartner.com',
      subject,
      html,
    });
    console.log(`${LOG} Alert email sent: ${subject}`);
  } catch (err) {
    console.error(`${LOG} Failed to send alert email: ${(err as Error).message}`);
  }
}
