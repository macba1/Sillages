import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { stripe, PLANS, isPlanKey } from '../lib/stripe.js';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';

const router = Router();

// ── GET /api/billing/plans ────────────────────────────────────────────────────
// Returns the 3 plan definitions for the frontend pricing page.
router.get('/plans', (_req, res) => {
  res.json({
    plans: [
      {
        key: 'starter',
        name: 'Starter',
        price: 29,
        description: 'One store. Daily brief delivered every morning.',
        features: ['Daily intelligence brief', 'All 6 sections', 'Email delivery', '30-day history'],
      },
      {
        key: 'growth',
        name: 'Growth',
        price: 79,
        description: 'More history, configurable tone and focus areas.',
        features: ['Everything in Starter', '90-day history', 'Custom focus areas', 'Brief tone control', 'Priority support'],
      },
      {
        key: 'scale',
        name: 'Scale',
        price: 149,
        description: 'Full access, API, and white-glove onboarding.',
        features: ['Everything in Growth', 'Unlimited history', 'Competitor context', 'API access (coming soon)', 'Dedicated onboarding'],
      },
    ],
  });
});

// ── GET /api/billing/subscription ────────────────────────────────────────────
// Returns current subscription status for the authed account.
router.get(
  '/subscription',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { data: account, error } = await supabase
        .from('accounts')
        .select('subscription_status, stripe_subscription_id, trial_ends_at, subscription_ends_at')
        .eq('id', req.accountId!)
        .single();

      if (error) throw new AppError(500, error.message);

      res.json({ subscription: account });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /api/billing/checkout ────────────────────────────────────────────────
// Creates a Stripe Checkout session for the selected plan.
router.post(
  '/checkout',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { plan } = req.body as { plan: unknown };

      if (!isPlanKey(plan)) {
        throw new AppError(400, `Invalid plan. Must be one of: starter, growth, scale`);
      }

      // Load account
      const { data: account, error: accError } = await supabase
        .from('accounts')
        .select('email, full_name, stripe_customer_id, subscription_status')
        .eq('id', req.accountId!)
        .single();

      if (accError || !account) throw new AppError(404, 'Account not found');

      // Already active — send to portal instead
      if (account.subscription_status === 'active') {
        throw new AppError(400, 'Already subscribed. Use the customer portal to manage your plan.');
      }

      // Reuse or create Stripe customer
      let customerId = account.stripe_customer_id as string | null;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: account.email as string,
          name: (account.full_name as string | null) ?? undefined,
          metadata: { account_id: req.accountId! },
        });
        customerId = customer.id;
        await supabase
          .from('accounts')
          .update({ stripe_customer_id: customerId })
          .eq('id', req.accountId!);
      }

      const priceId = PLANS[plan].priceId();

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: {
          trial_period_days: 14,
          metadata: { account_id: req.accountId!, plan },
        },
        success_url: `${env.FRONTEND_URL}/dashboard?checkout=success`,
        cancel_url: `${env.FRONTEND_URL}/billing?checkout=cancelled`,
        allow_promotion_codes: true,
        metadata: { account_id: req.accountId!, plan },
      });

      res.json({ url: session.url });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /api/billing/portal ──────────────────────────────────────────────────
// Creates a Stripe Customer Portal session to manage subscription.
router.post(
  '/portal',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { data: account, error } = await supabase
        .from('accounts')
        .select('stripe_customer_id')
        .eq('id', req.accountId!)
        .single();

      if (error || !account) throw new AppError(404, 'Account not found');
      if (!account.stripe_customer_id) {
        throw new AppError(400, 'No billing account found. Please subscribe first.');
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: account.stripe_customer_id as string,
        return_url: `${env.FRONTEND_URL}/settings`,
      });

      res.json({ url: session.url });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
