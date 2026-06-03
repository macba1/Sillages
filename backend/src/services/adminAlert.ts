/**
 * Admin alerts — operational fail-loud notifications to Tony only.
 * Never sent to merchants. Deduped per (alert_key, UTC day) via the
 * ops_alerts table so the 30-min health loop can't spam the inbox.
 */

import { resend } from '../lib/resend.js';
import { supabase } from '../lib/supabase.js';

const ADMIN_EMAIL = 'tony@richmondpartner.com';
const FROM = 'Sillages Alerts <alerts@sillages.app>';

/**
 * Send an admin alert at most once per UTC day per alertKey.
 * Returns true if an email was sent, false if deduped or failed.
 */
export async function sendAdminAlertOncePerDay(
  alertKey: string,
  subject: string,
  bodyHtml: string,
  detail?: Record<string, unknown>,
): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const dedupeKey = `${alertKey}:${today}`;

  // Already alerted today? (ops_alerts is created by migration 20260603_brief_delivery.sql)
  try {
    const { data: existing, error } = await supabase
      .from('ops_alerts')
      .select('id')
      .eq('alert_key', dedupeKey)
      .maybeSingle();
    if (error) {
      console.error(`[adminAlert] ops_alerts read failed (${error.message}) — sending anyway to stay loud`);
    } else if (existing) {
      console.log(`[adminAlert] Already alerted today for ${dedupeKey} — skipping`);
      return false;
    }
  } catch (err) {
    console.error(`[adminAlert] ops_alerts check threw — sending anyway: ${err instanceof Error ? err.message : err}`);
  }

  try {
    await resend.emails.send({
      from: FROM,
      to: ADMIN_EMAIL,
      subject,
      html: `
<div style="max-width:600px;margin:0 auto;padding:32px 24px;font-family:'Helvetica Neue',Arial,sans-serif;">
  <h2 style="color:#C0392B;margin:0 0 16px;">⚠️ Sillages Ops Alert</h2>
  ${bodyHtml}
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
  <p style="font-size:11px;color:#A89880;">Sillages health monitor — admin only. Alert key: ${dedupeKey}</p>
</div>`,
    });
  } catch (err) {
    console.error(`[adminAlert] Failed to send alert email: ${err instanceof Error ? err.message : err}`);
    return false;
  }

  // Record dedupe marker (best-effort).
  try {
    await supabase.from('ops_alerts').insert({ alert_key: dedupeKey, detail: detail ?? null });
  } catch { /* non-fatal */ }

  console.log(`[adminAlert] Sent admin alert: ${subject}`);
  return true;
}
