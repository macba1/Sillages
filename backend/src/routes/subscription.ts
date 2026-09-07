import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';
import { resolveShopByAccount } from '../services/catalog/catalogContext.js';
import {
  isLiveBilling,
  readSubscription,
  startSubscription,
} from '../services/billing/shopifyBilling.js';
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

    const result = await startSubscription(
      shop.shopDomain,
      shop.accessToken,
      (req.body as { plan?: unknown })?.plan,
    );

    if (!result.ok) {
      res.status(result.status).json({ error: result.reason, message: result.message });
      return;
    }

    res.json({ confirmationUrl: result.confirmationUrl, test: result.test });
  } catch (err) {
    next(err);
  }
});

// GET /api/subscription/callback — where Shopify returns after approval
//
// A pure redirect. It is unauthenticated, because Shopify sends the merchant
// here in their browser, so it deliberately does no work: it used to read the
// subscription back, which meant anyone could make us call Shopify on a
// merchant's behalf simply by guessing a shop domain. The Plan screen reads the
// subscription itself, with the merchant's own session, when it loads.
router.get('/callback', (_req: Request, res: Response) => {
  res.redirect(`${env.FRONTEND_URL.replace(/\/+$/, '')}/plan?billing=done`);
});

export default router;
