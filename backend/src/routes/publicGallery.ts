import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { validateShopDomain } from '../lib/shopify.js';
import { composePublicGallery } from '../services/gallery/galleryService.js';
import { inactiveGallery } from '../services/gallery/galleryTypes.js';

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

router.options('/gallery/:shopDomain', publicCors, (_req, res) => {
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

export default router;
