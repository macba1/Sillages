/**
 * Sprint 1 — catalogue webhooks.
 *
 * Acceptance criteria covered here:
 *   A3 a price, photo, variant or inventory change is applied immediately
 *   A4 creates, updates and deletes are idempotent (a redelivery is a no-op)
 *   A7 legacy topics are not processed in social_gallery mode
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PRODUCT_MODE: 'social_gallery',
    SHOPIFY_APP_URL: 'https://example.test',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
  },
}));
vi.mock('../lib/supabase.js', () => ({ supabase: { from: () => { throw new Error('no db in tests'); } } }));

import { createCatalogClient } from '../lib/shopifyCatalog.js';
import { handleCatalogWebhook } from '../services/catalog/catalogWebhooks.js';
import { dispatchSocialGalleryWebhook } from '../services/catalog/catalogWebhookRouter.js';
import { runCatalogSync } from '../services/catalog/catalogSync.js';
import type { ShopContext } from '../services/catalog/catalogStore.js';
import { MemoryCatalogStore } from './helpers/memoryCatalogStore.js';
import { FakeShopifyShop, makeDevStore, makeProduct } from './helpers/fakeShopify.js';

const CTX: ShopContext = {
  accountId: 'account-dev',
  connectionId: 'connection-dev',
  shopDomain: 'dev-store.myshopify.com',
};
const RESOLVED = { ...CTX, accessToken: 'dev-token' };

let store: MemoryCatalogStore;
let shop: FakeShopifyShop;

function deps(overrides: Record<string, unknown> = {}) {
  return {
    store,
    resolveShop: async (domain: string) => (domain === CTX.shopDomain ? RESOLVED : null),
    createClient: (domain: string, token: string) =>
      createCatalogClient(domain, token, { transport: shop.transport, sleep: async () => {} }),
    now: () => new Date('2026-09-04T12:00:00Z'),
    ...overrides,
  };
}

/** Seeds the store from the fake shop so webhooks act on an existing catalogue. */
async function seedCatalogue() {
  await runCatalogSync(CTX, 'dev-token', 'install', {
    store,
    now: () => new Date('2026-09-04T09:00:00Z'),
    createClient: (domain: string, token: string) =>
      createCatalogClient(domain, token, { transport: shop.transport, sleep: async () => {} }),
  });
}

beforeEach(() => {
  store = new MemoryCatalogStore();
  shop = makeDevStore(5);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('A3: product changes are applied as soon as the webhook arrives', () => {
  it('applies a price change from products/update', async () => {
    await seedCatalogue();
    const product = [...shop.products.values()][0];
    product.variants[0].price = '77.50';

    const outcome = await handleCatalogWebhook(
      'products/update',
      CTX.shopDomain,
      { admin_graphql_api_id: product.id },
      deps(),
    );

    expect(outcome).toEqual({ handled: true, action: 'upserted', detail: product.id });
    expect(store.variants.find((v) => v.shopifyId === product.variants[0].id)?.price).toBe('77.50');
  });

  it('applies a new photo from products/update', async () => {
    await seedCatalogue();
    const product = [...shop.products.values()][0];
    product.images.push({ id: `${product.id}-img-new`, url: 'https://cdn.example/new.jpg', altText: 'new' });

    await handleCatalogWebhook('products/update', CTX.shopDomain, { admin_graphql_api_id: product.id }, deps());

    expect(store.liveImages(CTX.connectionId).some((i) => i.url === 'https://cdn.example/new.jpg')).toBe(true);
  });

  it('applies a new variant, and removes one that disappeared', async () => {
    await seedCatalogue();
    const product = [...shop.products.values()][0];
    const removedVariantId = product.variants[1].id;
    product.variants = [
      product.variants[0],
      {
        id: `${product.id}-v-new`,
        title: 'Size XL',
        sku: 'DEV-NEW',
        price: '31.00',
        compareAtPrice: null,
        availableForSale: true,
        inventoryQuantity: 4,
        inventoryItemId: `${product.id}-inv-new`,
        imageId: null,
      },
    ];

    await handleCatalogWebhook('products/update', CTX.shopDomain, { admin_graphql_api_id: product.id }, deps());

    const live = store.liveVariants(CTX.connectionId).map((v) => v.shopifyId);
    expect(live).toContain(`${product.id}-v-new`);
    expect(live).not.toContain(removedVariantId);
  });

  it('adds a brand new product from products/create', async () => {
    await seedCatalogue();
    const created = makeProduct(999);
    shop.addProduct(created);

    await handleCatalogWebhook('products/create', CTX.shopDomain, { admin_graphql_api_id: created.id }, deps());

    expect(await store.countProducts(CTX.connectionId)).toBe(6);
  });

  it('takes inventory from Shopify totals, not from the one location that changed', async () => {
    // Shopify fires this webhook per location. Writing that one location's
    // count as the variant's total marked multi-location products Sold out
    // while they were still buyable, so the handler re-reads the product.
    await seedCatalogue();
    const product = [...shop.products.values()][0];
    const inventoryItemId = product.variants[0].inventoryItemId;

    // The shop's real total for this variant, across every location.
    product.variants[0].inventoryQuantity = 42;
    product.variants[0].availableForSale = true;

    const outcome = await handleCatalogWebhook(
      'inventory_levels/update',
      CTX.shopDomain,
      // The webhook only knows about the warehouse, which is empty.
      { inventory_item_id: inventoryItemId, available: 0 },
      deps(),
    );

    expect(outcome).toEqual({ handled: true, action: 'inventory_updated', detail: inventoryItemId });
    const variant = store.variants.find((v) => v.inventoryItemId === inventoryItemId);
    expect(variant?.inventoryQuantity).toBe(42);
    expect(variant?.availableForSale).toBe(true);
  });

  it('marks a variant unavailable when Shopify says it is genuinely out of stock', async () => {
    await seedCatalogue();
    const product = [...shop.products.values()][0];
    const inventoryItemId = product.variants[0].inventoryItemId;

    product.variants[0].inventoryQuantity = 0;
    product.variants[0].availableForSale = false;

    await handleCatalogWebhook(
      'inventory_levels/update',
      CTX.shopDomain,
      { inventory_item_id: inventoryItemId, available: 0 },
      deps(),
    );

    const variant = store.variants.find((v) => v.inventoryItemId === inventoryItemId);
    expect(variant?.inventoryQuantity).toBe(0);
    expect(variant?.availableForSale).toBe(false);
  });

  it('falls back to the reported figure when the product cannot be re-read', async () => {
    await seedCatalogue();
    const product = [...shop.products.values()][0];
    const inventoryItemId = product.variants[0].inventoryItemId;
    shop.removeProduct(product.id);

    const outcome = await handleCatalogWebhook(
      'inventory_levels/update',
      CTX.shopDomain,
      { inventory_item_id: inventoryItemId, available: 5 },
      deps(),
    );

    expect(outcome.handled).toBe(true);
    expect(store.variants.find((v) => v.inventoryItemId === inventoryItemId)?.inventoryQuantity).toBe(5);
  });

  it('updates a collection and its membership', async () => {
    await seedCatalogue();
    const productIds = [...shop.products.keys()].slice(0, 3);
    shop.addCollection({
      id: 'gid://shopify/Collection/77',
      title: 'New in',
      handle: 'new-in',
      updatedAt: '2026-09-04T11:00:00Z',
      productIds,
    });

    await handleCatalogWebhook(
      'collections/update',
      CTX.shopDomain,
      { admin_graphql_api_id: 'gid://shopify/Collection/77', title: 'New in', handle: 'new-in' },
      deps(),
    );

    const collections = await store.listCollections(CTX.connectionId);
    expect(collections.map((c) => c.title)).toContain('New in');
    expect(store.links).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('deletions', () => {
  it('soft-deletes on products/delete and keeps the row recoverable', async () => {
    await seedCatalogue();
    const product = [...shop.products.values()][0];

    const outcome = await handleCatalogWebhook(
      'products/delete',
      CTX.shopDomain,
      { admin_graphql_api_id: product.id },
      deps(),
    );

    expect(outcome).toEqual({ handled: true, action: 'deleted', detail: product.id });
    expect(await store.countProducts(CTX.connectionId)).toBe(4);
    expect(store.products.find((p) => p.shopifyId === product.id)?.deletedAt).not.toBeNull();
  });

  it('treats products/update for a product that no longer exists as a deletion', async () => {
    await seedCatalogue();
    const product = [...shop.products.values()][0];
    shop.removeProduct(product.id);

    const outcome = await handleCatalogWebhook(
      'products/update',
      CTX.shopDomain,
      { admin_graphql_api_id: product.id },
      deps(),
    );

    expect(outcome).toEqual({ handled: true, action: 'deleted', detail: product.id });
    expect(await store.countProducts(CTX.connectionId)).toBe(4);
  });

  it('soft-deletes on collections/delete', async () => {
    await seedCatalogue();
    shop.addCollection({
      id: 'gid://shopify/Collection/9',
      title: 'Old',
      handle: 'old',
      updatedAt: '2026-09-01T10:00:00Z',
      productIds: [],
    });
    await handleCatalogWebhook(
      'collections/update',
      CTX.shopDomain,
      { admin_graphql_api_id: 'gid://shopify/Collection/9', title: 'Old', handle: 'old' },
      deps(),
    );
    expect(await store.listCollections(CTX.connectionId)).toHaveLength(1);

    await handleCatalogWebhook(
      'collections/delete',
      CTX.shopDomain,
      { admin_graphql_api_id: 'gid://shopify/Collection/9' },
      deps(),
    );

    expect(await store.listCollections(CTX.connectionId)).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('A4: idempotency and defensive handling', () => {
  it('applying the same products/update twice leaves one row', async () => {
    await seedCatalogue();
    const product = [...shop.products.values()][0];
    product.variants[0].price = '55.00';

    await handleCatalogWebhook('products/update', CTX.shopDomain, { admin_graphql_api_id: product.id }, deps());
    const productRows = store.products.length;
    const variantRows = store.variants.length;

    await handleCatalogWebhook('products/update', CTX.shopDomain, { admin_graphql_api_id: product.id }, deps());

    expect(store.products.length).toBe(productRows);
    expect(store.variants.length).toBe(variantRows);
    expect(store.variants.find((v) => v.shopifyId === product.variants[0].id)?.price).toBe('55.00');
  });

  it('a redelivered webhook id is dropped before any handler runs', async () => {
    const seen = new Set<string>();
    const markProcessed = async (id: string) => {
      if (seen.has(id)) return true;
      seen.add(id);
      return false;
    };
    await seedCatalogue();
    const product = [...shop.products.values()][0];
    const payload = { admin_graphql_api_id: product.id };

    const first = await dispatchSocialGalleryWebhook(
      'products/delete', CTX.shopDomain, 'wh-1', payload, { ...deps(), markProcessed },
    );
    const second = await dispatchSocialGalleryWebhook(
      'products/delete', CTX.shopDomain, 'wh-1', payload, { ...deps(), markProcessed },
    );

    expect(first).toEqual({ status: 'processed', topic: 'products/delete' });
    expect(second).toEqual({ status: 'duplicate', topic: 'products/delete' });
  });

  it('accepts a numeric REST id and converts it to a GID', async () => {
    shop = new FakeShopifyShop();
    shop.addProduct({ ...makeProduct(1), id: 'gid://shopify/Product/12345' });
    await seedCatalogue();

    const outcome = await handleCatalogWebhook('products/delete', CTX.shopDomain, { id: 12345 }, deps());

    expect(outcome).toEqual({ handled: true, action: 'deleted', detail: 'gid://shopify/Product/12345' });
  });

  it('ignores a webhook for a shop we do not know', async () => {
    const outcome = await handleCatalogWebhook(
      'products/update',
      'someone-else.myshopify.com',
      { admin_graphql_api_id: 'gid://shopify/Product/1' },
      deps(),
    );
    expect(outcome).toEqual({ handled: false, reason: 'unknown_shop' });
  });

  it('rejects a malformed payload instead of writing junk', async () => {
    await seedCatalogue();
    expect(await handleCatalogWebhook('products/update', CTX.shopDomain, {}, deps()))
      .toEqual({ handled: false, reason: 'malformed' });
    expect(await handleCatalogWebhook('inventory_levels/update', CTX.shopDomain, { available: 'lots' }, deps()))
      .toEqual({ handled: false, reason: 'malformed' });
  });

  it('reports an inventory update for a variant we never imported', async () => {
    await seedCatalogue();
    const outcome = await handleCatalogWebhook(
      'inventory_levels/update',
      CTX.shopDomain,
      { inventory_item_id: 'gid://shopify/InventoryItem/unknown', available: 3 },
      deps(),
    );
    expect(outcome).toEqual({ handled: false, reason: 'not_found' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('A7: legacy topics in social_gallery mode', () => {
  it('ignores orders and checkouts instead of running legacy handlers', async () => {
    for (const topic of ['orders/create', 'checkouts/create', 'checkouts/update', 'app_subscriptions/update']) {
      const result = await dispatchSocialGalleryWebhook(topic, CTX.shopDomain, `wh-${topic}`, {}, {
        ...deps(),
        markProcessed: async () => false,
      });
      expect(result).toEqual({ status: 'ignored', topic, reason: 'legacy_topic' });
    }
  });

  it('still delegates app/uninstalled so uninstall keeps working', async () => {
    const handleAppUninstalled = vi.fn().mockResolvedValue(undefined);

    const result = await dispatchSocialGalleryWebhook('app/uninstalled', CTX.shopDomain, 'wh-uninstall', {}, {
      ...deps(),
      markProcessed: async () => false,
      handleAppUninstalled,
    });

    expect(result).toEqual({ status: 'processed', topic: 'app/uninstalled' });
    expect(handleAppUninstalled).toHaveBeenCalledWith(CTX.shopDomain);
  });
});
