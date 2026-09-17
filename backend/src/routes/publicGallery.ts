import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { validateShopDomain } from '../lib/shopify.js';
import { composePublicGallery } from '../services/gallery/galleryService.js';
import { inactiveGallery } from '../services/gallery/galleryTypes.js';
import { ingestEventBatch, ingestPurchase } from '../services/events/eventIngestion.js';
import {
  castPickVote,
  composeShareCard,
  createPicks,
  deletePicks,
  readPicks,
} from '../services/social/socialService.js';

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

router.options(['/events', '/purchase', '/picks'], publicCors, (_req, res) => {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.status(204).end();
});

router.options(['/picks/:token', '/picks/:token/vote'], publicCors, (_req, res) => {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.status(204).end();
});

/**
 * Writes are rarer than reads and cost more, so they get a tighter ceiling of
 * their own: making links and voting are the two things worth flooding.
 */
const socialWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

/** Drawing a card is the most expensive thing here, so it is the most bounded. */
const cardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

/**
 * A Shopify collection handle: lowercase letters, digits and hyphens.
 *
 * Checked before it reaches a query so a shopper-controlled URL cannot be used
 * to probe anything. Anything that fails is dropped rather than rejected: the
 * gallery still renders, showing the collection the merchant configured.
 */
const COLLECTION_HANDLE = /^[a-z0-9][a-z0-9-]{0,254}$/;

function collectionHandleFrom(raw: unknown): string | null {
  const handle = String(raw ?? '').trim().toLowerCase();
  return COLLECTION_HANDLE.test(handle) ? handle : null;
}

// GET /api/public/gallery/:shopDomain?collection=<handle>
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

      // Sent by the block when it sits on a collection template, so the
      // gallery shows the collection the shopper is browsing.
      const collectionHandle = collectionHandleFrom((req.query as { collection?: unknown }).collection);

      const gallery = await composePublicGallery(shopDomain, {}, { collectionHandle });

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

// GET /api/public/share-card/:shopDomain/:productId.jpg
//
// The vertical card a shopper sends a friend, drawn from the shop's own
// published photograph. Everything in it is already public.
router.get(
  '/share-card/:shopDomain/:productId.jpg',
  publicCors,
  cardLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopDomain = String(req.params.shopDomain ?? '').toLowerCase();
      const productId = Number(req.params.productId);

      if (!validateShopDomain(shopDomain) || !Number.isSafeInteger(productId) || productId <= 0) {
        res.status(404).end();
        return;
      }

      const card = await composeShareCard(shopDomain, productId);
      if (!card) {
        // A card that cannot be drawn is not an error the shopper should see:
        // the storefront hides the preview and every other way of sharing
        // still works.
        res.status(404).end();
        return;
      }

      // Long cache: the card is a function of catalogue data and settings, and
      // a republish changes the URL nothing — so a stale window keeps it cheap
      // while a price change reaches the card within the hour.
      res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
      res.setHeader('Content-Type', 'image/jpeg');

      // The whole point of this image is to be embedded somewhere else: in the
      // storefront's own preview, and in whatever a shopper sends it to. The
      // app's default `Cross-Origin-Resource-Policy: same-origin` forbade
      // exactly that, so the card loaded fine when fetched or opened directly
      // and failed silently as an <img> on every storefront — the preview
      // removed itself and no shopper ever saw the card before sending it.
      //
      // Only this route is opened up, and it serves nothing that is not
      // already public on the shop's own product page.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.send(card);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/public/picks — turn saved products into a link
router.post(
  '/picks',
  publicCors,
  socialWriteLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const shopDomain = String(body.shop ?? '').toLowerCase();
      if (!validateShopDomain(shopDomain)) {
        res.status(400).json({ error: 'unknown_shop' });
        return;
      }

      const result = await createPicks(shopDomain, body.productIds, body.mode);
      if (!result.ok) {
        res.status(result.status).json({ error: result.reason });
        return;
      }

      res.status(201).json(result.value);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/public/picks/:token — read a shared list, and its votes
router.get(
  '/picks/:token',
  publicCors,
  storefrontLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const view = await readPicks(String(req.params.token ?? ''));
      if (!view) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      // Never cached and never indexed: a shared list is private-by-obscurity,
      // and a search engine holding a copy would defeat that entirely.
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
      res.json(view);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/public/picks/:token/vote — one tap, one opinion
router.post(
  '/picks/:token/vote',
  publicCors,
  socialWriteLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const result = await castPickVote(
        String(req.params.token ?? ''),
        body.productId,
        body.voterKey,
      );
      if (!result.ok) {
        res.status(result.status).json({ error: result.reason });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(result.value);
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/public/picks/:token — the creator's device removes its own list
router.delete(
  '/picks/:token',
  publicCors,
  socialWriteLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = String(req.header('X-Sillages-Owner') ?? '');
      const removed = await deletePicks(String(req.params.token ?? ''), key);
      // The same answer either way: whether a token exists is not something an
      // anonymous caller gets to learn by deleting at it.
      res.status(removed ? 204 : 404).end();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
