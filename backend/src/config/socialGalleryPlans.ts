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
    priceUsd: 9.99,
    currency: 'USD',
    interval: 'month',
    status: 'available',
    trialDays: 14,
    // Every feature listed here is implemented and has been exercised end to
    // end. Basic is the whole product as it exists today, deliberately: a plan
    // may not advertise anything a merchant cannot actually do.
    features: [
      'one_gallery',
      'three_styles',
      'social_stories',
      'automatic_catalog_sync',
      'shoppable_variants',
      'save_and_share',
      'essential_metrics',
    ],
  },
  growth: {
    // Growth is NOT on sale. It previously advertised multiple galleries,
    // revenue attribution, automatic reordering and design experiments; none of
    // those exist. `multiple_galleries` is actively contradicted by the
    // `gallery_configs_one_per_connection_idx` unique index, which enforces one
    // gallery per shop.
    //
    // A plan that charges for features the product does not have is a plan a
    // merchant pays for and receives nothing from, so it stays `coming_soon`
    // until the difference is built and tested. Only what is genuinely planned
    // is listed, and none of it is billable while this is `coming_soon`.
    id: 'growth',
    name: 'Growth',
    priceUsd: 19.99,
    currency: 'USD',
    interval: 'month',
    status: 'coming_soon',
    trialDays: 14,
    features: [
      'multiple_galleries',
      'higher_limits',
    ],
  },
  pro: {
    // Future tier. `status: 'coming_soon'` keeps it out of
    // `getAvailableSocialGalleryPlans()`, so it can be shown and never
    // subscribed to. It is deliberately absent from Shopify App Pricing too.
    id: 'pro',
    name: 'Pro',
    priceUsd: 49.99,
    currency: 'USD',
    interval: 'month',
    status: 'coming_soon',
    trialDays: 0,
    features: [
      'multiple_storefronts',
      'advanced_rules',
      'priority_support',
    ],
  },
};

/** Plans a merchant can actually subscribe to today: Basic only. */
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
