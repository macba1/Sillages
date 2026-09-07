/**
 * Sprint 1 — live catalogue synchronisation.
 *
 * Runs the real sync code against an in-memory Shopify GraphQL double and an
 * in-memory store that mirrors the SQL semantics of the Supabase one. No
 * network, no credentials, no production data.
 *
 * Acceptance criteria covered here:
 *   A1 a store with more than 50 products imports completely
 *   A2 pagination is fully drained, including nested connections
 *   A4 re-running a sync is idempotent
 *   A5 reconciliation repairs what a lost webhook would have missed
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createCatalogClient } from '../lib/shopifyCatalog.js';
import { runCatalogSync } from '../services/catalog/catalogSync.js';
import type { ShopContext } from '../services/catalog/catalogStore.js';
import { MemoryCatalogStore } from './helpers/memoryCatalogStore.js';
import { FakeShopifyShop, makeDevStore, makeProduct } from './helpers/fakeShopify.js';

const CTX: ShopContext = {
  accountId: 'account-dev',
  connectionId: 'connection-dev',
  shopDomain: 'dev-store.myshopify.com',
};

/** Distinct, increasing timestamps so `lastSeenAt` comparisons are meaningful. */
function clock(startMs = Date.parse('2026-09-04T09:00:00Z')) {
  let tick = 0;
  return () => new Date(startMs + tick++ * 60_000);
}

function depsFor(shop: FakeShopifyShop, store: MemoryCatalogStore, now = clock()) {
  return {
    store,
    now,
    createClient: (domain: string, token: string) =>
      createCatalogClient(domain, token, { transport: shop.transport, sleep: async () => {} }),
  };
}

let store: MemoryCatalogStore;

beforeEach(() => {
  store = new MemoryCatalogStore();
});

// ═══════════════════════════════════════════════════════════════════════════
describe('A1 + A2: a development store with more than 50 products imports completely', () => {
  it('imports all 137 products, their variants and their images across every page', async () => {
    const shop = makeDevStore(137);

    const outcome = await runCatalogSync(CTX, 'dev-token', 'install', depsFor(shop, store));

    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') return;

    expect(outcome.counts.productsSeen).toBe(137);
    expect(outcome.counts.productsUpserted).toBe(137);
    expect(store.liveProducts(CTX.connectionId)).toHaveLength(137);

    // 2 variants and 2 images per fixture product.
    expect(store.liveVariants(CTX.connectionId)).toHaveLength(137 * 2);
    expect(store.liveImages(CTX.connectionId)).toHaveLength(137 * 2);

    // Nothing was invented and nothing was lost.
    const storedIds = new Set(store.liveProducts(CTX.connectionId).map((p) => p.shopifyId));
    for (const id of shop.products.keys()) {
      expect(storedIds.has(id)).toBe(true);
    }
    expect(storedIds.size).toBe(shop.products.size);
  });

  it('requests every page instead of stopping at the first', async () => {
    const shop = makeDevStore(137);

    await runCatalogSync(CTX, 'dev-token', 'install', depsFor(shop, store));

    // 137 products at 50 per page = 3 pages.
    const productPageCalls = shop.calls.filter((c) => c === 'CatalogProducts').length;
    expect(productPageCalls).toBe(3);
  });

  it('drains nested pages when one product has more variants and images than fit in a page', async () => {
    const shop = new FakeShopifyShop();
    shop.addProduct(makeProduct(1, { variants: 150, images: 130 }));

    await runCatalogSync(CTX, 'dev-token', 'install', depsFor(shop, store));

    expect(store.liveVariants(CTX.connectionId)).toHaveLength(150);
    expect(store.liveImages(CTX.connectionId)).toHaveLength(130);
    expect(shop.calls).toContain('CatalogProductVariants');
    expect(shop.calls).toContain('CatalogProductImages');
  });

  it('records the run so the merchant can see the catalogue is current', async () => {
    const shop = makeDevStore(60);

    await runCatalogSync(CTX, 'dev-token', 'install', depsFor(shop, store));

    const run = await store.getLastSyncRun(CTX.connectionId);
    expect(run?.status).toBe('completed');
    expect(run?.trigger).toBe('install');
    expect(run?.counts.productsSeen).toBe(60);
    expect(run?.finishedAt).not.toBeNull();
    // Heartbeats prove a long run is observable while it is still going.
    expect(store.runs[0].heartbeats).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('collections and membership', () => {
  it('imports collections and links exactly the products they contain', async () => {
    const shop = makeDevStore(10);
    const productIds = [...shop.products.keys()].slice(0, 4);
    shop.addCollection({
      id: 'gid://shopify/Collection/1',
      title: 'Summer',
      handle: 'summer',
      updatedAt: '2026-09-01T10:00:00Z',
      productIds,
    });

    const outcome = await runCatalogSync(CTX, 'dev-token', 'install', depsFor(shop, store));

    expect(outcome.status).toBe('completed');
    const collections = await store.listCollections(CTX.connectionId);
    expect(collections).toHaveLength(1);
    expect(collections[0].title).toBe('Summer');
    expect(store.links).toHaveLength(4);
  });

  it('drops membership for a product removed from a collection', async () => {
    const shop = makeDevStore(10);
    const productIds = [...shop.products.keys()].slice(0, 4);
    shop.addCollection({
      id: 'gid://shopify/Collection/1',
      title: 'Summer',
      handle: 'summer',
      updatedAt: '2026-09-01T10:00:00Z',
      productIds: [...productIds],
    });

    const now = clock();
    await runCatalogSync(CTX, 'dev-token', 'install', depsFor(shop, store, now));
    expect(store.links).toHaveLength(4);

    shop.collections.get('gid://shopify/Collection/1')!.productIds = productIds.slice(0, 2);
    await runCatalogSync(CTX, 'dev-token', 'reconciliation', depsFor(shop, store, now));

    expect(store.links).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('A4: syncing twice is idempotent', () => {
  it('produces no duplicates and no deletions on an unchanged catalogue', async () => {
    const shop = makeDevStore(60);
    const now = clock();

    const first = await runCatalogSync(CTX, 'dev-token', 'install', depsFor(shop, store, now));
    const productsAfterFirst = store.products.length;
    const variantsAfterFirst = store.variants.length;

    const second = await runCatalogSync(CTX, 'dev-token', 'reconciliation', depsFor(shop, store, now));

    expect(first.status).toBe('completed');
    expect(second.status).toBe('completed');
    expect(store.products.length).toBe(productsAfterFirst);
    expect(store.variants.length).toBe(variantsAfterFirst);
    expect(store.liveProducts(CTX.connectionId)).toHaveLength(60);
    if (second.status === 'completed') {
      expect(second.counts.productsDeleted).toBe(0);
      expect(second.counts.collectionsDeleted).toBe(0);
    }
  });

  it('refuses to start a second sync while one is already running', async () => {
    const shop = makeDevStore(5);
    await store.startSyncRun(CTX, 'manual'); // simulate a run in flight

    const outcome = await runCatalogSync(CTX, 'dev-token', 'reconciliation', depsFor(shop, store));

    expect(outcome).toEqual({ status: 'skipped', reason: 'already_running' });
    expect(store.products).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('A5: reconciliation repairs a lost webhook', () => {
  it('marks a product deleted upstream even though no webhook arrived', async () => {
    const shop = makeDevStore(60);
    const now = clock();
    await runCatalogSync(CTX, 'dev-token', 'install', depsFor(shop, store, now));
    expect(await store.countProducts(CTX.connectionId)).toBe(60);

    // The merchant deletes a product and the webhook never reaches us.
    const removed = [...shop.products.keys()][0];
    shop.removeProduct(removed);

    const outcome = await runCatalogSync(CTX, 'dev-token', 'reconciliation', depsFor(shop, store, now));

    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') expect(outcome.counts.productsDeleted).toBe(1);
    expect(await store.countProducts(CTX.connectionId)).toBe(59);

    // Soft delete: the row is still there, so the removal is recoverable.
    const row = store.products.find((p) => p.shopifyId === removed);
    expect(row).toBeDefined();
    expect(row?.deletedAt).not.toBeNull();
  });

  it('brings a product back if it reappears upstream', async () => {
    const shop = makeDevStore(5);
    const now = clock();
    await runCatalogSync(CTX, 'dev-token', 'install', depsFor(shop, store, now));

    const product = [...shop.products.values()][0];
    shop.removeProduct(product.id);
    await runCatalogSync(CTX, 'dev-token', 'reconciliation', depsFor(shop, store, now));
    expect(await store.countProducts(CTX.connectionId)).toBe(4);

    shop.addProduct(product);
    await runCatalogSync(CTX, 'dev-token', 'reconciliation', depsFor(shop, store, now));

    expect(await store.countProducts(CTX.connectionId)).toBe(5);
    // Restored in place, not duplicated.
    expect(store.products.filter((p) => p.shopifyId === product.id)).toHaveLength(1);
  });

  it('picks up a price change made while no webhook was delivered', async () => {
    const shop = makeDevStore(3);
    const now = clock();
    await runCatalogSync(CTX, 'dev-token', 'install', depsFor(shop, store, now));

    const product = [...shop.products.values()][0];
    product.variants[0].price = '99.00';

    await runCatalogSync(CTX, 'dev-token', 'reconciliation', depsFor(shop, store, now));

    const variant = store.variants.find((v) => v.shopifyId === product.variants[0].id);
    expect(variant?.price).toBe('99.00');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('a failed sync never deletes anything', () => {
  it('marks the run failed and leaves the existing catalogue intact', async () => {
    const shop = makeDevStore(60);
    const now = clock();
    await runCatalogSync(CTX, 'dev-token', 'install', depsFor(shop, store, now));
    expect(await store.countProducts(CTX.connectionId)).toBe(60);

    // Shopify starts failing half-way through the next read.
    let pageCalls = 0;
    const failingTransport = {
      post: async (url: string, body: { query: string; variables: Record<string, unknown> }) => {
        if (body.query.includes('query CatalogProducts')) {
          pageCalls += 1;
          if (pageCalls > 1) throw Object.assign(new Error('boom'), { response: { status: 500 } });
        }
        return (shop.transport as unknown as { post: typeof failingTransport.post }).post(url, body);
      },
    } as never;

    const outcome = await runCatalogSync(CTX, 'dev-token', 'reconciliation', {
      store,
      now,
      createClient: (domain: string, token: string) =>
        createCatalogClient(domain, token, { transport: failingTransport, maxRetries: 1, sleep: async () => {} }),
    });

    expect(outcome.status).toBe('failed');
    // The catalogue is untouched: a network blip must not empty a store.
    expect(await store.countProducts(CTX.connectionId)).toBe(60);
    const run = await store.getLastSyncRun(CTX.connectionId);
    expect(run?.status).toBe('failed');
    expect(run?.error).toContain('boom');
  });
});
