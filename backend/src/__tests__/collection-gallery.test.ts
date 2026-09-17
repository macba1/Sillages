/**
 * The gallery on a collection page.
 *
 * Reported by the merchant: "si luego voy a catalog ahí no se ve el cambio,
 * o sea el catálogo de producto queda igual que estaba antes." It was true.
 * The block only ever showed one collection, chosen once in the admin, so a
 * shopper browsing /collections/whatever saw the theme's own grid and none of
 * this. The design still comes from the single saved configuration; what the
 * page decides is which products.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PRODUCT_MODE: 'social_gallery',
    SHOPIFY_APP_URL: 'https://example.test',
    SHOPIFY_API_SECRET: 'test-shopify-secret',
  },
}));
vi.mock('../lib/supabase.js', () => ({ supabase: { from: () => { throw new Error('no db in tests'); } } }));

import { composePublicGallery, publishGallery, saveGallery } from '../services/gallery/galleryService.js';
import { MemoryGalleryStore } from './helpers/memoryGalleryStore.js';
import { MemorySubscriptionStore } from './helpers/memorySubscriptionStore.js';
import type { ShopContext } from '../services/catalog/catalogStore.js';

const SHOP: ShopContext = {
  accountId: 'acc-1',
  connectionId: 'conn-1',
  shopDomain: 'alpha.myshopify.com',
  accessToken: 'token',
};

let store: MemoryGalleryStore;
let subscriptions: MemorySubscriptionStore;
const deps = () => ({ store, subscriptions });

beforeEach(async () => {
  store = new MemoryGalleryStore();
  subscriptions = new MemorySubscriptionStore();
  store.seedShop(SHOP, { products: 8, collections: 2 });
  subscriptions.setLive(SHOP, 'growth');
  // The merchant configured the whole catalogue, which is the default.
  await saveGallery(SHOP, { collectionId: null }, deps());
  await publishGallery(SHOP, deps());
});

describe('the page decides which products, the merchant decides the design', () => {
  it('shows the collection the shopper is browsing', async () => {
    const whole = await composePublicGallery(SHOP.shopDomain, deps());
    const oneCollection = await composePublicGallery(SHOP.shopDomain, deps(), {
      collectionHandle: 'collection-0',
    });

    // The seeded collection holds half the catalogue, so this is visible.
    expect(whole.posts.length).toBe(8);
    expect(oneCollection.posts.length).toBe(4);
    expect(oneCollection.posts.length).toBeLessThan(whole.posts.length);
  });

  it('keeps the merchant design whichever collection is shown', async () => {
    await saveGallery(SHOP, { layout: 'polaroid', style: 'vintage', frame: 'film', filterIntensity: 60 }, deps());
    await publishGallery(SHOP, deps());

    const onCollection = await composePublicGallery(SHOP.shopDomain, deps(), {
      collectionHandle: 'collection-1',
    });

    expect(onCollection.layout).toBe('polaroid');
    expect(onCollection.style).toBe('vintage');
    expect(onCollection.frame).toBe('film');
    expect(onCollection.filterIntensity).toBe(60);
  });

  it('falls back to the merchant choice for a handle the shop does not have', async () => {
    // A stale or mistyped URL must not quietly widen what the gallery shows.
    await saveGallery(SHOP, { collectionId: `${SHOP.connectionId}-c0` }, deps());
    await publishGallery(SHOP, deps());

    const configured = await composePublicGallery(SHOP.shopDomain, deps());
    const withNonsense = await composePublicGallery(SHOP.shopDomain, deps(), {
      collectionHandle: 'a-collection-that-does-not-exist',
    });

    expect(withNonsense.posts.map((p) => p.id)).toEqual(configured.posts.map((p) => p.id));
  });

  it('cannot be pointed at another shop by way of the handle', async () => {
    const other: ShopContext = { ...SHOP, connectionId: 'conn-2', shopDomain: 'beta.myshopify.com' };
    store.seedShop(other, { products: 4, collections: 1 });

    // 'collection-0' exists in both shops. The lookup is scoped to the
    // connection, so alpha's render can only ever contain alpha's products.
    const alpha = await composePublicGallery(SHOP.shopDomain, deps(), { collectionHandle: 'collection-0' });
    expect(alpha.posts.length).toBeGreaterThan(0);
    for (const post of alpha.posts) {
      expect(String(post.handle)).toContain('alpha');
    }
  });
});

describe('the handle the storefront sends', () => {
  it('is carried by the block only on a collection template', () => {
    const block = readBlock();
    expect(block).toContain('{% if collection.handle != blank %}data-collection="{{ collection.handle }}"{% endif %}');
  });

  it('is validated before it reaches a query', () => {
    const route = readRoute();
    expect(route).toContain('const COLLECTION_HANDLE = /^[a-z0-9][a-z0-9-]{0,254}$/');
    expect(route).toContain('collectionHandleFrom');
  });
});

function readBlock(): string {
  return readFileSync(
    resolve(__dirname, '../../../extensions/social-gallery/blocks/social-gallery.liquid'),
    'utf8',
  );
}

function readRoute(): string {
  return readFileSync(resolve(__dirname, '../routes/publicGallery.ts'), 'utf8');
}
