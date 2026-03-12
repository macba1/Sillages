import axios from 'axios';
import { supabase } from './supabase.js';
import { sendPushNotification } from '../services/pushNotifier.js';
import { resend } from './resend.js';
import { env } from '../config/env.js';

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

  // 3rd failure — mark as invalid and alert the merchant
  await supabase
    .from('shopify_connections')
    .update({
      token_status: 'invalid',
      token_failing_since: failingSince,
      token_retry_count: retryCount,
    })
    .eq('id', conn.id);

  console.log(`${LOG} ${shopDomain} marked as 'invalid' after ${retryCount} failures`);

  // Send alerts to the merchant
  await alertMerchant(conn, failingSince);

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
 * Send graduated alerts to the merchant about their broken Shopify connection.
 */
async function alertMerchant(conn: ConnectionRow, failingSince: string): Promise<void> {
  const hoursDown = Math.floor((Date.now() - new Date(failingSince).getTime()) / 3600000);

  // Get account info
  const { data: account } = await supabase
    .from('accounts')
    .select('email, language, full_name')
    .eq('id', conn.account_id)
    .single();

  if (!account) return;

  const lang = account.language === 'es' ? 'es' : 'en';
  const reconnectUrl = `${env.FRONTEND_URL}/reconnect`;
  const name = account.full_name?.split(' ')[0] ?? '';

  // Push notification
  try {
    await sendPushNotification(conn.account_id, {
      title: lang === 'es' ? 'Reconecta tu tienda Shopify' : 'Reconnect your Shopify store',
      body: lang === 'es'
        ? `Tu conexión con ${conn.shop_domain} se ha interrumpido. Toca para reconectar con 1 click.`
        : `Your connection to ${conn.shop_domain} was lost. Tap to reconnect with 1 click.`,
      url: '/reconnect',
    });
    console.log(`${LOG} Push sent to ${account.email}`);
  } catch {
    // may not have push subscription
  }

  // Email
  const subject = lang === 'es'
    ? `${name ? name + ', tu' : 'Tu'} tienda Shopify necesita reconectarse`
    : `${name ? name + ', your' : 'Your'} Shopify store needs to reconnect`;

  const html = lang === 'es'
    ? `<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:'Helvetica Neue',Arial,sans-serif;">
        <p style="color:#2A1F14;font-size:16px;line-height:1.5;">Hola${name ? ' ' + name : ''},</p>
        <p style="color:#2A1F14;font-size:15px;line-height:1.5;">La conexión con tu tienda <strong>${conn.shop_domain}</strong> se interrumpió hace ${hoursDown > 0 ? hoursDown + ' hora(s)' : 'unos minutos'}. Sin esta conexión no puedo generar tus briefs diarios.</p>
        <p style="color:#2A1F14;font-size:15px;line-height:1.5;">Reconectar es un solo click:</p>
        <a href="${reconnectUrl}" style="display:inline-block;padding:14px 28px;background:#C9964A;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;margin:12px 0;">Reconectar tienda →</a>
        <p style="color:#A89880;font-size:12px;margin-top:24px;">Sillages — tu agente de inteligencia de tienda</p>
      </div>`
    : `<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:'Helvetica Neue',Arial,sans-serif;">
        <p style="color:#2A1F14;font-size:16px;line-height:1.5;">Hi${name ? ' ' + name : ''},</p>
        <p style="color:#2A1F14;font-size:15px;line-height:1.5;">The connection to your store <strong>${conn.shop_domain}</strong> was lost ${hoursDown > 0 ? hoursDown + ' hour(s) ago' : 'a few minutes ago'}. Without it, I can't generate your daily briefs.</p>
        <p style="color:#2A1F14;font-size:15px;line-height:1.5;">Reconnecting takes just one click:</p>
        <a href="${reconnectUrl}" style="display:inline-block;padding:14px 28px;background:#C9964A;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;margin:12px 0;">Reconnect store →</a>
        <p style="color:#A89880;font-size:12px;margin-top:24px;">Sillages — your store intelligence agent</p>
      </div>`;

  try {
    const shopSlug = conn.shop_domain.replace('.myshopify.com', '').replace(/[^a-z0-9-]/g, '');
    await resend.emails.send({
      from: `Sillages <alerts@sillages.app>`,
      to: account.email,
      subject,
      html,
    });
    console.log(`${LOG} Reconnect email sent to ${account.email}`);
  } catch (err) {
    console.error(`${LOG} Failed to send email to ${account.email}:`, err instanceof Error ? err.message : err);
  }
}
