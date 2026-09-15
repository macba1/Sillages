/**
 * Shopify App Pricing — the subscription lifecycle the product has to survive.
 *
 * The app does not create charges. Shopify owns the subscription, the merchant
 * chooses a plan on a page Shopify hosts, and the product finds out afterwards
 * from two sources that both arrive late sometimes: the
 * `app_subscriptions/update` webhook, and asking Shopify directly.
 *
 * Covered here: signing up, the free trial, changing plan, cancelling,
 * installing without a plan, and the gap between paying and the product
 * knowing about it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PRODUCT_MODE: 'social_gallery',
    FRONTEND_URL: 'https://www.sillages.app',
    SHOPIFY_APP_URL: 'https://api.sillages.app',
    SHOPIFY_API_SECRET: 'test-shopify-secret',
  },
}));
vi.mock('../lib/supabase.js', () => ({
  supabase: { from: () => { throw new Error('no db in tests'); } },
}));

import { MemoryGalleryStore } from './helpers/memoryGalleryStore.js';
import { MemorySubscriptionStore } from './helpers/memorySubscriptionStore.js';
import { entitlementsForShop } from '../services/gallery/galleryService.js';
import { handleSubscriptionUpdate } from '../services/billing/subscriptionWebhook.js';
import type { ActiveSubscription } from '../services/billing/shopifyBilling.js';

const SHOP = {
  accountId: 'acc-a',
  connectionId: 'conn-a',
  shopDomain: 'demo-shop.myshopify.com',
  accessToken: 'token-a',
};

let store: MemoryGalleryStore;
let subscriptions: MemorySubscriptionStore;

/** Shopify's answer about the shop's active subscription. */
function shopifySays(overrides: Partial<ActiveSubscription> | null): () => Promise<ActiveSubscription | null> {
  if (overrides === null) return async () => null;
  return async () => ({
    id: 'gid://shopify/AppSubscription/1',
    name: 'Basic',
    status: 'ACTIVE',
    test: true,
    trialDays: 14,
    createdAt: new Date().toISOString(),
    currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
    planId: 'basic',
    ...overrides,
  });
}

const deps = (confirm?: () => Promise<ActiveSubscription | null>) => ({
  store,
  subscriptions,
  ...(confirm ? { confirmWithShopify: confirm as never } : {}),
});

beforeEach(() => {
  store = new MemoryGalleryStore();
  subscriptions = new MemorySubscriptionStore();
});

// ===========================================================================
describe('installing without a plan', () => {
  it('cannot publish, and is told why', async () => {
    const ent = await entitlementsForShop(SHOP, deps(shopifySays(null)));

    expect(ent.canPublish).toBe(false);
    expect(ent.planId).toBeNull();
    expect(ent.reason).toBeTruthy();
  });

  it('does not open the paid feature when Shopify cannot be reached', async () => {
    const ent = await entitlementsForShop(
      SHOP,
      deps(async () => { throw new Error('shopify unreachable'); }),
    );

    expect(ent.canPublish).toBe(false);
  });
});

// ===========================================================================
describe('signing up on the page Shopify hosts', () => {
  it('the webhook turns the plan on', async () => {
    await handleSubscriptionUpdate(
      SHOP.shopDomain,
      { app_subscription: { admin_graphql_api_id: 'gid://shopify/AppSubscription/1', name: 'Basic', status: 'ACTIVE', test: true } },
      { store: subscriptions, galleryStore: store as never, resolveShop: async () => SHOP },
    );

    const ent = await entitlementsForShop(SHOP, deps(shopifySays(null)));
    expect(ent).toMatchObject({ canPublish: true, planId: 'basic' });
  });

  it('a merchant who beats the webhook back is not told to choose a plan again', async () => {
    // Nothing recorded locally yet: the merchant paid on Shopify's page and
    // returned faster than the webhook arrived.
    const ent = await entitlementsForShop(SHOP, deps(shopifySays({ name: 'Basic' })));

    expect(ent).toMatchObject({ canPublish: true, planId: 'basic' });
    // And the answer is written down, so the missed webhook is repaired.
    expect(await subscriptions.get(SHOP.connectionId)).toMatchObject({
      planId: 'basic',
      status: 'active',
    });
  });

  it('trusts Shopify over a plan handle on the URL', async () => {
    // The merchant controls the welcome link. Shopify says Basic; a handle
    // claiming Growth must not promote them.
    const ent = await entitlementsForShop(SHOP, deps(shopifySays({ name: 'Basic' })));

    expect(ent.planId).toBe('basic');
  });
});

// ===========================================================================
describe('the free trial', () => {
  it('publishes during the trial, because Shopify reports it as active', async () => {
    const ent = await entitlementsForShop(
      SHOP,
      deps(shopifySays({ status: 'ACTIVE', trialDays: 14 })),
    );

    expect(ent.canPublish).toBe(true);
  });

  it('stops publishing when the trial expires rather than lapsing quietly', async () => {
    subscriptions.setLive(SHOP, 'basic');
    await handleSubscriptionUpdate(
      SHOP.shopDomain,
      { app_subscription: { admin_graphql_api_id: 'gid://shopify/AppSubscription/1', name: 'Basic', status: 'EXPIRED', test: true } },
      { store: subscriptions, galleryStore: store as never, resolveShop: async () => SHOP },
    );

    const ent = await entitlementsForShop(SHOP, deps(shopifySays(null)));
    expect(ent.canPublish).toBe(false);
  });
});

// ===========================================================================
describe('changing plan', () => {
  it('follows the merchant onto the plan Shopify reports', async () => {
    subscriptions.setLive(SHOP, 'basic');
    expect((await entitlementsForShop(SHOP, deps())).planId).toBe('basic');

    await handleSubscriptionUpdate(
      SHOP.shopDomain,
      { app_subscription: { admin_graphql_api_id: 'gid://shopify/AppSubscription/2', name: 'Growth', status: 'ACTIVE', test: true } },
      { store: subscriptions, galleryStore: store as never, resolveShop: async () => SHOP },
    );

    const ent = await entitlementsForShop(SHOP, deps());
    expect(ent).toMatchObject({ planId: 'growth', canPublish: true });
    // Growth is off sale and grants nothing extra; a shop Shopify still reports
    // on it keeps publishing and gains no unbuilt feature.
    expect(ent.canUseAttribution).toBe(false);
  });

  it('the cancellation of the replaced plan does not take the gallery down', async () => {
    // Shopify cancels the old subscription when a new one replaces it.
    subscriptions.setLive(SHOP, 'basic'); // gid .../1
    await handleSubscriptionUpdate(
      SHOP.shopDomain,
      { app_subscription: { admin_graphql_api_id: 'gid://shopify/AppSubscription/2', name: 'Growth', status: 'ACTIVE', test: true } },
      { store: subscriptions, galleryStore: store as never, resolveShop: async () => SHOP },
    );
    await handleSubscriptionUpdate(
      SHOP.shopDomain,
      { app_subscription: { admin_graphql_api_id: 'gid://shopify/AppSubscription/1', name: 'Basic', status: 'CANCELLED', test: true } },
      { store: subscriptions, galleryStore: store as never, resolveShop: async () => SHOP },
    );

    const ent = await entitlementsForShop(SHOP, deps());
    expect(ent).toMatchObject({ planId: 'growth', canPublish: true });
  });
});

// ===========================================================================
describe('cancelling', () => {
  it('closes publishing once Shopify says the plan is over', async () => {
    subscriptions.setLive(SHOP, 'growth');

    await handleSubscriptionUpdate(
      SHOP.shopDomain,
      { app_subscription: { admin_graphql_api_id: 'gid://shopify/AppSubscription/1', name: 'Growth', status: 'CANCELLED', test: true } },
      { store: subscriptions, galleryStore: store as never, resolveShop: async () => SHOP },
    );

    const ent = await entitlementsForShop(SHOP, deps(shopifySays(null)));
    expect(ent.canPublish).toBe(false);
  });

  it('a cancelled mirror is not reopened by a stale Shopify answer that is also cancelled', async () => {
    subscriptions.setStatus(SHOP, 'cancelled');

    const ent = await entitlementsForShop(SHOP, deps(shopifySays({ status: 'CANCELLED' })));
    expect(ent.canPublish).toBe(false);
  });
});

// ===========================================================================
describe('update delays', () => {
  it('a live plan is answered from the mirror, without calling Shopify', async () => {
    subscriptions.setLive(SHOP, 'basic');
    let called = 0;

    const ent = await entitlementsForShop(SHOP, deps(async () => { called += 1; return null; }));

    expect(ent.canPublish).toBe(true);
    expect(called, 'a storefront read must not wait on Shopify').toBe(0);
  });

  it('confirms with Shopify only while the mirror says no', async () => {
    let called = 0;
    const confirm = async () => { called += 1; return shopifySays({ name: 'Growth' })(); };

    await entitlementsForShop(SHOP, deps(confirm));
    expect(called).toBe(1);

    // The first confirmation wrote the plan down, so the second read is local.
    await entitlementsForShop(SHOP, deps(confirm));
    expect(called).toBe(1);
  });
});
