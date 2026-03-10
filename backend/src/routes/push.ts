import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// ── GET /api/push/vapid-key ─────────────────────────────────────────────────
// Returns the public VAPID key for the frontend to use when subscribing.
router.get('/vapid-key', (_req: Request, res: Response) => {
  res.json({ publicKey: env.VAPID_PUBLIC_KEY ?? null });
});

// ── POST /api/push/subscribe ────────────────────────────────────────────────
// Saves a push subscription for the authenticated user.
router.post(
  '/subscribe',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { endpoint, keys } = raw.subscription ?? raw;

      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        throw new AppError(400, 'Invalid push subscription data');
      }

      // Upsert by endpoint to avoid duplicates
      const { error } = await supabase
        .from('push_subscriptions')
        .upsert(
          {
            account_id: req.accountId!,
            endpoint,
            p256dh: keys.p256dh,
            auth: keys.auth,
          },
          { onConflict: 'endpoint' },
        );

      if (error) {
        throw new AppError(500, `Failed to save subscription: ${error.message}`);
      }

      console.log(`[push] Subscription saved for account ${req.accountId}`);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ── DELETE /api/push/unsubscribe ────────────────────────────────────────────
// Removes push subscription(s) for the authenticated user.
router.delete(
  '/unsubscribe',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { error } = await supabase
        .from('push_subscriptions')
        .delete()
        .eq('account_id', req.accountId!);

      if (error) {
        throw new AppError(500, `Failed to remove subscription: ${error.message}`);
      }

      console.log(`[push] Subscription removed for account ${req.accountId}`);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
