import { toZonedTime } from 'date-fns-tz';
import { supabase } from '../lib/supabase.js';
import { sendPushNotification } from './pushNotifier.js';
import { sendWeeklyBriefEmail } from './weeklyEmailSender.js';
import { logCommunication } from './commLog.js';
import type { PushPayload } from './pushNotifier.js';

const LOG = '[commsGate]';

// ═══════════════════════════════════════════════════════════════════════════
// FREQUENCY RULES (absolute):
//   MERCHANT: max 1 push/day total, only 9:00-20:00 local time
//   NO reminders, NO "not approved" notifications, EVER.
//   ALL comms go directly to merchants — no admin approval gate.
//
// Tony (admin) is NOT in the approval flow.
// Merchants manage their own actions from their PWA.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if an account has send_enabled = true in user_intelligence_config.
 */
export async function isSendEnabled(accountId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_intelligence_config')
    .select('send_enabled')
    .eq('account_id', accountId)
    .maybeSingle();

  return data?.send_enabled === true;
}

/**
 * Check if merchant is within allowed push hours (9:00-20:00 local time).
 */
async function isWithinPushHours(accountId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_intelligence_config')
    .select('timezone')
    .eq('account_id', accountId)
    .maybeSingle();

  const tz = data?.timezone ?? 'Europe/Madrid';
  try {
    const localHour = toZonedTime(new Date(), tz).getHours();
    return localHour >= 9 && localHour < 20;
  } catch {
    return true; // fail open
  }
}

/**
 * Check how many pushes (any type) were already sent today for this account.
 * Counts from email_log (actual sends) instead of pending_comms.
 */
async function getPushCountToday(accountId: string): Promise<number> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { count } = await supabase
    .from('email_log')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .in('channel', ['push', 'event_push', 'daily_summary_push'])
    .gte('sent_at', todayStart.toISOString());

  return count ?? 0;
}

/**
 * Gate a push notification — sends directly if within frequency limits.
 * No admin approval gate. Enforces: max 1 push/day, 9:00-20:00 only.
 */
export async function gatePush(
  accountId: string,
  payload: PushPayload,
  channel: 'push' | 'event_push' | 'daily_summary_push' = 'push',
): Promise<{ sent: boolean; queued: boolean }> {

  // Check push hours
  if (!await isWithinPushHours(accountId)) {
    console.log(`${LOG} SKIP: ${accountId} outside push hours (9:00-20:00)`);
    return { sent: false, queued: false };
  }

  // Max 1 push/day
  const pushesToday = await getPushCountToday(accountId);
  if (pushesToday >= 1) {
    console.log(`${LOG} SKIP: ${accountId} already received 1 push today (max 1/day)`);
    return { sent: false, queued: false };
  }

  await sendPushNotification(accountId, payload);
  await logCommunication({ account_id: accountId, channel, status: 'sent' });
  console.log(`${LOG} Push sent: ${accountId} — ${payload.body.slice(0, 60)}`);
  return { sent: true, queued: false };
}

/**
 * Send a weekly email directly — no admin approval gate.
 */
export async function gateWeeklyEmail(
  accountId: string,
  weeklyBriefId: string,
): Promise<{ sent: boolean; queued: boolean }> {
  await sendWeeklyBriefEmail(weeklyBriefId);
  await logCommunication({
    account_id: accountId,
    weekly_brief_id: weeklyBriefId,
    channel: 'weekly_email',
    status: 'sent',
  });
  console.log(`${LOG} Weekly email sent: ${accountId}`);
  return { sent: true, queued: false };
}
