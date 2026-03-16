import { supabase } from '../lib/supabase.js';
import { sendPushNotification } from './pushNotifier.js';
import { sendWeeklyBriefEmail } from './weeklyEmailSender.js';
import { logCommunication } from './commLog.js';
import type { PushPayload } from './pushNotifier.js';

const LOG = '[commsGate]';

/**
 * Check if an account has send_enabled = true in user_intelligence_config.
 * Returns false if the account is disabled or has no config.
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
 * Returns 'manual' | 'auto'. Defaults to 'manual' if column missing.
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
 * Gate a push notification through the comms approval system.
 * If 'auto' → sends immediately.
 * If 'manual' → saves to pending_comms for admin approval.
 */
export async function gatePush(
  accountId: string,
  payload: PushPayload,
  channel: 'push' | 'event_push' | 'daily_summary_push' = 'push',
): Promise<{ sent: boolean; queued: boolean }> {
  const approval = await getCommsApproval(accountId);

  if (approval === 'auto') {
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
 * If 'auto' → sends immediately.
 * If 'manual' → saves to pending_comms for admin approval.
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
