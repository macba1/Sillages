import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import { stripe } from '../lib/stripe.js';
import { supabase } from '../lib/supabase.js';
import { resend } from '../lib/resend.js';
import { env } from '../config/env.js';
import { verifyShopifyWebhook, getAllShopifyCredentials } from '../lib/shopify.js';

const router = Router();

// ── Helper: verify Shopify webhook HMAC against all credential sets ─────────

function verifyShopifyWebhookMultiApp(rawBody: Buffer, hmacHeader: string): boolean {
  for (const creds of getAllShopifyCredentials()) {
    if (verifyShopifyWebhook(rawBody, hmacHeader, creds)) {
      return true;
    }
  }
  return false;
}

// ── POST /api/webhooks/stripe ─────────────────────────────────────────────────
// Raw body is provided by express.raw() registered in index.ts for /api/webhooks
router.post(
  '/stripe',
  async (req: Request, res: Response, next: NextFunction) => {
    const sig = req.headers['stripe-signature'];

    if (!sig) {
      res.status(400).json({ error: 'Missing stripe-signature header' });
      return;
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body as Buffer,
        sig,
        env.STRIPE_WEBHOOK_SECRET ?? '',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Webhook signature verification failed';
      console.error('[webhooks/stripe] Signature verification failed:', message);
      res.status(400).json({ error: message });
      return;
    }

    try {
      await handleStripeEvent(event);
      res.json({ received: true });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /api/webhooks/supabase ───────────────────────────────────────────────
// Supabase database webhook fires when a new row is inserted into public.accounts
// (triggered by the handle_new_user() PostgreSQL function on auth.users INSERT).
// Configure in Supabase Dashboard → Database → Webhooks → accounts table → INSERT.
router.post(
  '/supabase',
  async (req: Request, res: Response) => {
    // Verify optional shared secret
    if (env.SUPABASE_WEBHOOK_SECRET) {
      const secret = req.headers['x-webhook-secret'];
      if (secret !== env.SUPABASE_WEBHOOK_SECRET) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
    }

    let payload: { type: string; table: string; record: Record<string, unknown> };
    try {
      const raw = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }

    if (payload.type !== 'INSERT' || payload.table !== 'accounts') {
      res.json({ received: true });
      return;
    }

    const email = payload.record.email as string | undefined;
    const fullName = (payload.record.full_name as string | undefined) ?? 'there';
    const firstName = fullName.split(' ')[0];

    if (!email) {
      console.warn('[webhooks/supabase] No email in accounts INSERT payload');
      res.json({ received: true });
      return;
    }

    try {
      await sendWelcomeEmail(email, firstName);
      console.log(`[webhooks/supabase] Welcome email sent to ${email}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[webhooks/supabase] Failed to send welcome email: ${message}`);
      // Don't return an error — we still want to ack the webhook
    }

    res.json({ received: true });
  },
);

// ── POST /api/webhooks/shopify/customers-data-request ────────────────────────
// Also mounted at /customers-data-request (without /shopify prefix) for Dev Dashboard compliance URLs
// GDPR: Shopify asks what customer data we hold
router.post(
  ['/shopify/customers-data-request', '/customers-data-request'],
  async (req: Request, res: Response) => {
    const rawBody = req.body as Buffer;
    const hmac = req.headers['x-shopify-hmac-sha256'] as string | undefined;

    if (!hmac || !verifyShopifyWebhookMultiApp(rawBody, hmac)) {
      console.warn('[webhooks/shopify] customers-data-request HMAC verification failed');
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    let payload: { shop_domain: string; customer: { id: number; email: string } };
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }

    const { shop_domain, customer } = payload;
    console.log(`[webhooks/shopify] customers-data-request for shop=${shop_domain} customer_id=${customer?.id} email=${customer?.email}`);

    // Check if we hold any data for this customer
    // We store aggregated snapshots, not individual customer PII, but check accounts by email
    if (customer?.email) {
      const { data: account } = await supabase
        .from('accounts')
        .select('id, email, full_name')
        .eq('email', customer.email)
        .maybeSingle();

      if (account) {
        console.log(`[webhooks/shopify] Found account for customer email ${customer.email}: account_id=${account.id}`);
      } else {
        console.log(`[webhooks/shopify] No account found for customer email ${customer.email}`);
      }
    }

    console.log('[webhooks/shopify] Note: We do not store individual customer PII — only aggregated store snapshots');
    res.json({ received: true });
  },
);

// ── POST /api/webhooks/shopify/customers-redact ──────────────────────────────
// Also mounted at /customers-redact (without /shopify prefix)
// GDPR: Shopify requests we delete all data for a specific customer
router.post(
  ['/shopify/customers-redact', '/customers-redact'],
  async (req: Request, res: Response) => {
    const rawBody = req.body as Buffer;
    const hmac = req.headers['x-shopify-hmac-sha256'] as string | undefined;

    if (!hmac || !verifyShopifyWebhookMultiApp(rawBody, hmac)) {
      console.warn('[webhooks/shopify] customers-redact HMAC verification failed');
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    let payload: { shop_domain: string; customer: { id: number; email: string } };
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }

    const { shop_domain, customer } = payload;
    console.log(`[webhooks/shopify] customers-redact for shop=${shop_domain} customer_id=${customer?.id} email=${customer?.email}`);
    console.log('[webhooks/shopify] No individual customer PII stored — we only store aggregated store snapshots. No action needed.');

    res.json({ received: true });
  },
);

// ── POST /api/webhooks/shopify/shop-redact ───────────────────────────────────
// Also mounted at /shop-redact (without /shopify prefix)
// GDPR: Shopify requests we delete ALL data for a shop (48h after uninstall)
router.post(
  ['/shopify/shop-redact', '/shop-redact'],
  async (req: Request, res: Response) => {
    const rawBody = req.body as Buffer;
    const hmac = req.headers['x-shopify-hmac-sha256'] as string | undefined;

    if (!hmac || !verifyShopifyWebhookMultiApp(rawBody, hmac)) {
      console.warn('[webhooks/shopify] shop-redact HMAC verification failed');
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    let payload: { shop_domain: string };
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }

    const { shop_domain } = payload;
    console.log(`[webhooks/shopify] shop-redact for shop=${shop_domain} — deleting all shop data`);

    try {
      // Find the shopify_connection to get the account_id
      const { data: connection } = await supabase
        .from('shopify_connections')
        .select('id, account_id')
        .eq('shop_domain', shop_domain)
        .maybeSingle();

      if (!connection) {
        console.log(`[webhooks/shopify] shop-redact: No connection found for ${shop_domain} — nothing to delete`);
        res.json({ received: true });
        return;
      }

      const { account_id } = connection;
      console.log(`[webhooks/shopify] shop-redact: Found account_id=${account_id} for ${shop_domain}`);

      // Delete all related data for this account
      const deletions = await Promise.allSettled([
        supabase.from('intelligence_briefs').delete().eq('account_id', account_id),
        supabase.from('shopify_daily_snapshots').delete().eq('account_id', account_id),
        supabase.from('user_intelligence_config').delete().eq('account_id', account_id),
        supabase.from('shopify_connections').delete().eq('account_id', account_id),
      ]);

      const tables = ['intelligence_briefs', 'shopify_daily_snapshots', 'user_intelligence_config', 'shopify_connections'];
      deletions.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          const { error } = result.value;
          if (error) {
            console.error(`[webhooks/shopify] shop-redact: Failed to delete from ${tables[i]}:`, error.message);
          } else {
            console.log(`[webhooks/shopify] shop-redact: Deleted from ${tables[i]} for account_id=${account_id}`);
          }
        } else {
          console.error(`[webhooks/shopify] shop-redact: Exception deleting from ${tables[i]}:`, result.reason);
        }
      });

      console.log(`[webhooks/shopify] shop-redact: Completed for ${shop_domain} (account row preserved)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[webhooks/shopify] shop-redact error:`, message);
      // Still return 200 — Shopify needs acknowledgment
    }

    res.json({ received: true });
  },
);

// ── Welcome email ─────────────────────────────────────────────────────────────

async function sendWelcomeEmail(to: string, firstName: string): Promise<void> {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to Sillages</title>
</head>
<body style="margin:0;padding:0;background-color:#F7F1EC;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F1EC;padding:48px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Logo / wordmark -->
          <tr>
            <td style="padding-bottom:36px;">
              <span style="font-size:22px;font-weight:700;letter-spacing:0.08em;color:#3A2332;text-transform:uppercase;">Sillages</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="color:#3A2332;font-size:17px;line-height:1.7;">
              <p style="margin:0 0 20px;">Hi ${firstName},</p>

              <p style="margin:0 0 20px;">
                Welcome — Sillages turns your Shopify store data into a sharp daily briefing so you always know what's working, what isn't, and where to focus next.
              </p>

              <p style="margin:0 0 32px;">
                To get your first brief, connect your store. It takes about a minute, and your first briefing will land in your inbox tomorrow morning.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:36px;">
                <tr>
                  <td align="center" style="background-color:#D8B07A;border-radius:6px;">
                    <a href="https://sillages.app/settings"
                       style="display:inline-block;padding:14px 32px;color:#3A2332;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.04em;font-family:Georgia,serif;">
                      Connect your Shopify store
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 20px;">Looking forward to your first brief.</p>

              <p style="margin:0;">
                Tony<br />
                <span style="color:#8B6F7A;font-size:15px;">Founder, Sillages</span>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:48px;border-top:1px solid #E8DDD6;margin-top:48px;">
              <p style="margin:0;color:#8B6F7A;font-size:13px;font-family:Georgia,serif;">
                You're receiving this because you signed up at sillages.app.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to,
    subject: `Welcome to Sillages, ${firstName}`,
    html,
  });
}

// ── Stripe event handler ──────────────────────────────────────────────────────

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  console.log(`[webhooks/stripe] Processing event: ${event.type}`);

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      await syncSubscription(sub);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await cancelSubscription(sub);
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      await handlePaymentSucceeded(invoice);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      await handlePaymentFailed(invoice);
      break;
    }

    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCheckoutCompleted(session);
      break;
    }

    default:
      console.log(`[webhooks/stripe] Unhandled event type: ${event.type}`);
  }
}

// ── Sync helpers ──────────────────────────────────────────────────────────────

async function getAccountIdFromCustomer(customerId: string): Promise<string | null> {
  const { data } = await supabase
    .from('accounts')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  return data?.id ?? null;
}

async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const accountId = await getAccountIdFromCustomer(sub.customer as string);
  if (!accountId) {
    console.warn(`[webhooks/stripe] No account found for customer: ${sub.customer}`);
    return;
  }

  const status = sub.status as string;

  // Map Stripe statuses to our subscription_status enum
  // Stripe: trialing | active | past_due | canceled | unpaid | incomplete | incomplete_expired | paused
  const mapped = mapStripeStatus(status);

  const trialEnd = sub.trial_end
    ? new Date(sub.trial_end * 1000).toISOString()
    : null;

  const periodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;

  const { error } = await supabase
    .from('accounts')
    .update({
      stripe_subscription_id: sub.id,
      subscription_status: mapped,
      trial_ends_at: trialEnd,
      subscription_ends_at: periodEnd,
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId);

  if (error) {
    console.error('[webhooks/stripe] Failed to sync subscription:', error.message);
    throw new Error(error.message);
  }

  console.log(`[webhooks/stripe] Account ${accountId} subscription synced → ${mapped}`);
}

async function cancelSubscription(sub: Stripe.Subscription): Promise<void> {
  const accountId = await getAccountIdFromCustomer(sub.customer as string);
  if (!accountId) return;

  const canceledAt = sub.canceled_at
    ? new Date(sub.canceled_at * 1000).toISOString()
    : new Date().toISOString();

  const { error } = await supabase
    .from('accounts')
    .update({
      subscription_status: 'canceled',
      subscription_ends_at: canceledAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId);

  if (error) {
    console.error('[webhooks/stripe] Failed to cancel subscription:', error.message);
    throw new Error(error.message);
  }

  console.log(`[webhooks/stripe] Account ${accountId} subscription canceled`);
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  // Checkout session completed — subscription will be synced via
  // customer.subscription.created. We update the customer ID here
  // in case it was created server-side and not yet stored.
  const accountId = session.metadata?.account_id;
  if (!accountId || !session.customer) return;

  const { error } = await supabase
    .from('accounts')
    .update({
      stripe_customer_id: session.customer as string,
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
    .is('stripe_customer_id', null); // only if not already set

  if (error) {
    console.error('[webhooks/stripe] Failed to update customer ID on checkout:', error.message);
  }
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  if (!invoice.subscription) return;

  // Re-fetch subscription to get latest status after payment
  const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
  await syncSubscription(sub);

  console.log(`[webhooks/stripe] Payment succeeded for subscription: ${sub.id}`);
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  if (!invoice.customer) return;

  const accountId = await getAccountIdFromCustomer(invoice.customer as string);
  if (!accountId) return;

  // Mark as past_due — Stripe will retry and eventually cancel
  const { error } = await supabase
    .from('accounts')
    .update({
      subscription_status: 'past_due',
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId);

  if (error) {
    console.error('[webhooks/stripe] Failed to mark past_due:', error.message);
    throw new Error(error.message);
  }

  console.log(`[webhooks/stripe] Account ${accountId} marked past_due`);
}

// ── Status mapping ────────────────────────────────────────────────────────────

function mapStripeStatus(
  stripeStatus: string,
): 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' {
  switch (stripeStatus) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    case 'unpaid':
    case 'incomplete':
    case 'paused':
      return 'unpaid';
    default:
      return 'unpaid';
  }
}

export default router;
