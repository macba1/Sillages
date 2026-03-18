import { supabase } from '../lib/supabase.js';
import { shopifyClient } from '../lib/shopify.js';
import { resend } from '../lib/resend.js';
import { buildCartRecoveryEmail } from './emailTemplates.js';
import type { BrandConfig } from './emailTemplates.js';

const LOG = '[orchestrator]';

// ── Types ────────────────────────────────────────────────────────────────────

type CheckStatus = 'ok' | 'warning' | 'critical' | 'info';

interface CheckResult {
  check_type: string;   // health | data_integrity | delivery | template | comms_gate
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

  // Run all check groups — catch errors per group so one failure doesn't stop others
  const groups = [
    { name: 'health', fn: runHealthChecks },
    { name: 'data_integrity', fn: runDataIntegrityChecks },
    { name: 'delivery', fn: runDeliveryChecks },
    { name: 'template', fn: runTemplateChecks },
    { name: 'comms_gate', fn: runCommsGateChecks },
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

  // Persist results
  await persistResults(results);

  // Send alerts for critical/warning issues (dedup: no repeat within 6h)
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
// 1. HEALTH CHECKS
// ═══════════════════════════════════════════════════════════════════════════════

async function runHealthChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Supabase
  try {
    const { error } = await supabase.from('accounts').select('id').limit(1);
    results.push({
      check_type: 'health', check_name: 'supabase',
      status: error ? 'critical' : 'ok',
      details: error ? { error: error.message } : { connected: true },
    });
  } catch (err) {
    results.push({
      check_type: 'health', check_name: 'supabase',
      status: 'critical',
      details: { error: (err as Error).message },
    });
  }

  // Shopify — check each active store
  const { data: connections } = await supabase
    .from('shopify_connections')
    .select('account_id, shop_domain, access_token, token_status')
    .neq('token_status', 'invalid');

  for (const conn of connections ?? []) {
    try {
      const client = shopifyClient(conn.shop_domain, conn.access_token);
      await client.getShop();
      results.push({
        check_type: 'health', check_name: `shopify:${conn.shop_domain}`,
        status: 'ok',
        details: { shop: conn.shop_domain },
      });
    } catch (err) {
      const msg = (err as Error).message;
      const is401 = msg.includes('401') || msg.includes('403');
      results.push({
        check_type: 'health', check_name: `shopify:${conn.shop_domain}`,
        status: 'critical',
        details: { shop: conn.shop_domain, error: msg, token_issue: is401 },
      });
    }
  }

  // Resend — attempt a simple API call (list domains) rather than sending a real email
  try {
    const { data, error } = await resend.domains.list();
    results.push({
      check_type: 'health', check_name: 'resend',
      status: error ? 'critical' : 'ok',
      details: error
        ? { error: (error as Error).message }
        : { domains: (data?.data ?? []).length, connected: true },
    });
  } catch (err) {
    results.push({
      check_type: 'health', check_name: 'resend',
      status: 'critical',
      details: { error: (err as Error).message },
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. DATA INTEGRITY
// ═══════════════════════════════════════════════════════════════════════════════

async function runDataIntegrityChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // ── Pending cart_recovery: check if customer already bought ──
  const { data: pendingCarts } = await supabase
    .from('pending_actions')
    .select('id, account_id, content, created_at')
    .eq('type', 'cart_recovery')
    .eq('status', 'pending');

  // Group by account
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

    // Fetch recent orders once
    let recentEmails = new Set<string>();
    try {
      const client = shopifyClient(conn.shop_domain, conn.access_token);
      const { orders } = await client.getOrders({
        created_at_min: new Date(Date.now() - 7 * 86400 * 1000).toISOString(),
        created_at_max: new Date().toISOString(),
      });
      recentEmails = new Set(
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

      // Auto-skip: already purchased
      if (recentEmails.has(email)) {
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

      // Auto-expire: cart older than 7 days
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

  // ── Pending welcome_email: verify order freshness ──
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

  // ── Stale actions: pending > 48h ──
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const { data: staleActions, count: staleCount } = await supabase
    .from('pending_actions')
    .select('id, type, title, created_at', { count: 'exact' })
    .eq('status', 'pending')
    .lt('created_at', fortyEightHoursAgo);

  results.push({
    check_type: 'data_integrity', check_name: 'stale_actions',
    status: (staleCount ?? 0) > 0 ? 'warning' : 'ok',
    details: {
      stale_count: staleCount ?? 0,
      actions: (staleActions ?? []).slice(0, 5).map(a => ({ id: a.id, type: a.type, title: a.title, created: a.created_at })),
    },
  });

  // ── Duplicate emails in last 7 days ──
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
  const duplicates = [...emailCounts.entries()].filter(([, count]) => count > 1);

  results.push({
    check_type: 'data_integrity', check_name: 'duplicate_emails',
    status: duplicates.length > 0 ? 'warning' : 'ok',
    details: {
      duplicates_found: duplicates.length,
      examples: duplicates.slice(0, 5).map(([key, count]) => ({ key, count })),
    },
  });

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. DELIVERY VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

async function runDeliveryChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // ── Emails sent > 2h ago without delivered_at ──
  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const { data: undelivered, count: undeliveredCount } = await supabase
    .from('email_log')
    .select('id, message_id, recipient_email, sent_at', { count: 'exact' })
    .eq('channel', 'email')
    .eq('status', 'sent')
    .is('delivered_at', null)
    .lt('sent_at', twoHoursAgo)
    .order('sent_at', { ascending: false })
    .limit(10);

  results.push({
    check_type: 'delivery', check_name: 'undelivered_emails',
    status: (undeliveredCount ?? 0) > 0 ? 'warning' : 'ok',
    details: {
      undelivered_count: undeliveredCount ?? 0,
      examples: (undelivered ?? []).map(e => ({
        message_id: e.message_id, recipient: e.recipient_email, sent_at: e.sent_at,
      })),
    },
  });

  // ── Bounced emails → add to email_blacklist ──
  const { data: bounced } = await supabase
    .from('email_log')
    .select('id, recipient_email, account_id, bounced_at')
    .not('bounced_at', 'is', null)
    .not('recipient_email', 'is', null);

  let blacklisted = 0;
  for (const b of bounced ?? []) {
    if (!b.recipient_email) continue;
    // Upsert into email_blacklist
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
// 4. TEMPLATE INTEGRITY
// ═══════════════════════════════════════════════════════════════════════════════

async function runTemplateChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Load a real brand config from a random active account
  const { data: anyBp } = await supabase
    .from('brand_profiles')
    .select('account_id, logo_url, primary_color, shop_url, contact_email, contact_phone, contact_address, social_links')
    .not('logo_url', 'is', null)
    .limit(1)
    .maybeSingle();

  const brand: BrandConfig = {
    storeName: 'TestStore',
    logoUrl: anyBp?.logo_url ?? undefined,
    primaryColor: anyBp?.primary_color ?? undefined,
    shopUrl: anyBp?.shop_url ?? 'https://example.com',
    contactEmail: anyBp?.contact_email ?? undefined,
    contactPhone: anyBp?.contact_phone ?? undefined,
    contactAddress: anyBp?.contact_address ?? undefined,
    socialLinks: anyBp?.social_links as BrandConfig['socialLinks'] ?? undefined,
  };

  const { html } = buildCartRecoveryEmail({
    customerName: 'Test',
    storeName: 'TestStore',
    products: [{ title: 'Test Product', quantity: 1, price: 10 }],
    totalPrice: 10,
    currency: 'EUR',
    language: 'es',
    brand,
  });

  const checks = {
    has_logo: brand.logoUrl ? html.includes('<img src=') : true, // only check if logo configured
    has_cta: html.includes('href=') && html.includes('Completar mi pedido'),
    has_footer: html.includes('Powered by') && html.includes('Sillages'),
    has_white_header: html.includes('background:#FFFFFF'),
    no_green_header: !html.includes('background:#c0dcb0') || !html.includes('border-radius:12px 12px 0 0;padding:20px'), // old pattern
    has_contact: brand.contactEmail ? html.includes(brand.contactEmail) : true,
  };

  const allPassed = Object.values(checks).every(Boolean);

  results.push({
    check_type: 'template', check_name: 'cart_recovery_template',
    status: allPassed ? 'ok' : 'critical',
    details: {
      ...checks,
      logo_url_used: brand.logoUrl ?? 'none',
    },
  });

  // Verify logo URL actually loads
  if (brand.logoUrl) {
    try {
      const logoUrl = brand.logoUrl.replace(/_\d+x\./, '_400x.');
      const resp = await fetch(logoUrl, { method: 'HEAD' });
      results.push({
        check_type: 'template', check_name: 'logo_url_accessible',
        status: resp.ok ? 'ok' : 'critical',
        details: { url: logoUrl, http_status: resp.status },
      });
    } catch (err) {
      results.push({
        check_type: 'template', check_name: 'logo_url_accessible',
        status: 'critical',
        details: { url: brand.logoUrl, error: (err as Error).message },
      });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. COMMS GATE
// ═══════════════════════════════════════════════════════════════════════════════

async function runCommsGateChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // All accounts should have comms_approval = 'manual'
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
        ? `${autoAccounts!.length} account(s) with auto approval — emails send without merchant review`
        : 'All accounts require manual approval',
    },
  });

  // Check for emails sent outside of the pending_actions flow
  // An email in email_log with channel='email' should have a matching completed action
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
    // Check if there's a completed action with this message_id in result
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
      note: unapprovedCount > 0 ? 'Emails found in email_log without matching approved action' : 'All emails matched to approved actions',
    },
  });

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERSIST + ALERT
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
  const alertable = results.filter(r => r.status === 'critical' || r.status === 'warning');
  if (alertable.length === 0) return;

  // Dedup: check if we already alerted for the same check_name in the last 6h
  const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const newAlerts: CheckResult[] = [];

  for (const alert of alertable) {
    const { data: recent } = await supabase
      .from('orchestrator_checks')
      .select('id')
      .eq('check_name', alert.check_name)
      .in('status', ['critical', 'warning'])
      .gte('created_at', sixHoursAgo)
      .limit(2); // 2 because one is the current run we just inserted

    // If there's only the one we just inserted (or none from before), it's new
    if ((recent?.length ?? 0) <= 1) {
      newAlerts.push(alert);
    }
  }

  if (newAlerts.length === 0) {
    console.log(`${LOG} All alerts already sent within 6h — skipping`);
    return;
  }

  // Build alert email
  const criticals = newAlerts.filter(a => a.status === 'critical');
  const warnings = newAlerts.filter(a => a.status === 'warning');

  const alertLines = newAlerts.map(a => {
    const icon = a.status === 'critical' ? '🔴' : '🟡';
    const fixed = a.auto_fixed ? ' [AUTO-FIXED]' : '';
    return `${icon} ${a.check_name}${fixed}\n   ${JSON.stringify(a.details)}`;
  }).join('\n\n');

  const subject = criticals.length > 0
    ? `🔴 CRITICAL: ${criticals.length} issue(s) in Sillages`
    : `🟡 WARNING: ${warnings.length} issue(s) in Sillages`;

  const html = `
    <div style="font-family:monospace;font-size:13px;line-height:1.6;padding:20px;">
      <h2 style="margin:0 0 16px;">Sillages Orchestrator Alert</h2>
      <p>${new Date().toISOString()}</p>
      <p><strong>${criticals.length} critical, ${warnings.length} warnings</strong></p>
      <hr>
      <pre style="white-space:pre-wrap;">${alertLines}</pre>
      <hr>
      <p style="color:#999;font-size:11px;">This alert will not repeat for 6 hours.</p>
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
