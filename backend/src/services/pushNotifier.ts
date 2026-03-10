import webpush from 'web-push';
import { supabase } from '../lib/supabase.js';
import { env } from '../config/env.js';

// ── Configure web-push ──────────────────────────────────────────────────────

if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    env.VAPID_EMAIL,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/**
 * Send a push notification to all subscriptions for an account.
 * Silently removes expired/invalid subscriptions.
 */
export async function sendPushNotification(accountId: string, payload: PushPayload): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    console.log('[push] VAPID keys not configured — skipping push notification');
    return;
  }

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('account_id', accountId);

  if (error || !subs || subs.length === 0) {
    return;
  }

  const jsonPayload = JSON.stringify(payload);

  for (const sub of subs) {
    const pushSub = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    };

    try {
      await webpush.sendNotification(pushSub, jsonPayload);
      console.log(`[push] Sent to account ${accountId} endpoint ${sub.endpoint.slice(0, 50)}...`);
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 410 || statusCode === 404) {
        // Subscription expired or invalid — remove it
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
        console.log(`[push] Removed expired subscription ${sub.id}`);
      } else {
        console.error(`[push] Failed for account ${accountId}:`, (err as Error).message);
      }
    }
  }
}
