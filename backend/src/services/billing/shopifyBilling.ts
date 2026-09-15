import { env } from '../../config/env.js';
import { createCatalogClient, type CatalogClient } from '../../lib/shopifyCatalog.js';
import {
  SOCIAL_GALLERY_PLANS,
  getAllSocialGalleryPlans,
  isSocialGalleryPlanId,
  type SocialGalleryPlan,
  type SocialGalleryPlanId,
} from '../../config/socialGalleryPlans.js';

const LOG = '[billing]';

/**
 * Shopify Billing for the new product.
 *
 * Charges appear on the merchant's Shopify invoice; Stripe is not involved.
 *
 * **Test mode is on unless explicitly disabled.** `SHOPIFY_BILLING_LIVE` must be
 * the literal string "true" for a real charge to be created. Until the app is
 * reviewed and someone deliberately flips it, every subscription Shopify creates
 * here is a test charge and no money moves.
 */
export function isLiveBilling(): boolean {
  return process.env.SHOPIFY_BILLING_LIVE === 'true';
}

const CURRENT_SUBSCRIPTIONS = `
  query SillagesCurrentSubscription {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        trialDays
        createdAt
        currentPeriodEnd
      }
    }
  }
`;

const CANCEL_SUBSCRIPTION = `
  mutation SillagesSubscriptionCancel($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription { id status }
      userErrors { field message }
    }
  }
`;

export interface BillingDeps {
  createClient?: (shop: string, token: string) => CatalogClient;
}

export type StartSubscriptionResult =
  | { ok: true; pricingPageUrl: string; planId: SocialGalleryPlanId }
  | { ok: false; status: 400; reason: string; message: string };

/**
 * The app's handle on the Shopify App Store, which is also the handle in the
 * hosted pricing URL. Overridable so a differently-named app can reuse this.
 */
export function appHandle(): string {
  // Shopify's app handle, which is NOT the App Store listing slug. The listing
  // lives at apps.shopify.com/sillages, but the installed app is addressed as
  // `sillages-1` — visible in a store's admin at
  // /settings/apps/app_installations/app/sillages-1.
  //
  // Getting this wrong is silent: /charges/<handle>/pricing_plans redirects to
  // Settings > Apps instead of erroring, so the merchant lands on a list of
  // apps with no explanation and no way to choose a plan.
  return process.env.SHOPIFY_APP_HANDLE || 'sillages-1';
}

/** `shop.myshopify.com` -> `shop`, which is what admin URLs use. */
export function storeHandle(shopDomain: string): string {
  return String(shopDomain).replace(/\.myshopify\.com$/i, '');
}

/**
 * Where a merchant chooses a plan.
 *
 * The app is on Shopify App Pricing: Shopify owns the subscription, and
 * `appSubscriptionCreate` is refused outright with "Cannot use the Billing API
 * (to create charges) when on Shopify App Pricing." So the product does not
 * create charges at all — it sends the merchant to the page Shopify hosts, and
 * learns the outcome from Shopify afterwards.
 */
export function managedPricingUrl(shopDomain: string): string {
  return `https://admin.shopify.com/store/${storeHandle(shopDomain)}/charges/${appHandle()}/pricing_plans`;
}

/**
 * Answers "where do I send this merchant to subscribe?".
 *
 * Validates the plan first so the UI cannot send someone to pay for Pro while
 * it is still coming soon.
 */
export function startSubscription(shopDomain: string, planId: unknown): StartSubscriptionResult {
  if (!isSocialGalleryPlanId(String(planId))) {
    return { ok: false, status: 400, reason: 'unknown_plan', message: 'Choose Basic.' };
  }

  const plan: SocialGalleryPlan = SOCIAL_GALLERY_PLANS[String(planId) as SocialGalleryPlanId];

  if (plan.status !== 'available' || plan.priceUsd === null) {
    return { ok: false, status: 400, reason: 'plan_not_available', message: `${plan.name} is not available yet.` };
  }

  return { ok: true, pricingPageUrl: managedPricingUrl(shopDomain), planId: plan.id };
}

export interface ActiveSubscription {
  id: string;
  name: string;
  status: string;
  test: boolean;
  trialDays: number;
  createdAt: string;
  currentPeriodEnd: string | null;
  planId: SocialGalleryPlanId | null;
}

/** What Shopify says the merchant is actually paying for, not what we recorded. */
export async function readSubscription(
  shopDomain: string,
  accessToken: string,
  deps: BillingDeps = {},
): Promise<ActiveSubscription | null> {
  const client = (deps.createClient ?? createCatalogClient)(shopDomain, accessToken);

  const data = await client.request<{
    currentAppInstallation: {
      activeSubscriptions: {
        id: string; name: string; status: string; test: boolean;
        trialDays: number; createdAt: string; currentPeriodEnd: string | null;
      }[];
    } | null;
  }>(CURRENT_SUBSCRIPTIONS);

  const active = data.currentAppInstallation?.activeSubscriptions?.[0];
  if (!active) return null;

  return { ...active, planId: planIdFromName(active.name) };
}

export async function cancelSubscription(
  shopDomain: string,
  accessToken: string,
  subscriptionId: string,
  deps: BillingDeps = {},
): Promise<boolean> {
  const client = (deps.createClient ?? createCatalogClient)(shopDomain, accessToken);
  const data = await client.request<{
    appSubscriptionCancel: { userErrors: { message: string }[] };
  }>(CANCEL_SUBSCRIPTION, { id: subscriptionId });

  return data.appSubscriptionCancel.userErrors.length === 0;
}

/**
 * Maps what Shopify calls the plan back to our plan id.
 *
 * Covers both shapes: "Sillages Growth", the name the old Billing API charges
 * were created with, and "Growth" or "growth", the display name and handle a
 * Shopify App Pricing plan carries.
 *
 * Reads EVERY plan, not only the ones on sale. Recognising a subscription and
 * selling one are different questions: Shopify can report a plan we have
 * withdrawn — a merchant on the old $79 Growth charge, say — and answering
 * `null` for them would drop a paying shop to "no plan". Whether a plan can be
 * *started* is decided by `startSubscription`, which requires
 * `status: 'available'`.
 */
export function planIdFromName(name: string): SocialGalleryPlanId | null {
  const normalised = String(name ?? '').trim().toLowerCase();
  if (!normalised) return null;
  for (const plan of getAllSocialGalleryPlans()) {
    if (normalised === plan.id) return plan.id;
    if (normalised.includes(plan.name.toLowerCase())) return plan.id;
  }
  return null;
}

/**
 * The plan handle Shopify puts on the welcome link.
 *
 * Only ever a hint: the merchant controls the URL they come back on, so it is
 * never trusted on its own. `confirmSubscription` asks Shopify what the shop is
 * actually on and that answer wins.
 */
export function planIdFromHandle(handle: unknown): SocialGalleryPlanId | null {
  return planIdFromName(typeof handle === 'string' ? handle : '');
}
