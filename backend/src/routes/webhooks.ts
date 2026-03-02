import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import { stripe } from '../lib/stripe.js';
import { supabase } from '../lib/supabase.js';
import { env } from '../config/env.js';

const router = Router();

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
        env.STRIPE_WEBHOOK_SECRET,
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

// ── POST /api/webhooks/shopify ────────────────────────────────────────────────
// Shopify GDPR mandatory webhooks (customers/redact, shop/redact, customers/data_request)
router.post(
  '/shopify',
  async (req: Request, res: Response) => {
    const topic = req.headers['x-shopify-topic'] as string | undefined;
    console.log(`[webhooks/shopify] Received topic: ${topic ?? 'unknown'}`);
    // GDPR webhooks require a 200 response within 5s — we ack immediately.
    // Full data deletion pipeline would be implemented here for production compliance.
    res.json({ received: true });
  },
);

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
      const session = event.data.object as Stripe.CheckoutSession;
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

async function handleCheckoutCompleted(session: Stripe.CheckoutSession): Promise<void> {
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
