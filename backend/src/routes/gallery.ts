import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { resolveShopByAccount } from '../services/catalog/catalogContext.js';
import {
  composePublicGallery,
  disableGallery,
  getGallery,
  publishGallery,
  revertGallery,
  saveGallery,
} from '../services/gallery/galleryService.js';
import { supabaseGalleryStore } from '../services/gallery/galleryStore.js';
import { supabaseEventStore } from '../services/events/eventStore.js';

const router = Router();

/**
 * Merchant-facing gallery administration. Mounted only in `social_gallery`.
 */

async function requireShop(req: Request) {
  const shop = await resolveShopByAccount(req.accountId!);
  if (!shop) throw new AppError(400, 'No Shopify store connected');
  return shop;
}

// GET /api/gallery — current settings
router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shop = await requireShop(req);
    const config = await getGallery(shop);
    const versions = await supabaseGalleryStore.listVersions(config.id);

    // "Published" and "actually on the storefront" are different things: the
    // gallery only renders once the merchant has added the block to their
    // theme. Reporting the first as if it were the second would leave someone
    // staring at a live badge and zero traffic with no idea why.
    let storefront: { seen: boolean; lastSeenAt: string | null } | null = null;
    if (config.status === 'published' && config.publishedAt) {
      const lastSeenAt = await supabaseEventStore.lastGalleryViewSince(shop.connectionId, config.publishedAt);
      storefront = { seen: lastSeenAt !== null, lastSeenAt };
    }

    res.json({ gallery: config, versions, storefront });
  } catch (err) {
    next(err);
  }
});

// PUT /api/gallery — save settings (does not publish)
router.put('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shop = await requireShop(req);
    res.json({ gallery: await saveGallery(shop, req.body) });
  } catch (err) {
    next(err);
  }
});

// GET /api/gallery/preview — exactly what the storefront would render
router.get('/preview', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shop = await requireShop(req);
    const config = await getGallery(shop);

    // Preview must work before anything is published, so compose from the
    // current draft rather than from the published row.
    const [posts, stories] = await Promise.all([
      supabaseGalleryStore.loadPosts(shop.connectionId, config.collectionId, config.postsLimit),
      config.showStories ? supabaseGalleryStore.loadStories(shop.connectionId, 12) : Promise.resolve([]),
    ]);

    res.json({
      shop: shop.shopDomain,
      active: config.status === 'published',
      version: config.version,
      style: config.style,
      heading: config.heading,
      showStories: config.showStories,
      showQuickBuy: config.showQuickBuy,
      stories,
      posts,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/gallery/publish
router.post('/publish', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shop = await requireShop(req);
    const published = await publishGallery(shop);
    if (!published) throw new AppError(400, 'There is no gallery to publish yet');
    res.json({ gallery: published });
  } catch (err) {
    next(err);
  }
});

// POST /api/gallery/disable
router.post('/disable', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shop = await requireShop(req);
    const disabled = await disableGallery(shop);
    if (!disabled) throw new AppError(400, 'There is no gallery to disable');
    res.json({ gallery: disabled });
  } catch (err) {
    next(err);
  }
});

// POST /api/gallery/revert — restore a previously published version
router.post('/revert', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shop = await requireShop(req);
    const version = Number((req.body as { version?: unknown })?.version);
    if (!Number.isInteger(version) || version < 1) throw new AppError(400, 'A valid version is required');

    const reverted = await revertGallery(shop, version);
    if (!reverted) throw new AppError(404, 'That version does not exist');
    res.json({ gallery: reverted });
  } catch (err) {
    next(err);
  }
});

// GET /api/gallery/public-preview — the exact public payload, for debugging
router.get('/public-preview', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shop = await requireShop(req);
    res.json(await composePublicGallery(shop.shopDomain));
  } catch (err) {
    next(err);
  }
});

export default router;
