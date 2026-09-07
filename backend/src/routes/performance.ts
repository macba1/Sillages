import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { resolveShopByAccount } from '../services/catalog/catalogContext.js';
import { supabaseEventStore } from '../services/events/eventStore.js';
import { supabaseGalleryStore } from '../services/gallery/galleryStore.js';

const router = Router();

/** Ranges the merchant can look at. Bounded, so a query cannot be unbounded. */
const RANGES: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

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

    const rangeKey = String(req.query.range ?? '30d');
    const days = RANGES[rangeKey] ?? RANGES['30d'];
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const [totals, top, config] = await Promise.all([
      supabaseEventStore.totals(shop.connectionId, since),
      supabaseEventStore.topProducts(shop.connectionId, since, 10),
      supabaseGalleryStore.getByConnection(shop.connectionId),
    ]);

    // The funnel a merchant actually asks about: did looking turn into buying?
    const funnel = [
      { step: 'Gallery views', count: totals.galleryViews },
      { step: 'Products opened', count: totals.postOpens },
      { step: 'Variants chosen', count: totals.variantSelects },
      { step: 'Added to cart', count: totals.addToCarts },
      { step: 'Purchases', count: totals.purchases },
    ];

    res.json({
      connected: true,
      range: rangeKey in RANGES ? rangeKey : '30d',
      measuring: config?.status === 'published',
      totals,
      funnel,
      topProducts: top,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
