/**
 * Sprint 2 — Theme App Extension and the gallery it renders.
 *
 * Acceptance criteria covered here:
 *   B3 three styles
 *   B4 products as posts, collections as stories
 *   B5 the variant selector and quick buy resolve the CORRECT variant
 *   B7 publish, disable and revert
 *   B8 one shop never sees another shop's gallery
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

vi.mock('../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PRODUCT_MODE: 'social_gallery',
    SHOPIFY_APP_URL: 'https://example.test',
    // A published gallery now issues a signed ingest token for the storefront.
    SHOPIFY_API_SECRET: 'test-shopify-secret',
  },
}));
vi.mock('../lib/supabase.js', () => ({ supabase: { from: () => { throw new Error('no db in tests'); } } }));

import {
  composePublicGallery,
  disableGallery,
  normaliseSettings,
  publishGallery,
  revertGallery,
  saveGallery,
} from '../services/gallery/galleryService.js';
import { composePost } from '../services/gallery/galleryStore.js';
import { numericShopifyId } from '../services/gallery/galleryTypes.js';
import { MemoryGalleryStore } from './helpers/memoryGalleryStore.js';
import type { ShopContext } from '../services/catalog/catalogStore.js';

const SHOP_A: ShopContext = { accountId: 'acc-a', connectionId: 'conn-a', shopDomain: 'alpha.myshopify.com' };
const SHOP_B: ShopContext = { accountId: 'acc-b', connectionId: 'conn-b', shopDomain: 'beta.myshopify.com' };

let store: MemoryGalleryStore;
const deps = () => ({ store });

beforeEach(() => {
  store = new MemoryGalleryStore();
  store.seedShop(SHOP_A, { products: 5, collections: 2 });
  store.seedShop(SHOP_B, { products: 3, collections: 1 });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B7: publish, disable and revert', () => {
  it('a new shop starts with an unpublished gallery that renders nothing', async () => {
    const gallery = await composePublicGallery(SHOP_A.shopDomain, deps());
    expect(gallery.active).toBe(false);
    expect(gallery.posts).toEqual([]);
    expect(gallery.stories).toEqual([]);
    // An unpublished shop hands out no ingest token.
    expect(gallery.ingestToken).toBeNull();
  });

  it('publishing makes the gallery live and bumps the version', async () => {
    await saveGallery(SHOP_A, { style: 'warm', heading: 'Shop the look' }, deps());
    const published = await publishGallery(SHOP_A, deps());

    expect(published?.status).toBe('published');
    expect(published?.version).toBe(1);

    const live = await composePublicGallery(SHOP_A.shopDomain, deps());
    expect(live.active).toBe(true);
    expect(live.ingestToken).toBeTruthy();
    expect(live.style).toBe('warm');
    expect(live.heading).toBe('Shop the look');
    expect(live.posts.length).toBe(5);
  });

  it('disabling leaves nothing for the storefront to render', async () => {
    await saveGallery(SHOP_A, { style: 'film' }, deps());
    await publishGallery(SHOP_A, deps());
    expect((await composePublicGallery(SHOP_A.shopDomain, deps())).active).toBe(true);

    const disabled = await disableGallery(SHOP_A, deps());

    expect(disabled?.status).toBe('disabled');
    const after = await composePublicGallery(SHOP_A.shopDomain, deps());
    expect(after.active).toBe(false);
    expect(after.posts).toEqual([]);
    expect(after.stories).toEqual([]);
  });

  it('reverting restores an earlier published version', async () => {
    await saveGallery(SHOP_A, { style: 'original', heading: 'First' }, deps());
    await publishGallery(SHOP_A, deps());          // v1

    await saveGallery(SHOP_A, { style: 'film', heading: 'Second' }, deps());
    await publishGallery(SHOP_A, deps());          // v2
    expect((await composePublicGallery(SHOP_A.shopDomain, deps())).style).toBe('film');

    const reverted = await revertGallery(SHOP_A, 1, deps());

    expect(reverted?.version).toBe(3); // revert publishes forward, never rewrites history
    const live = await composePublicGallery(SHOP_A.shopDomain, deps());
    expect(live.style).toBe('original');
    expect(live.heading).toBe('First');
  });

  it('refuses to revert to a version that was never published', async () => {
    await saveGallery(SHOP_A, {}, deps());
    await publishGallery(SHOP_A, deps());
    expect(await revertGallery(SHOP_A, 9, deps())).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B3 + B4: styles, posts and stories', () => {
  it('accepts the three supported styles and rejects anything else', async () => {
    for (const style of ['original', 'warm', 'film'] as const) {
      const saved = await saveGallery(SHOP_A, { style }, deps());
      expect(saved.style).toBe(style);
    }
    const fallback = await saveGallery(SHOP_A, { style: 'neon' }, deps());
    expect(fallback.style).toBe('film'); // keeps the last valid value, never stores junk
  });

  it('serves collections as stories, and can turn them off', async () => {
    await saveGallery(SHOP_A, { showStories: true }, deps());
    await publishGallery(SHOP_A, deps());
    expect((await composePublicGallery(SHOP_A.shopDomain, deps())).stories.length).toBe(2);

    await saveGallery(SHOP_A, { showStories: false }, deps());
    await publishGallery(SHOP_A, deps());
    expect((await composePublicGallery(SHOP_A.shopDomain, deps())).stories).toEqual([]);
  });

  it('limits a gallery to one collection when the merchant picks one', async () => {
    const collection = store.collectionsFor(SHOP_A.connectionId)[0];
    await saveGallery(SHOP_A, { collectionId: collection.id }, deps());
    await publishGallery(SHOP_A, deps());

    const live = await composePublicGallery(SHOP_A.shopDomain, deps());
    expect(live.posts.length).toBe(collection.productIds.length);
    expect(live.posts.length).toBeLessThan(5);
  });

  it('clamps the post limit instead of trusting the client', async () => {
    expect(normaliseSettings({ postsLimit: 100000 }).postsLimit).toBe(250);
    expect(normaliseSettings({ postsLimit: -4 }).postsLimit).toBe(1);
    expect(normaliseSettings({ postsLimit: 'lots' }).postsLimit).toBe(60);
  });

  it('never puts internal identifiers or shop data in the public payload', async () => {
    await saveGallery(SHOP_A, {}, deps());
    await publishGallery(SHOP_A, deps());
    const live = await composePublicGallery(SHOP_A.shopDomain, deps());

    const serialised = JSON.stringify(live);
    expect(serialised).not.toContain('test-shopify-secret');
    expect(serialised).not.toContain(SHOP_A.accountId);
    expect(serialised).not.toContain(SHOP_A.connectionId);
    expect(serialised).not.toMatch(/access_token|accountId|connectionId/i);
    for (const post of live.posts) {
      expect(typeof post.id).toBe('number'); // numeric Shopify id, not a UUID
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B8: one shop never sees another shop', () => {
  it('serves each shop only its own posts', async () => {
    await saveGallery(SHOP_A, {}, deps());
    await publishGallery(SHOP_A, deps());
    await saveGallery(SHOP_B, {}, deps());
    await publishGallery(SHOP_B, deps());

    const a = await composePublicGallery(SHOP_A.shopDomain, deps());
    const b = await composePublicGallery(SHOP_B.shopDomain, deps());

    expect(a.posts.length).toBe(5);
    expect(b.posts.length).toBe(3);
    const aHandles = new Set(a.posts.map((p) => p.handle));
    for (const post of b.posts) expect(aHandles.has(post.handle)).toBe(false);
  });

  it('treats an unknown shop exactly like one with nothing published', async () => {
    const gallery = await composePublicGallery('someone-else.myshopify.com', deps());
    expect(gallery.active).toBe(false);
    expect(gallery.posts).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('composePost', () => {
  it('converts Shopify GIDs to the numeric ids the cart needs', () => {
    expect(numericShopifyId('gid://shopify/ProductVariant/44123456789')).toBe(44123456789);
    expect(numericShopifyId('gid://shopify/Product/000123')).toBe(123);
    expect(numericShopifyId('not-a-gid')).toBeNull();
    expect(numericShopifyId(null)).toBeNull();
  });

  it('reports the real price range and availability', () => {
    const post = composePost(
      { id: 'p1', shopify_id: 'gid://shopify/Product/1', handle: 'candle', title: 'Candle', featured_image_url: null },
      [
        { shopify_id: 'gid://shopify/ProductVariant/11', title: 'S', price: 30, compare_at_price: null, available_for_sale: false, position: 0, selected_options: [{ name: 'Size', value: 'S' }] },
        { shopify_id: 'gid://shopify/ProductVariant/12', title: 'M', price: 18, compare_at_price: 25, available_for_sale: true, position: 1, selected_options: [{ name: 'Size', value: 'M' }] },
      ],
      [{ url: 'https://cdn/x.jpg', alt_text: 'x', width: 800, height: 800, position: 0 }],
    );

    expect(post.priceMin).toBe('18.00'); // cheapest, not the first listed
    expect(post.priceMax).toBe('30.00');
    expect(post.available).toBe(true);
    expect(post.url).toBe('/products/candle');
    expect(post.variants[0].id).toBe(11);
    expect(post.variants[1].compareAtPrice).toBe('25.00');
  });

  it('drops variants whose id cannot be parsed rather than emitting a broken buy button', () => {
    const post = composePost(
      { id: 'p1', shopify_id: 'gid://shopify/Product/1', handle: 'x', title: 'X', featured_image_url: null },
      [{ shopify_id: 'broken', title: 'S', price: 10, compare_at_price: null, available_for_sale: true, position: 0, selected_options: [] }],
      [],
    );
    expect(post.variants).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B5 — the storefront logic itself. Imported from the theme app extension, so
// the code that runs in a shopper's browser is what is under test.
describe('B5: storefront variant selection and quick buy', () => {
  let core: {
    selectVariant: (post: unknown, chosen: unknown) => { id: number; available: boolean } | null;
    defaultSelection: (post: unknown) => Record<string, string>;
    cartPayload: (variant: unknown, quantity?: number) => { items: { id: number; quantity: number }[] } | null;
    optionGroups: (post: unknown) => { name: string; values: string[] }[];
    styleClass: (style: string) => string;
    buildApiUrl: (base: string, shop: string) => string;
    priceLabel: (post: unknown, format?: (v: string) => string) => string;
    renderablePosts: (gallery: unknown) => unknown[];
  };

  beforeEach(async () => {
    const file = resolve(__dirname, '../../../extensions/social-gallery/assets/gallery-core.js');
    core = await import(pathToFileURL(file).href);
  });

  const shirt = {
    handle: 'shirt',
    image: { url: 'https://cdn/s.jpg' },
    priceMin: '20.00',
    priceMax: '24.00',
    variants: [
      { id: 1, title: 'S / Blue', price: '20.00', available: true, options: [{ name: 'Size', value: 'S' }, { name: 'Colour', value: 'Blue' }] },
      { id: 2, title: 'M / Blue', price: '22.00', available: false, options: [{ name: 'Size', value: 'M' }, { name: 'Colour', value: 'Blue' }] },
      { id: 3, title: 'M / Red', price: '24.00', available: true, options: [{ name: 'Size', value: 'M' }, { name: 'Colour', value: 'Red' }] },
    ],
  };

  it('resolves the variant matching every chosen option', () => {
    expect(core.selectVariant(shirt, { Size: 'M', Colour: 'Red' })?.id).toBe(3);
    expect(core.selectVariant(shirt, { Size: 'S', Colour: 'Blue' })?.id).toBe(1);
  });

  it('returns nothing when the combination does not exist, instead of guessing', () => {
    expect(core.selectVariant(shirt, { Size: 'S', Colour: 'Red' })).toBeNull();
  });

  it('returns nothing until every option has been chosen', () => {
    expect(core.selectVariant(shirt, { Size: 'M' })).toBeNull();
    expect(core.selectVariant(shirt, {})).toBeNull();
  });

  it('uses the single variant when a product has no options', () => {
    const simple = { handle: 'soap', variants: [{ id: 9, price: '8.00', available: true, options: [] }] };
    expect(core.selectVariant(simple, {})?.id).toBe(9);
  });

  it('preselects the first variant that is actually in stock', () => {
    const outOfStockFirst = {
      handle: 'x',
      variants: [
        { id: 1, available: false, options: [{ name: 'Size', value: 'S' }] },
        { id: 2, available: true, options: [{ name: 'Size', value: 'M' }] },
      ],
    };
    expect(core.defaultSelection(outOfStockFirst)).toEqual({ Size: 'M' });
    expect(core.selectVariant(outOfStockFirst, core.defaultSelection(outOfStockFirst))?.id).toBe(2);
  });

  it('builds a cart payload Shopify accepts, and refuses an unresolved variant', () => {
    expect(core.cartPayload({ id: 3 }, 1)).toEqual({ items: [{ id: 3, quantity: 1 }] });
    expect(core.cartPayload({ id: 3 }, 0)).toEqual({ items: [{ id: 3, quantity: 1 }] });
    expect(core.cartPayload(null)).toBeNull();
    expect(core.cartPayload({ id: 'gid://shopify/ProductVariant/3' })).toBeNull();
  });

  it('lists option groups in the order Shopify presents them', () => {
    expect(core.optionGroups(shirt)).toEqual([
      { name: 'Size', values: ['S', 'M'] },
      { name: 'Colour', values: ['Blue', 'Red'] },
    ]);
  });

  it('maps styles to classes and falls back safely', () => {
    expect(core.styleClass('warm')).toBe('sg--warm');
    expect(core.styleClass('film')).toBe('sg--film');
    expect(core.styleClass('nonsense')).toBe('sg--original');
    expect(core.styleClass(undefined as unknown as string)).toBe('sg--original');
  });

  it('builds the API url without a double slash', () => {
    expect(core.buildApiUrl('https://api.test/', 'shop.myshopify.com'))
      .toBe('https://api.test/api/public/gallery/shop.myshopify.com');
  });

  it('shows a range only when there is one', () => {
    expect(core.priceLabel(shirt)).toBe('20.00 – 24.00');
    expect(core.priceLabel({ priceMin: '20.00', priceMax: '20.00' })).toBe('20.00');
    expect(core.priceLabel({})).toBe('');
  });

  it('renders nothing when the gallery is inactive or a post has no image', () => {
    expect(core.renderablePosts({ active: false, posts: [shirt] })).toEqual([]);
    expect(core.renderablePosts({ active: true, posts: [{ handle: 'x', image: null }] })).toEqual([]);
    expect(core.renderablePosts({ active: true, posts: [shirt] })).toHaveLength(1);
  });
});
