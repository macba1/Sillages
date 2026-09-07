/**
 * Plan enforcement.
 *
 * Publishing is the paid feature. Before this, `app_subscriptions/update` was
 * never registered and nothing consulted a plan, so a cancellation, a declined
 * payment or an expired trial changed nothing: the gallery kept serving and the
 * merchant kept every premium feature indefinitely.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PRODUCT_MODE: 'social_gallery',
    SHOPIFY_APP_URL: 'https://example.test',
    SHOPIFY_API_SECRET: 'test-shopify-secret',
  },
}));
vi.mock('../lib/supabase.js', () => ({ supabase: { from: () => { throw new Error('no db in tests'); } } }));

import { entitlementsFor, NO_SUBSCRIPTION, type ShopSubscription } from '../services/billing/entitlements.js';
import { handleSubscriptionUpdate } from '../services/billing/subscriptionWebhook.js';
import { composePublicGallery, publishGallery, saveGallery } from '../services/gallery/galleryService.js';
import { SOCIAL_GALLERY_WEBHOOK_TOPICS } from '../services/catalog/catalogWebhookSetup.js';
import { MemoryGalleryStore } from './helpers/memoryGalleryStore.js';
import { MemorySubscriptionStore } from './helpers/memorySubscriptionStore.js';
import type { ShopContext } from '../services/catalog/catalogStore.js';

const SHOP: ShopContext = { accountId: 'acc-a', connectionId: 'conn-a', shopDomain: 'alpha.myshopify.com' };
const RESOLVED = { ...SHOP, accessToken: 'token' };

let store: MemoryGalleryStore;
let subscriptions: MemorySubscriptionStore;

const deps = () => ({ store, subscriptions });

function live(overrides: Partial<ShopSubscription> = {}): ShopSubscription {
  return {
    connectionId: SHOP.connectionId,
    accountId: SHOP.accountId,
    shopifyGid: 'gid://shopify/AppSubscription/1',
    planId: 'basic',
    status: 'active',
    isTest: false,
    trialEndsAt: null,
    currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  delete process.env.SHOPIFY_BILLING_LIVE;
  store = new MemoryGalleryStore();
  store.seedShop(SHOP, { products: 5, collections: 1 });
  subscriptions = new MemorySubscriptionStore();
});

afterEach(() => {
  delete process.env.SHOPIFY_BILLING_LIVE;
});

// ===========================================================================
describe('entitlements are closed by default', () => {
  it('grants nothing without a subscription', () => {
    const none = entitlementsFor(null);
    expect(none.canPublish).toBe(false);
    expect(none.canUseAttribution).toBe(false);
    expect(none.reason).toMatch(/Choose a plan/);
    expect(entitlementsFor(NO_SUBSCRIPTION).canPublish).toBe(false);
  });

  it('revokes access for every status that means the plan is over', () => {
    for (const status of ['declined', 'expired', 'frozen', 'cancelled', 'none'] as const) {
      const result = entitlementsFor(live({ status }));
      expect(result.canPublish, status).toBe(false);
      expect(result.reason, status).toBeTruthy();
    }
  });

  it('does not grant access while a subscription is still pending approval', () => {
    expect(entitlementsFor(live({ status: 'pending' })).canPublish).toBe(false);
  });

  it('grants access to an active plan', () => {
    const result = entitlementsFor(live());
    expect(result.canPublish).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('reserves Growth features for Growth', () => {
    expect(entitlementsFor(live({ planId: 'basic' })).canUseAttribution).toBe(false);
    expect(entitlementsFor(live({ planId: 'growth' })).canUseAttribution).toBe(true);
    expect(entitlementsFor(live({ planId: 'growth' })).canUseMultipleGalleries).toBe(true);
  });

  it('revokes access once the billing period has passed', () => {
    const lapsed = live({ currentPeriodEnd: new Date(Date.now() - 1000).toISOString() });
    expect(entitlementsFor(lapsed).canPublish).toBe(false);
  });

  it('lets a test charge unlock features in development but never in production', () => {
    // A test charge is how the flow is exercised before launch.
    expect(entitlementsFor(live({ isTest: true })).canPublish).toBe(true);

    // Once billing is live, a charge nobody pays must unlock nothing.
    process.env.SHOPIFY_BILLING_LIVE = 'true';
    const result = entitlementsFor(live({ isTest: true }));
    expect(result.canPublish).toBe(false);
    expect(result.reason).toMatch(/test charge/i);
  });
});

// ===========================================================================
describe('a shop without a plan cannot publish', () => {
  it('refuses to publish, and says what to do', async () => {
    await saveGallery(SHOP, {}, deps());

    const result = await publishGallery(SHOP, deps());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_plan');
    expect(result.message).toMatch(/Choose a plan/);
    expect((await composePublicGallery(SHOP.shopDomain, deps())).active).toBe(false);
  });

  it('publishes once a plan is live', async () => {
    subscriptions.setLive(SHOP, 'basic');
    await saveGallery(SHOP, {}, deps());

    const result = await publishGallery(SHOP, deps());

    expect(result.ok).toBe(true);
    expect((await composePublicGallery(SHOP.shopDomain, deps())).active).toBe(true);
  });
});

// ===========================================================================
describe('losing the plan takes the feature away', () => {
  it('stops serving a gallery that was published while the plan was live', async () => {
    subscriptions.setLive(SHOP, 'basic');
    await saveGallery(SHOP, {}, deps());
    await publishGallery(SHOP, deps());
    expect((await composePublicGallery(SHOP.shopDomain, deps())).active).toBe(true);

    // The merchant cancels in their Shopify admin.
    subscriptions.setStatus(SHOP, 'cancelled');

    // The storefront stops being served even before any webhook arrives: the
    // check is closed by default rather than relying on a delivery.
    const after = await composePublicGallery(SHOP.shopDomain, deps());
    expect(after.active).toBe(false);
    expect(after.posts).toEqual([]);
    expect(after.ingestToken).toBeNull();
  });

  it('disables the gallery when the cancellation webhook arrives', async () => {
    subscriptions.setLive(SHOP, 'basic');
    await saveGallery(SHOP, {}, deps());
    await publishGallery(SHOP, deps());

    const outcome = await handleSubscriptionUpdate(
      SHOP.shopDomain,
      { app_subscription: { admin_graphql_api_id: 'gid://shopify/AppSubscription/1', name: 'Sillages Basic', status: 'CANCELLED', test: false } },
      { store: subscriptions, galleryStore: store, resolveShop: async () => RESOLVED },
    );

    expect(outcome).toEqual({ handled: true, status: 'cancelled', galleryDisabled: true });
    expect((await store.getByConnection(SHOP.connectionId))?.status).toBe('disabled');
  });

  it('records every status Shopify can send', async () => {
    for (const [shopify, expected] of [
      ['ACTIVE', 'active'], ['PENDING', 'pending'], ['DECLINED', 'declined'],
      ['EXPIRED', 'expired'], ['FROZEN', 'frozen'], ['CANCELLED', 'cancelled'],
    ] as const) {
      const outcome = await handleSubscriptionUpdate(
        SHOP.shopDomain,
        { app_subscription: { name: 'Sillages Growth', status: shopify, test: false } },
        { store: subscriptions, galleryStore: store, resolveShop: async () => RESOLVED },
      );
      expect(outcome, shopify).toMatchObject({ handled: true, status: expected });
    }
  });

  it('does not disable a gallery when the plan is renewed', async () => {
    subscriptions.setLive(SHOP, 'basic');
    await saveGallery(SHOP, {}, deps());
    await publishGallery(SHOP, deps());

    const outcome = await handleSubscriptionUpdate(
      SHOP.shopDomain,
      { app_subscription: { name: 'Sillages Basic', status: 'ACTIVE', test: false, current_period_end: new Date(Date.now() + 30 * 86400000).toISOString() } },
      { store: subscriptions, galleryStore: store, resolveShop: async () => RESOLVED },
    );

    expect(outcome).toMatchObject({ handled: true, galleryDisabled: false });
    expect((await store.getByConnection(SHOP.connectionId))?.status).toBe('published');
  });

  it('ignores a webhook for an unknown shop or an unrecognised status', async () => {
    expect(
      await handleSubscriptionUpdate('stranger.myshopify.com', { app_subscription: { status: 'ACTIVE' } }, {
        store: subscriptions, galleryStore: store, resolveShop: async () => null,
      }),
    ).toEqual({ handled: false, reason: 'unknown_shop' });

    expect(
      await handleSubscriptionUpdate(SHOP.shopDomain, { app_subscription: { status: 'WHATEVER' } }, {
        store: subscriptions, galleryStore: store, resolveShop: async () => RESOLVED,
      }),
    ).toEqual({ handled: false, reason: 'malformed' });
  });
});

// ===========================================================================
describe('the topic is actually registered', () => {
  it('app_subscriptions/update is among the topics we ask Shopify for', () => {
    // Everything above is dead code if Shopify never sends the webhook.
    expect(SOCIAL_GALLERY_WEBHOOK_TOPICS).toContain('app_subscriptions/update');
    expect(SOCIAL_GALLERY_WEBHOOK_TOPICS).toContain('app/uninstalled');
  });
});
