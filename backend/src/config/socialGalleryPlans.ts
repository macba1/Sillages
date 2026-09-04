/**
 * Single source of truth for the NEW product's commercial plans.
 *
 * Sprint 0 scope: configuration only. Nothing here creates a subscription, and
 * no code path in `social_gallery` mode touches Stripe. Billing for the new
 * product will be Shopify Billing exclusively (Sprint 6).
 *
 * The legacy plan definitions (`lib/stripe.ts` PLANS, `lib/shopify.ts`
 * SHOPIFY_PLANS, `routes/billing.ts` GET /plans, `lib/plans.ts`,
 * `lib/plans_v2.ts`, and the `subscription_plans` migrations) are intentionally
 * left untouched so `legacy` stays reversible. They must NOT be used by the new
 * product.
 */

export const SOCIAL_GALLERY_PLAN_IDS = ['basic', 'growth', 'pro'] as const;
export type SocialGalleryPlanId = (typeof SOCIAL_GALLERY_PLAN_IDS)[number];

/** How a plan may be offered today. */
export type SocialGalleryPlanStatus = 'available' | 'coming_soon';

export interface SocialGalleryPlan {
  id: SocialGalleryPlanId;
  name: string;
  /** Monthly price in USD. `null` means no price is committed yet. */
  priceUsd: number | null;
  currency: 'USD';
  interval: 'month';
  status: SocialGalleryPlanStatus;
  /** Free trial in days, applied when Shopify Billing is wired up (Sprint 6). */
  trialDays: number;
  features: readonly string[];
}

/**
 * Billing provider for the new product. Shopify Billing only — Stripe is not
 * part of the `social_gallery` flow.
 */
export const SOCIAL_GALLERY_BILLING_PROVIDER = 'shopify_billing' as const;

export const SOCIAL_GALLERY_PLANS: Readonly<Record<SocialGalleryPlanId, SocialGalleryPlan>> = {
  basic: {
    id: 'basic',
    name: 'Basic',
    priceUsd: 29,
    currency: 'USD',
    interval: 'month',
    status: 'available',
    trialDays: 14,
    features: [
      'one_gallery',
      'three_styles',
      'automatic_catalog_sync',
      'shoppable_variants',
      'save_and_share',
      'essential_metrics',
    ],
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    priceUsd: 79,
    currency: 'USD',
    interval: 'month',
    status: 'available',
    trialDays: 14,
    features: [
      'multiple_galleries',
      'revenue_attribution',
      'automatic_reordering',
      'design_experiments',
    ],
  },
  pro: {
    // Future tier: price approved at $149/month, but `status: 'coming_soon'`
    // keeps it out of `getAvailableSocialGalleryPlans()`, so it can be shown
    // and never subscribed to until the Billing sprint enables it.
    id: 'pro',
    name: 'Pro',
    priceUsd: 149,
    currency: 'USD',
    interval: 'month',
    status: 'coming_soon',
    trialDays: 0,
    features: [
      'higher_volume',
      'multiple_storefronts',
      'advanced_rules',
      'priority_support',
    ],
  },
};

/** Plans a merchant can actually subscribe to today: Basic and Growth. */
export function getAvailableSocialGalleryPlans(): SocialGalleryPlan[] {
  return SOCIAL_GALLERY_PLAN_IDS
    .map((id) => SOCIAL_GALLERY_PLANS[id])
    .filter((plan) => plan.status === 'available');
}

/** Every plan, including the ones shown as "coming soon". */
export function getAllSocialGalleryPlans(): SocialGalleryPlan[] {
  return SOCIAL_GALLERY_PLAN_IDS.map((id) => SOCIAL_GALLERY_PLANS[id]);
}

export function isSocialGalleryPlanId(value: string): value is SocialGalleryPlanId {
  return (SOCIAL_GALLERY_PLAN_IDS as readonly string[]).includes(value);
}
