import { resolveShopByDomain } from '../catalog/catalogContext.js';
import { supabaseGalleryStore, type GalleryStore } from '../gallery/galleryStore.js';
import { planIdFromName } from './shopifyBilling.js';
import {
  entitlementsFor,
  supabaseSubscriptionStore,
  type SubscriptionStatus,
  type SubscriptionStore,
} from './entitlements.js';

const LOG = '[subscription]';

/**
 * Applies an `app_subscriptions/update` webhook.
 *
 * Shopify sends this whenever a subscription changes: approved, declined,
 * frozen for non-payment, cancelled, or expired. Recording it is only half the
 * job — the other half is that losing a plan has to actually take the paid
 * feature away, which for this product means the published gallery stops being
 * served.
 */

const STATUS_MAP: Record<string, SubscriptionStatus> = {
  ACTIVE: 'active',
  PENDING: 'pending',
  DECLINED: 'declined',
  EXPIRED: 'expired',
  FROZEN: 'frozen',
  CANCELLED: 'cancelled',
};

export interface SubscriptionWebhookDeps {
  store?: SubscriptionStore;
  galleryStore?: GalleryStore;
  resolveShop?: typeof resolveShopByDomain;
  now?: () => number;
}

export type SubscriptionWebhookOutcome =
  | { handled: true; status: SubscriptionStatus; galleryDisabled: boolean }
  | { handled: false; reason: 'unknown_shop' | 'malformed' };

export async function handleSubscriptionUpdate(
  shopDomain: string,
  payload: Record<string, unknown>,
  deps: SubscriptionWebhookDeps = {},
): Promise<SubscriptionWebhookOutcome> {
  const store = deps.store ?? supabaseSubscriptionStore;
  const galleryStore = deps.galleryStore ?? supabaseGalleryStore;
  const resolveShop = deps.resolveShop ?? resolveShopByDomain;
  const now = deps.now ?? Date.now;

  const raw = (payload.app_subscription ?? payload) as Record<string, unknown>;
  const shopifyStatus = String(raw.status ?? '').toUpperCase();
  const status = STATUS_MAP[shopifyStatus];
  if (!status) return { handled: false, reason: 'malformed' };

  const shop = await resolveShop(shopDomain);
  if (!shop) return { handled: false, reason: 'unknown_shop' };

  const subscription = {
    connectionId: shop.connectionId,
    accountId: shop.accountId,
    shopifyGid: typeof raw.admin_graphql_api_id === 'string' ? raw.admin_graphql_api_id : null,
    planId: planIdFromName(String(raw.name ?? '')),
    status,
    // Shopify marks test charges explicitly. Trusting a test charge in
    // production would let anyone unlock a paid plan for free.
    isTest: raw.test === true,
    trialEndsAt: typeof raw.trial_ends_on === 'string' ? raw.trial_ends_on : null,
    currentPeriodEnd: typeof raw.current_period_end === 'string' ? raw.current_period_end : null,
  };

  await store.upsert(subscription);

  // The part that matters: if the shop may no longer publish, stop serving.
  const entitlements = entitlementsFor(subscription, now);
  let galleryDisabled = false;

  if (!entitlements.canPublish) {
    const config = await galleryStore.getByConnection(shop.connectionId);
    if (config && config.status === 'published') {
      await galleryStore.setStatus(config.id, 'disabled');
      galleryDisabled = true;
      console.log(`${LOG} ${shopDomain}: plan ${status} — gallery disabled`);
    }
  }

  console.log(`${LOG} ${shopDomain}: ${status}${subscription.isTest ? ' (test)' : ''}`);
  return { handled: true, status, galleryDisabled };
}
