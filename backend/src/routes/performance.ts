import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { resolveShopByAccount } from '../services/catalog/catalogContext.js';
import { supabaseEventStore } from '../services/events/eventStore.js';
import { supabaseGalleryStore } from '../services/gallery/galleryStore.js';
import { entitlementsForShop } from '../services/gallery/galleryService.js';

const router = Router();

/** Ranges the merchant can look at. Bounded, so a query cannot be unbounded. */
// A Map, not an object literal: `?range=constructor` resolves through
// Object.prototype on a plain object and reaches the query as a function.
const RANGES = new Map<string, number>([
  ['7d', 7],
  ['30d', 30],
  ['90d', 90],
]);
const DEFAULT_RANGE = '30d';

/**
 * What the gallery did. Mounted only in `social_gallery`.
 *
 * Everything here is aggregate. The endpoint never returns a session id or any
 * other per-shopper identifier to the merchant.
 */
router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shop = await resolveShopByAccount(req.accountId!);
    if (!shop) {
      res.json({ connected: false });
      return;
    }

    const requested = String(req.query.range ?? DEFAULT_RANGE);
    const rangeKey = RANGES.has(requested) ? requested : DEFAULT_RANGE;
    const days = RANGES.get(rangeKey)!;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const [totals, top, pixelReporting, config, entitlements] = await Promise.all([
      supabaseEventStore.totals(shop.connectionId, since),
      supabaseEventStore.topProducts(shop.connectionId, since, 10),
      supabaseEventStore.pixelReportedSince(shop.connectionId, since),
      supabaseGalleryStore.getByConnection(shop.connectionId),
      entitlementsForShop(shop),
    ]);

    // The funnel a merchant actually asks about: did looking turn into buying?
    const funnel = [
      { step: 'Gallery views', count: totals.galleryViews },
      { step: 'Products opened', count: totals.postOpens },
      { step: 'Variants chosen', count: totals.variantSelects },
      { step: 'Added to cart', count: totals.addToCarts },
      { step: 'Purchases', count: totals.purchases },
    ];

    // Two different things are measured by two different mechanisms, and only
    // one of them is currently active anywhere. Saying "measuring" for both
    // would tell a merchant their checkout is tracked when it is not.
    const galleryMeasured = config?.status === 'published';
    // Whether the pixel reports, not whether anyone has bought yet. Deriving
    // this from purchases told every shop with no orders that its pixel was
    // switched off — including shops whose pixel had just reported a checkout.
    const checkoutMeasured = pixelReporting || totals.purchases > 0 || totals.attributedOrders > 0;

    // Revenue attribution is a Growth feature; Basic promises "essential
    // metrics". The entitlement was being computed and never applied, so every
    // plan saw attributed revenue. Withheld rather than zeroed, so a Basic
    // merchant is told it is a Growth feature instead of being shown a zero
    // they would read as "the gallery sold nothing".
    const attributionVisible = entitlements.canUseAttribution;
    const visibleTotals = attributionVisible
      ? totals
      : { ...totals, attributedOrders: 0, attributedRevenue: 0, currency: null };

    res.json({
      connected: true,
      range: rangeKey,
      measuring: galleryMeasured,
      measurement: {
        gallery: galleryMeasured,
        // The Web Pixel has to be activated by the app, which needs the
        // write_pixels scope the app does not yet request.
        checkout: checkoutMeasured,
      },
      approximate: totals.approximate === true,
      plan: {
        id: entitlements.planId,
        attributionAvailable: attributionVisible,
      },
      totals: visibleTotals,
      funnel,
      topProducts: top,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
