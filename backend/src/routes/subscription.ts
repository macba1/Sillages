import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';
import { resolveShopByAccount } from '../services/catalog/catalogContext.js';
import {
  isLiveBilling,
  managedPricingUrl,
  planIdFromHandle,
  readSubscription,
  startSubscription,
} from '../services/billing/shopifyBilling.js';
import { entitlementsFor, supabaseSubscriptionStore } from '../services/billing/entitlements.js';
import { resumeGalleryAfterPlanReturn } from '../services/gallery/galleryService.js';
import { getAvailableSocialGalleryPlans } from '../config/socialGalleryPlans.js';

const router = Router();

/**
 * Billing for the new product, through Shopify only. Mounted in
 * `social_gallery`; the legacy Stripe routes stay retired.
 *
 * Test mode is the default everywhere: a real charge requires
 * SHOPIFY_BILLING_LIVE=true, set deliberately after App Store review.
 */

// GET /api/subscription — what the merchant is on right now
router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shop = await resolveShopByAccount(req.accountId!);
    if (!shop) {
      res.json({ connected: false, plans: getAvailableSocialGalleryPlans(), live: isLiveBilling() });
      return;
    }

    let subscription = null;
    let unreachable = false;
    try {
      subscription = await readSubscription(shop.shopDomain, shop.accessToken);

      // Shopify is the source of truth, so persist what it says. Without this
      // the local mirror is only ever written by a webhook, and a merchant
      // whose approval webhook was missed would keep paying while the product
      // told them they had no plan.
      const mirrored = {
        connectionId: shop.connectionId,
        accountId: shop.accountId,
        shopifyGid: subscription?.id ?? null,
        planId: subscription?.planId ?? null,
        status: (subscription?.status?.toLowerCase() as never) ?? 'none',
        isTest: subscription?.test ?? true,
        trialEndsAt: null,
        currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      };
      await supabaseSubscriptionStore.upsert(mirrored);

      // A gallery we switched off when a plan lapsed goes back on as soon as a
      // live plan is seen again. Doing it here as well as in the webhook means
      // a merchant who upgrades and comes straight back finds their storefront
      // already on, without waiting for a webhook that may have raced.
      if (entitlementsFor(mirrored).canPublish) {
        await resumeGalleryAfterPlanReturn(shop.connectionId);
      }
    } catch {
      // Shopify being unreachable must not blank the screen; say so instead.
      unreachable = true;
    }

    res.json({
      connected: true,
      shopDomain: shop.shopDomain,
      plans: getAvailableSocialGalleryPlans(),
      subscription,
      unreachable,
      /** Shopify hosts the plan picker; the product only links to it. */
      pricingPageUrl: managedPricingUrl(shop.shopDomain),
      /** False means every charge Shopify creates here is a test charge. */
      live: isLiveBilling(),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/subscription — start a subscription, returns Shopify's approval URL
router.post('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shop = await resolveShopByAccount(req.accountId!);
    if (!shop) throw new AppError(400, 'No Shopify store connected');

    // No charge is created here. The app is on Shopify App Pricing, so Shopify
    // owns the subscription and this only answers where the merchant goes to
    // choose one.
    const result = startSubscription(shop.shopDomain, (req.body as { plan?: unknown })?.plan);

    if (!result.ok) {
      res.status(result.status).json({ error: result.reason, message: result.message });
      return;
    }

    res.json({ pricingPageUrl: result.pricingPageUrl, planId: result.planId });
  } catch (err) {
    next(err);
  }
});

// GET /api/subscription/callback — the welcome link Shopify's pricing page
// returns the merchant on.
//
// Shopify appends `plan_handle`. It is a hint and nothing more: the merchant
// controls the URL they arrive on, so acting on it would let anyone grant
// themselves a plan by typing one. The handle is carried through to the Plan
// screen only so the UI can say which plan is being confirmed; the screen then
// asks Shopify, with the merchant's own session, what the shop is really on.
//
// Deliberately still does no Shopify work itself: it is unauthenticated, and
// reading a subscription here would let anyone make us call Shopify for any
// shop by guessing a domain.
router.get('/callback', (req: Request, res: Response) => {
  const handle = planIdFromHandle((req.query as { plan_handle?: unknown }).plan_handle);
  const suffix = handle ? `&plan_handle=${encodeURIComponent(handle)}` : '';
  res.redirect(`${env.FRONTEND_URL.replace(/\/+$/, '')}/plan?billing=done${suffix}`);
});

export default router;
