import { env } from '../../config/env.js';
import { createCatalogClient, type CatalogClient } from '../../lib/shopifyCatalog.js';
import {
  SOCIAL_GALLERY_PLANS,
  getAvailableSocialGalleryPlans,
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

const CREATE_SUBSCRIPTION = `
  mutation SillagesSubscriptionCreate(
    $name: String!
    $returnUrl: URL!
    $trialDays: Int!
    $test: Boolean!
    $amount: Decimal!
    $currencyCode: CurrencyCode!
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      trialDays: $trialDays
      test: $test
      lineItems: [{
        plan: {
          appRecurringPricingDetails: {
            price: { amount: $amount, currencyCode: $currencyCode }
            interval: EVERY_30_DAYS
          }
        }
      }]
    ) {
      confirmationUrl
      appSubscription { id status }
      userErrors { field message }
    }
  }
`;

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
  | { ok: true; confirmationUrl: string; test: boolean; planId: SocialGalleryPlanId }
  | { ok: false; status: 400 | 502; reason: string; message: string };

/**
 * Starts a subscription and returns the URL where the merchant approves it.
 * Nothing is charged until they approve, and in test mode nothing is charged at
 * all.
 */
export async function startSubscription(
  shopDomain: string,
  accessToken: string,
  planId: unknown,
  deps: BillingDeps = {},
): Promise<StartSubscriptionResult> {
  if (!isSocialGalleryPlanId(String(planId))) {
    return { ok: false, status: 400, reason: 'unknown_plan', message: 'Choose Basic or Growth.' };
  }

  const plan: SocialGalleryPlan = SOCIAL_GALLERY_PLANS[String(planId) as SocialGalleryPlanId];

  // A plan that is not on sale cannot be subscribed to, whatever the client sent.
  if (plan.status !== 'available' || plan.priceUsd === null) {
    return { ok: false, status: 400, reason: 'plan_not_available', message: `${plan.name} is not available yet.` };
  }

  const test = !isLiveBilling();
  const client = (deps.createClient ?? createCatalogClient)(shopDomain, accessToken);

  try {
    const data = await client.request<{
      appSubscriptionCreate: {
        confirmationUrl: string | null;
        appSubscription: { id: string; status: string } | null;
        userErrors: { field: string[] | null; message: string }[];
      };
    }>(CREATE_SUBSCRIPTION, {
      name: `Sillages ${plan.name}`,
      returnUrl: `${env.SHOPIFY_APP_URL.replace(/\/+$/, '')}/api/subscription/callback?shop=${encodeURIComponent(shopDomain)}&plan=${plan.id}`,
      trialDays: plan.trialDays,
      test,
      amount: plan.priceUsd.toFixed(2),
      currencyCode: plan.currency,
    });

    const errors = data.appSubscriptionCreate.userErrors;
    if (errors.length > 0) {
      return {
        ok: false,
        status: 502,
        reason: 'shopify_rejected',
        message: errors.map((e) => e.message).join('; '),
      };
    }

    const confirmationUrl = data.appSubscriptionCreate.confirmationUrl;
    if (!confirmationUrl) {
      return { ok: false, status: 502, reason: 'no_confirmation_url', message: 'Shopify did not return an approval link.' };
    }

    console.log(`${LOG} ${shopDomain}: started ${plan.id}${test ? ' (test charge)' : ''}`);
    return { ok: true, confirmationUrl, test, planId: plan.id };
  } catch (err) {
    return { ok: false, status: 502, reason: 'shopify_unreachable', message: (err as Error).message };
  }
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

/** Maps "Sillages Growth" back to the plan id, so the UI can highlight it. */
export function planIdFromName(name: string): SocialGalleryPlanId | null {
  const normalised = String(name ?? '').toLowerCase();
  for (const plan of getAvailableSocialGalleryPlans()) {
    if (normalised.includes(plan.name.toLowerCase())) return plan.id;
  }
  return null;
}
