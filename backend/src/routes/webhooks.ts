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

// ── POST /api/webhooks/shopify-compliance (unified GDPR endpoint) ────────────
// Single endpoint that handles all 3 compliance topics via X-Shopify-Topic header.
// Also keeps legacy per-topic routes for backwards compatibility.

async function handleCustomersDataRequest(shopDomain: string, customer: { id: number; email: string } | undefined) {
  console.log(`[webhooks/shopify] customers/data_request for shop=${shopDomain} customer_id=${customer?.id} email=${customer?.email}`);

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
}

async function handleCustomersRedact(shopDomain: string, customer: { id: number; email: string } | undefined) {
  console.log(`[webhooks/shopify] customers/redact for shop=${shopDomain} customer_id=${customer?.id} email=${customer?.email}`);
  console.log('[webhooks/shopify] No individual customer PII stored — only aggregated store snapshots. No action needed.');
}

async function handleShopRedact(shopDomain: string) {
  console.log(`[webhooks/shopify] shop/redact for shop=${shopDomain} — deleting all shop data`);

  const { data: connection } = await supabase
    .from('shopify_connections')
    .select('id, account_id')
    .eq('shop_domain', shopDomain)
    .maybeSingle();

  if (!connection) {
    console.log(`[webhooks/shopify] shop-redact: No connection found for ${shopDomain} — nothing to delete`);
    return;
  }

  const { account_id } = connection;
  console.log(`[webhooks/shopify] shop-redact: Found account_id=${account_id} for ${shopDomain}`);

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

  console.log(`[webhooks/shopify] shop-redact: Completed for ${shopDomain} (account row preserved)`);
}

// Shared HMAC + parse middleware for all compliance endpoints
function parseComplianceWebhook(req: Request, res: Response): { shop_domain: string; customer?: { id: number; email: string } } | null {
  const rawBody = req.body as Buffer;
  const hmac = req.headers['x-shopify-hmac-sha256'] as string | undefined;

  if (!hmac || !verifyShopifyWebhookMultiApp(rawBody, hmac)) {
    console.warn('[webhooks/shopify] Compliance webhook HMAC verification failed');
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return null;
  }
}

// ── Unified compliance endpoint ──────────────────────────────────────────────
// Detects topic from X-Shopify-Topic header and routes to the correct handler.
router.post(
  '/shopify-compliance',
  async (req: Request, res: Response) => {
    const payload = parseComplianceWebhook(req, res);
    if (!payload) return;

    const topic = req.headers['x-shopify-topic'] as string | undefined;
    console.log(`[webhooks/shopify] Compliance webhook received — topic=${topic} shop=${payload.shop_domain}`);

    try {
      switch (topic) {
        case 'customers/data_request':
          await handleCustomersDataRequest(payload.shop_domain, payload.customer);
          break;
        case 'customers/redact':
          await handleCustomersRedact(payload.shop_domain, payload.customer);
          break;
        case 'shop/redact':
          await handleShopRedact(payload.shop_domain);
          break;
        default:
          console.warn(`[webhooks/shopify] Unknown compliance topic: ${topic}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[webhooks/shopify] Compliance webhook error (${topic}):`, message);
      // Still return 200 — Shopify needs acknowledgment
    }

    res.json({ received: true });
  },
);

// ── Legacy per-topic routes (backwards compatibility) ────────────────────────
router.post(
  ['/shopify/customers-data-request', '/customers-data-request'],
  async (req: Request, res: Response) => {
    const payload = parseComplianceWebhook(req, res);
    if (!payload) return;
    try { await handleCustomersDataRequest(payload.shop_domain, payload.customer); } catch (err) {
      console.error(`[webhooks/shopify] customers-data-request error:`, (err as Error).message);
    }
    res.json({ received: true });
  },
);

router.post(
  ['/shopify/customers-redact', '/customers-redact'],
  async (req: Request, res: Response) => {
    const payload = parseComplianceWebhook(req, res);
    if (!payload) return;
    try { await handleCustomersRedact(payload.shop_domain, payload.customer); } catch (err) {
      console.error(`[webhooks/shopify] customers-redact error:`, (err as Error).message);
    }
    res.json({ received: true });
  },
);

router.post(
  ['/shopify/shop-redact', '/shop-redact'],
  async (req: Request, res: Response) => {
    const payload = parseComplianceWebhook(req, res);
    if (!payload) return;
    try { await handleShopRedact(payload.shop_domain); } catch (err) {
      console.error(`[webhooks/shopify] shop-redact error:`, (err as Error).message);
    }
    res.json({ received: true });
  },
);

// ── POST /api/webhooks/resend ──────────────────────────────────────────────────
// Resend sends delivery events: email.delivered, email.opened, email.clicked,
// email.bounced, email.complained. We update email_log with timestamps.
// Docs: https://resend.com/docs/dashboard/webhooks/introduction

interface ResendWebhookPayload {
  type: string;
  created_at: string;
  data: {
    email_id: string;       // Resend message ID — matches email_log.message_id
    from: string;
    to: string[];
    subject: string;
    created_at: string;
    click?: { link: string };
  };
}

router.post(
  '/resend',
  async (req: Request, res: Response) => {
    // Verify webhook signature if secret is configured
    if (env.RESEND_WEBHOOK_SECRET) {
      const svixId = req.headers['svix-id'] as string | undefined;
      const svixTimestamp = req.headers['svix-timestamp'] as string | undefined;
      const svixSignature = req.headers['svix-signature'] as string | undefined;

      if (!svixId || !svixTimestamp || !svixSignature) {
        console.warn('[webhooks/resend] Missing Svix headers');
        res.status(401).json({ error: 'Missing signature headers' });
        return;
      }

      // Verify HMAC using Svix protocol
      const crypto = await import('crypto');
      const rawBody = (req.body instanceof Buffer ? req.body : Buffer.from(JSON.stringify(req.body))).toString('utf8');
      const secretBytes = Buffer.from(env.RESEND_WEBHOOK_SECRET.replace('whsec_', ''), 'base64');
      const toSign = `${svixId}.${svixTimestamp}.${rawBody}`;
      const expectedSignature = crypto.createHmac('sha256', secretBytes).update(toSign).digest('base64');

      // svix-signature can have multiple signatures: "v1,<sig1> v1,<sig2>"
      const signatures = svixSignature.split(' ').map(s => s.replace('v1,', ''));
      if (!signatures.includes(expectedSignature)) {
        console.warn('[webhooks/resend] Signature verification failed');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    let payload: ResendWebhookPayload;
    try {
      const raw = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);
      payload = JSON.parse(raw) as ResendWebhookPayload;
    } catch {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }

    const messageId = payload.data?.email_id;
    if (!messageId) {
      console.warn('[webhooks/resend] No email_id in payload');
      res.json({ received: true });
      return;
    }

    const eventType = payload.type;
    const eventTime = payload.created_at || new Date().toISOString();

    console.log(`[webhooks/resend] ${eventType} for message_id=${messageId}`);

    // Map Resend event types to email_log columns
    const columnMap: Record<string, string> = {
      'email.delivered': 'delivered_at',
      'email.opened': 'opened_at',
      'email.clicked': 'clicked_at',
      'email.bounced': 'bounced_at',
      'email.complained': 'bounced_at', // treat complaints like bounces
    };

    const column = columnMap[eventType];
    if (!column) {
      console.log(`[webhooks/resend] Ignoring event type: ${eventType}`);
      res.json({ received: true });
      return;
    }

    try {
      const { error } = await supabase
        .from('email_log')
        .update({ [column]: eventTime })
        .eq('message_id', messageId)
        .is(column, null); // only set if not already set (first event wins)

      if (error) {
        console.error(`[webhooks/resend] Failed to update email_log: ${error.message}`);
      }

      // If bounced, also update status
      if (eventType === 'email.bounced' || eventType === 'email.complained') {
        await supabase
          .from('email_log')
          .update({ status: 'bounced' })
          .eq('message_id', messageId);
      }
    } catch (err) {
      console.error(`[webhooks/resend] Error processing webhook: ${(err as Error).message}`);
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
