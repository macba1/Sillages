import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import {
  createPreview,
  publicPreviewPayload,
  startClaim,
} from '../services/preview/previewService.js';
import { supabasePreviewStore } from '../services/preview/previewStore.js';

const router = Router();

/**
 * The public before/after generator. Unauthenticated by design: a shop owner
 * must be able to see a demo of their own store before installing anything.
 *
 * Two things make this endpoint safe to expose:
 *  - every outbound fetch goes through the SSRF guard in `safeFetch.ts`;
 *  - a preview is only reachable by an unguessable token, and every response
 *    is marked `noindex`, so a demo of someone's store never turns up in a
 *    search engine.
 */

/** Building a preview fetches a third-party site, so it is tightly limited. */
const createLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many previews from this address. Try again in a few minutes.' },
});

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

function publicCors(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  // A private demo of someone's store must never be indexed or cached publicly.
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cache-Control', 'no-store');
  next();
}

router.options(['/preview', '/preview/:token', '/preview/:token/claim'], publicCors, (_req, res) => {
  res.status(204).end();
});

// POST /api/public/preview — build a demo from a store's public catalogue
router.post('/preview', publicCors, createLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await createPreview(req.body, {});
    if (!result.ok) {
      res.status(result.status).json({ error: result.reason, message: result.message });
      return;
    }
    res.status(201).json({
      token: result.project.publicToken,
      url: result.url,
      shopDomain: result.project.shopDomain,
      productCount: result.project.productCount,
      expiresAt: result.project.expiresAt,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/public/preview/:token — read a demo
router.get('/preview/:token', publicCors, readLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = String(req.params.token ?? '');
    const project = token.length >= 16 ? await supabasePreviewStore.getByToken(token) : null;

    if (!project) {
      res.status(404).json({ error: 'not_found', message: 'This preview no longer exists.' });
      return;
    }

    res.json(publicPreviewPayload(project));
  } catch (err) {
    next(err);
  }
});

// POST /api/public/preview/:token/claim — choose a design and start the install
router.post(
  '/preview/:token/claim',
  publicCors,
  readLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await startClaim(
        String(req.params.token ?? ''),
        (req.body as { proposal?: unknown })?.proposal,
        {},
      );

      if (!result.ok) {
        res.status(result.status).json({ error: result.reason, message: result.message });
        return;
      }

      res.json({ installUrl: result.installUrl });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
