import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  SOCIAL_GALLERY_BILLING_PROVIDER,
  getAllSocialGalleryPlans,
  getAvailableSocialGalleryPlans,
} from '../config/socialGalleryPlans.js';

const router = Router();

/**
 * GET /api/plans
 *
 * Single source of truth for the new product's plans, served to the frontend so
 * pricing is never duplicated client-side.
 *
 * Only mounted in `social_gallery` mode. No auth: the Plan screen must render
 * before a merchant has an account, exactly like the legacy /plans page.
 *
 * Sprint 0 returns configuration only — it starts no subscription and does not
 * touch Stripe.
 */
router.get('/', (_req: Request, res: Response) => {
  res.json({
    billingProvider: SOCIAL_GALLERY_BILLING_PROVIDER,
    plans: getAvailableSocialGalleryPlans(),
    upcomingPlans: getAllSocialGalleryPlans().filter((plan) => plan.status === 'coming_soon'),
  });
});

export default router;
