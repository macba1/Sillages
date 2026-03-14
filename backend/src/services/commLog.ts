import { supabase } from '../lib/supabase.js';

/**
 * Log a communication event (push, email, weekly_email) to the email_log table.
 */
export async function logCommunication(input: {
  account_id: string;
  brief_id?: string | null;
  weekly_brief_id?: string | null;
  channel: 'push' | 'email' | 'weekly_email';
  status: 'sent' | 'failed';
  error_message?: string | null;
  message_id?: string | null;
}): Promise<void> {
  try {
    await supabase.from('email_log').insert({
      account_id: input.account_id,
      brief_id: input.brief_id ?? null,
      weekly_brief_id: input.weekly_brief_id ?? null,
      channel: input.channel,
      status: input.status,
      error_message: input.error_message ?? null,
      message_id: input.message_id ?? null,
      sent_at: new Date().toISOString(),
    });
  } catch (err) {
    // Non-fatal — don't break the pipeline if logging fails
    console.warn(`[commLog] Failed to log ${input.channel} for ${input.account_id}: ${err instanceof Error ? err.message : err}`);
  }
}
