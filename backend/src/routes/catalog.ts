import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { resolveShopByAccount } from '../services/catalog/catalogContext.js';
import { runCatalogSync } from '../services/catalog/catalogSync.js';
import { supabaseCatalogStore } from '../services/catalog/supabaseCatalogStore.js';

const router = Router();

/**
 * Catalogue endpoints for the new product. Mounted only in `social_gallery`.
 *
 * Sprint 1 scope: see what was imported, and re-sync on demand for diagnosis.
 * The gallery itself is Sprint 2.
 */

/** A full catalogue read is expensive: cap manual syncs per account. */
const manualSyncLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.accountId ?? req.ip ?? 'unknown',
  message: { error: 'Too many sync requests. Wait a few minutes and try again.' },
});

// GET /api/catalog/status — is my catalogue up to date?
router.get('/status', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shop = await resolveShopByAccount(req.accountId!);
    if (!shop) {
      res.json({ connected: false, productCount: 0, collectionCount: 0, lastSync: null });
      return;
    }

    const [productCount, collections, lastSync] = await Promise.all([
      supabaseCatalogStore.countProducts(shop.connectionId),
      supabaseCatalogStore.listCollections(shop.connectionId),
      supabaseCatalogStore.getLastSyncRun(shop.connectionId),
    ]);

    res.json({
      connected: true,
      shopDomain: shop.shopDomain,
      productCount,
      collectionCount: collections.length,
      lastSync: lastSync
        ? {
            trigger: lastSync.trigger,
            // A run whose heartbeat stopped is reported as stopped, not as
            // still running: the interface must never show a state with no
            // live process behind it.
            status: lastSync.stale ? ('failed' as const) : lastSync.status,
            stale: lastSync.stale,
            startedAt: lastSync.startedAt,
            finishedAt: lastSync.finishedAt,
            counts: lastSync.counts,
            error: lastSync.stale && !lastSync.error
              ? 'The last sync stopped responding. Run it again.'
              : lastSync.error,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/catalog/collections — collections available to build a gallery from
router.get('/collections', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shop = await resolveShopByAccount(req.accountId!);
    if (!shop) {
      res.json({ collections: [] });
      return;
    }
    res.json({ collections: await supabaseCatalogStore.listCollections(shop.connectionId) });
  } catch (err) {
    next(err);
  }
});

// POST /api/catalog/sync — manual re-sync, for diagnosis
router.post('/sync', requireAuth, manualSyncLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shop = await resolveShopByAccount(req.accountId!);
    if (!shop) throw new AppError(400, 'No Shopify store connected');

    const outcome = await runCatalogSync(shop, shop.accessToken, 'manual', {
      store: supabaseCatalogStore,
    });

    if (outcome.status === 'skipped') {
      res.status(409).json({ status: 'already_running' });
      return;
    }
    if (outcome.status === 'failed') {
      res.status(502).json({ status: 'failed', error: outcome.error, counts: outcome.counts });
      return;
    }

    res.json({ status: 'completed', counts: outcome.counts });
  } catch (err) {
    next(err);
  }
});

export default router;
