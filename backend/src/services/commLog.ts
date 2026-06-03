import { supabase } from '../lib/supabase.js';

export type CommChannel =
  | 'push'
  | 'email'
  | 'weekly_email'
  | 'daily_brief'
  | 'event_push'
  | 'daily_summary_push'
  | 'admin_alert';

/**
 * Log a communication event to the email_log table.
 *
 * Returns true if the row was persisted, false otherwise. Supabase does NOT
 * throw on a constraint violation — it returns `{ error }` — so a swallowed
 * error here previously made daily_brief sends invisible (the channel was
 * rejected by a CHECK constraint and nobody noticed). We now inspect the
 * returned error and log LOUDLY so a logging regression can never hide again.
 */
export async function logCommunication(input: {
  account_id: string;
  brief_id?: string | null;
  weekly_brief_id?: string | null;
  channel: CommChannel;
  status: 'sent' | 'failed';
  error_message?: string | null;
  message_id?: string | null;
  recipient_email?: string | null;
}): Promise<boolean> {
  try {
    const { error } = await supabase.from('email_log').insert({
      account_id: input.account_id,
      brief_id: input.brief_id ?? null,
      weekly_brief_id: input.weekly_brief_id ?? null,
      channel: input.channel,
      status: input.status,
      error_message: input.error_message ?? null,
      message_id: input.message_id ?? null,
      recipient_email: input.recipient_email?.toLowerCase() ?? null,
      sent_at: new Date().toISOString(),
    });

    if (error) {
      // Loud: a failed insert means delivery is happening blind. Surface it.
      console.error(
        `[commLog] FAILED to persist email_log row (channel=${input.channel}, account=${input.account_id}): ${error.message}. ` +
        `If this is a check-constraint error, the email_log.channel constraint needs '${input.channel}' added (see migration 20260603_brief_delivery.sql).`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[commLog] Unexpected error logging ${input.channel} for ${input.account_id}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}
