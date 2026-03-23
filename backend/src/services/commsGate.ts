import { toZonedTime } from 'date-fns-tz';
import { supabase } from '../lib/supabase.js';
import { sendPushNotification } from './pushNotifier.js';
import { sendWeeklyBriefEmail } from './weeklyEmailSender.js';
import { logCommunication } from './commLog.js';
import type { PushPayload } from './pushNotifier.js';

const LOG = '[commsGate]';

// ═══════════════════════════════════════════════════════════════════════════
// FREQUENCY RULES (absolute):
//   ADMIN (pending_comms): max 1 daily_summary/day, 1 weekly/Monday, 3 actions/day/store
//   MERCHANT (pushes):     max 1 push/day total, only 9:00-20:00 local time
//   NO reminders, NO "not approved" notifications, EVER.
//
// Only types in pending_comms: 'push', 'weekly_email'
// Email types go to pending_actions (merchants get push, never direct email).
// ═══════════════════════════════════════════════════════════════════════════

// Max action-related items in pending_comms per store per day
const MAX_ACTION_COMMS_PER_DAY = 3;

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
 * Check if an account requires manual approval for comms.
 */
async function getCommsApproval(accountId: string): Promise<'manual' | 'auto'> {
  try {
    const { data } = await supabase
      .from('accounts')
      .select('comms_approval')
      .eq('id', accountId)
      .single();

    return (data?.comms_approval === 'auto') ? 'auto' : 'manual';
  } catch {
    return 'manual';
  }
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
 * Check how many pushes (any type) were already sent/queued today for this account.
 */
async function getPushCountToday(accountId: string): Promise<number> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { count } = await supabase
    .from('pending_comms')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('type', 'push')
    .gte('created_at', todayStart.toISOString());

  return count ?? 0;
}

/**
 * Check how many action-related comms were queued today for this account (for admin limit).
 */
async function getActionCommsToday(accountId: string): Promise<number> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { count } = await supabase
    .from('pending_comms')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('channel', 'event_push')
    .gte('created_at', todayStart.toISOString());

  return count ?? 0;
}

/**
 * Gate a push notification through the comms approval system.
 * Enforces: max 1 push/day per merchant, 9:00-20:00 only, max 3 action comms/day for admin.
 */
export async function gatePush(
  accountId: string,
  payload: PushPayload,
  channel: 'push' | 'event_push' | 'daily_summary_push' = 'push',
): Promise<{ sent: boolean; queued: boolean }> {

  // ── Frequency checks (apply to both auto and manual) ──

  // For event_push (action notifications): max 3 per day per store for admin
  if (channel === 'event_push') {
    const actionCommsToday = await getActionCommsToday(accountId);
    if (actionCommsToday >= MAX_ACTION_COMMS_PER_DAY) {
      console.log(`${LOG} SKIP: ${accountId} already has ${actionCommsToday} action comms today (max ${MAX_ACTION_COMMS_PER_DAY})`);
      return { sent: false, queued: false };
    }
  }

  const approval = await getCommsApproval(accountId);

  if (approval === 'auto') {
    // Merchant-facing: max 1 push/day, 9:00-20:00 only
    if (!await isWithinPushHours(accountId)) {
      console.log(`${LOG} SKIP: ${accountId} outside push hours (9:00-20:00)`);
      return { sent: false, queued: false };
    }
    const pushesToday = await getPushCountToday(accountId);
    if (pushesToday >= 1) {
      console.log(`${LOG} SKIP: ${accountId} already received 1 push today (max 1/day)`);
      return { sent: false, queued: false };
    }

    await sendPushNotification(accountId, payload);
    await logCommunication({ account_id: accountId, channel, status: 'sent' });
    return { sent: true, queued: false };
  }

  // Manual → queue for admin approval
  await supabase.from('pending_comms').insert({
    account_id: accountId,
    type: 'push',
    channel,
    content: payload,
    status: 'pending',
  });

  console.log(`${LOG} Push queued for admin approval: ${accountId} — ${payload.body.slice(0, 60)}`);
  return { sent: false, queued: true };
}

/**
 * Gate a weekly email through the comms approval system.
 */
export async function gateWeeklyEmail(
  accountId: string,
  weeklyBriefId: string,
): Promise<{ sent: boolean; queued: boolean }> {
  const approval = await getCommsApproval(accountId);

  if (approval === 'auto') {
    await sendWeeklyBriefEmail(weeklyBriefId);
    await logCommunication({
      account_id: accountId,
      weekly_brief_id: weeklyBriefId,
      channel: 'weekly_email',
      status: 'sent',
    });
    return { sent: true, queued: false };
  }

  // Manual → queue for admin approval
  await supabase.from('pending_comms').insert({
    account_id: accountId,
    type: 'weekly_email',
    channel: 'weekly_email',
    content: { weekly_brief_id: weeklyBriefId },
    status: 'pending',
  });

  console.log(`${LOG} Weekly email queued for admin approval: ${accountId}`);
  return { sent: false, queued: true };
}
