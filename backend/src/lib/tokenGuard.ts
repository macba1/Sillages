import axios from 'axios';
import { supabase } from './supabase.js';
import { resend } from './resend.js';
import { env } from '../config/env.js';

const ADMIN_EMAIL = 'tony@richmondpartner.com';

/**
 * Token Guard — handles 401/403 errors from Shopify API calls with graduated retry and alerting.
 *
 * Flow:
 *   1st failure: increment retry_count, set token_status='failing', set token_failing_since
 *   2nd failure (after 5 min): increment retry_count
 *   3rd failure (after 30 min): mark token_status='invalid', send push + email to merchant
 *
 * On any successful Shopify call: reset token_status='active', retry_count=0
 */

const LOG = '[tokenGuard]';

interface ConnectionRow {
  id: string;
  account_id: string;
  shop_domain: string;
  token_status: string | null;
  token_failing_since: string | null;
  token_retry_count: number | null;
}

/**
 * Call this after a successful Shopify API call to reset the token status.
 */
export async function markTokenHealthy(shopDomain: string): Promise<void> {
  await supabase
    .from('shopify_connections')
    .update({
      token_status: 'active',
      token_failing_since: null,
      token_retry_count: 0,
    })
    .eq('shop_domain', shopDomain);
}

/**
 * Call this when a Shopify API call returns 401 or 403.
 * Implements graduated retry: tracks failures and only alerts after 3 failures.
 * Returns true if caller should retry the API call, false if token is definitively invalid.
 */
export async function handleTokenFailure(shopDomain: string): Promise<boolean> {
  // Fetch current connection state
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('id, account_id, shop_domain, token_status, token_failing_since, token_retry_count')
    .eq('shop_domain', shopDomain)
    .single();

  if (!conn) {
    console.error(`${LOG} No connection found for ${shopDomain}`);
    return false;
  }

  const retryCount = (conn.token_retry_count ?? 0) + 1;
  const now = new Date().toISOString();
  const failingSince = conn.token_failing_since ?? now;

  console.log(`${LOG} Token failure #${retryCount} for ${shopDomain} (failing since: ${failingSince})`);

  if (retryCount < 3) {
    // Not yet exhausted — mark as failing, let caller retry later
    await supabase
      .from('shopify_connections')
      .update({
        token_status: 'failing',
        token_failing_since: failingSince,
        token_retry_count: retryCount,
      })
      .eq('id', conn.id);

    console.log(`${LOG} ${shopDomain} marked as 'failing' (retry ${retryCount}/3)`);
    return true; // caller can retry
  }

  // 3rd failure — mark as invalid and alert admin (never the merchant)
  await supabase
    .from('shopify_connections')
    .update({
      token_status: 'invalid',
      token_failing_since: failingSince,
      token_retry_count: retryCount,
    })
    .eq('id', conn.id);

  console.log(`${LOG} ${shopDomain} marked as 'invalid' after ${retryCount} failures`);

  // Send alert to admin only — merchants never see technical errors
  await alertAdmin(conn, failingSince);

  return false; // token is definitively invalid
}

/**
 * Check if enough time has passed for a retry based on the retry count.
 * Retry 1: immediate, Retry 2: 5 min, Retry 3: 30 min
 */
export function shouldRetryNow(retryCount: number, failingSince: string): boolean {
  const elapsed = Date.now() - new Date(failingSince).getTime();
  const MS = 60_000;

  if (retryCount === 0) return true; // first attempt, go ahead
  if (retryCount === 1) return elapsed >= 5 * MS;  // 5 min backoff
  if (retryCount === 2) return elapsed >= 30 * MS;  // 30 min backoff
  return false; // already marked invalid
}

/**
 * Send technical alert to admin only — merchants NEVER receive token/connection error notifications.
 * Admin decides manually whether to send the merchant a /reconnect link.
 */
async function alertAdmin(conn: ConnectionRow, failingSince: string): Promise<void> {
  const hoursDown = Math.floor((Date.now() - new Date(failingSince).getTime()) / 3600000);

  // Get merchant info for context in admin email
  const { data: account } = await supabase
    .from('accounts')
    .select('email, full_name')
    .eq('id', conn.account_id)
    .single();

  const merchantEmail = account?.email ?? 'unknown';
  const merchantName = account?.full_name ?? 'unknown';
  const reconnectUrl = `${env.FRONTEND_URL}/reconnect`;

  const subject = `🔴 Token invalid: ${conn.shop_domain} (${merchantName})`;

  const html = `<div style="max-width:600px;margin:0 auto;padding:32px 24px;font-family:'Helvetica Neue',Arial,sans-serif;">
    <h2 style="color:#D35400;margin:0 0 16px;">Token Invalid — Action Required</h2>
    <table style="font-size:14px;color:#2A1F14;line-height:1.8;">
      <tr><td style="font-weight:600;padding-right:16px;">Store:</td><td>${conn.shop_domain}</td></tr>
      <tr><td style="font-weight:600;padding-right:16px;">Merchant:</td><td>${merchantName} (${merchantEmail})</td></tr>
      <tr><td style="font-weight:600;padding-right:16px;">Account ID:</td><td><code>${conn.account_id}</code></td></tr>
      <tr><td style="font-weight:600;padding-right:16px;">Failing since:</td><td>${failingSince} (${hoursDown}h ago)</td></tr>
      <tr><td style="font-weight:600;padding-right:16px;">Retries:</td><td>${conn.token_retry_count ?? 0}</td></tr>
    </table>
    <p style="color:#2A1F14;font-size:14px;margin-top:20px;">The merchant has <strong>NOT</strong> been notified. If you want them to reconnect, send them this link manually:</p>
    <p><a href="${reconnectUrl}" style="color:#C9964A;font-weight:600;">${reconnectUrl}</a></p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
    <p style="font-size:11px;color:#A89880;">Sillages Token Guard — admin-only alert</p>
  </div>`;

  try {
    await resend.emails.send({
      from: `Sillages Alerts <alerts@sillages.app>`,
      to: ADMIN_EMAIL,
      subject,
      html,
    });
    console.log(`${LOG} Admin alert sent to ${ADMIN_EMAIL} for ${conn.shop_domain}`);
  } catch (err) {
    console.error(`${LOG} Failed to send admin alert:`, err instanceof Error ? err.message : err);
  }
}
