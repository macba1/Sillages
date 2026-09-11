import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { validateShopDomain } from '../lib/shopify.js';
import { composePublicGallery } from '../services/gallery/galleryService.js';
import { inactiveGallery } from '../services/gallery/galleryTypes.js';
import { ingestEventBatch } from '../services/events/eventIngestion.js';

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

router.options(['/events'], publicCors, (_req, res) => {
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
 * There is deliberately no purchase endpoint here.
 *
 * Revenue arrives on Shopify's signed `orders/create` webhook and nowhere else
 * — see services/events/orderWebhook.ts. This router is reachable by anyone who
 * can open a published gallery, and its only credential, the ingest token, is
 * handed to every one of them. Any order id it accepted could be forged, and
 * because order ids are unique per shop, a forged one permanently blocked the
 * shop's real order from ever being credited.
 *
 * The storefront reports what a shopper did. Shopify reports what they paid.
 */

export default router;
