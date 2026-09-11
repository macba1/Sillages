import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { validateShopDomain } from '../lib/shopify.js';
import { composePublicGallery } from '../services/gallery/galleryService.js';
import { inactiveGallery } from '../services/gallery/galleryTypes.js';
import { ingestEventBatch, ingestPurchase } from '../services/events/eventIngestion.js';

const router = Router();

/**
 * Public storefront API. Mounted only in `social_gallery`.
 *
 * This is the one unauthenticated, cross-origin surface of the product. It
 * therefore returns strictly public storefront data — products, variants,
 * prices, images, collection names — and never account ids, internal UUIDs,
 * tokens or anything about a shopper.
 *
 * It is read-only: no method other than GET is mounted.
 */

/** Storefront traffic, so the ceiling is generous but still bounded per IP. */
const storefrontLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

/** Any storefront may read a published gallery, so CORS is open for GET only. */
function publicCors(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  next();
}

/**
 * Measurement has its own budget, separate from both the admin limiter and the
 * gallery read limiter: a browsing session sends batches, not page loads, and
 * throttling reads because of writes (or the reverse) would be wrong.
 */
const eventsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many events' },
});

router.options('/gallery/:shopDomain', publicCors, (_req, res) => {
  res.status(204).end();
});

router.options(['/events', '/purchase'], publicCors, (_req, res) => {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.status(204).end();
});

// GET /api/public/gallery/:shopDomain
router.get(
  '/gallery/:shopDomain',
  publicCors,
  storefrontLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopDomain = String(req.params.shopDomain ?? '').toLowerCase();

      // An unknown or malformed shop gets the same inactive answer as a shop
      // with nothing published, so this endpoint cannot be used to enumerate
      // which stores have Sillages installed.
      if (!validateShopDomain(shopDomain)) {
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.json(inactiveGallery(shopDomain));
        return;
      }

      const gallery = await composePublicGallery(shopDomain);

      // Short cache with a long stale window: the storefront stays fast, and a
      // publish is visible within a minute.
      res.setHeader(
        'Cache-Control',
        gallery.active
          ? 'public, max-age=60, stale-while-revalidate=300'
          : 'public, max-age=30',
      );
      res.json(gallery);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/public/events — batched storefront measurement
router.post(
  '/events',
  publicCors,
  eventsLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await ingestEventBatch(req.body);

      if (!result.ok) {
        // Deliberately terse: this endpoint tells an anonymous caller nothing
        // about which shops exist or why exactly a batch was refused.
        res.status(result.status).json({ error: result.reason });
        return;
      }

      res.status(202).json({ accepted: result.accepted, stored: result.stored });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Purchase reporting is closed unless deliberately switched on.
 *
 * The Web Pixel is the only legitimate caller, and it is not activated on any
 * store yet (activation needs `webPixelCreate` and the `write_pixels` scope).
 * Until then this endpoint has no real traffic and would accept
 * merchant-facing revenue figures from anyone who can read a shop's public
 * gallery — including order ids that, through the unique index, would
 * permanently block the shop's real orders from ever being credited.
 *
 * Enable it in the same change that activates the pixel.
 */
function purchaseReportingEnabled(): boolean {
  return process.env.ENABLE_PIXEL_PURCHASE_REPORTING === 'true';
}

// POST /api/public/purchase — reported by the Web Pixel after checkout
router.post(
  '/purchase',
  publicCors,
  eventsLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!purchaseReportingEnabled()) {
        res.status(404).json({ error: 'not_enabled' });
        return;
      }

      const result = await ingestPurchase(req.body);
      if (!result.ok) {
        res.status(result.status).json({ error: result.reason });
        return;
      }
      res.status(202).json({ attributed: result.outcome.attributed });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
