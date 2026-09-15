/**
 * The social half of the storefront.
 *
 * Three things are worth testing here and nothing else is:
 *
 *   1. what a plan actually unlocks, checked on the server rather than by
 *      hiding a button;
 *   2. what the card generator refuses to fetch, because that is the only
 *      place this product reaches out to a URL at all;
 *   3. what a list and a vote will and will not accept, because they are the
 *      two unauthenticated writes in the whole system.
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

import {
  MAX_PICKS,
  newPicksToken,
  normalisePicks,
  type PicksRecord,
  type PicksStore,
} from '../services/social/picksService.js';
import { escapeXml, isAllowedImageUrl, overlaySvg, trimUrl, wrap } from '../services/social/shareCard.js';
import { ensureShareCardFont } from '../services/social/fonts.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { entitlementsFor, type ShopSubscription } from '../services/billing/entitlements.js';
import { castPickVote, createPicks, deletePicks, readPicks } from '../services/social/socialService.js';
import type { PublicGallery, PublicPost } from '../services/gallery/galleryTypes.js';

function post(id: number, title = `Product ${id}`): PublicPost {
  return {
    id,
    handle: `p-${id}`,
    title,
    url: `/products/p-${id}`,
    image: { url: `https://cdn.shopify.com/s/files/${id}.jpg`, altText: null, width: 1600, height: 1600 },
    images: [],
    priceMin: '20.00',
    priceMax: '20.00',
    available: true,
    variants: [{ id: id * 10, title: 'Default', price: '20.00', compareAtPrice: null, available: true, options: [] }],
  };
}

function gallery(overrides: Partial<PublicGallery> = {}): PublicGallery {
  return {
    shop: 'demo.myshopify.com',
    active: true,
    version: 1,
    ingestToken: 'tok',
    layout: 'grid',
    style: 'warm',
    filterIntensity: 100,
    frame: 'clean',
    heading: null,
    showStories: true,
    showQuickBuy: true,
    shareTagline: 'Shop this look',
    showBranding: true,
    features: { sharedLists: true, friendVotes: true },
    stories: [],
    posts: [post(1), post(2), post(3)],
    ...overrides,
  };
}

/** An in-memory stand-in for the two tables. */
class MemoryPicks implements PicksStore {
  rows = new Map<string, PicksRecord & { deleted: boolean }>();
  votes = new Map<string, Map<string, number>>();

  async create(record: Omit<PicksRecord, 'createdAt' | 'expiresAt'>) {
    const full: PicksRecord = {
      ...record,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
    };
    this.rows.set(record.token, { ...full, deleted: false });
    return full;
  }
  async getByToken(token: string) {
    const row = this.rows.get(token);
    return row && !row.deleted ? row : null;
  }
  async softDelete(token: string) {
    const row = this.rows.get(token);
    if (!row) return false;
    row.deleted = true;
    return true;
  }
  async castVote(token: string, productId: number, voterKey: string) {
    const row = await this.getByToken(token);
    if (!row || row.mode !== 'vote' || !row.productIds.includes(productId)) return false;
    const forList = this.votes.get(token) ?? new Map<string, number>();
    forList.set(voterKey, productId); // one per browser, replaced not added
    this.votes.set(token, forList);
    return true;
  }
  async tally(token: string) {
    const counts: Record<number, number> = {};
    for (const productId of (this.votes.get(token) ?? new Map()).values()) {
      counts[productId] = (counts[productId] ?? 0) + 1;
    }
    return counts;
  }
}

let picks: MemoryPicks;
beforeEach(() => { picks = new MemoryPicks(); });

const live = (planId: ShopSubscription['planId']): ShopSubscription => ({
  connectionId: 'c', accountId: 'a', shopifyGid: 'gid://1', planId,
  status: 'active', isTest: true, trialEndsAt: null, currentPeriodEnd: null,
});

// ═══════════════════════════════════════════════════════════════════════════
describe('what a plan unlocks', () => {
  it('gives Basic three treatments and two frames, and nothing social', () => {
    const basic = entitlementsFor(live('basic'));

    expect([...basic.allowedStyles]).toEqual(['original', 'warm', 'film']);
    expect([...basic.allowedFrames]).toEqual(['none', 'clean']);
    expect(basic.canUseSharedLists).toBe(false);
    expect(basic.canUseFriendVotes).toBe(false);
    expect(basic.canRemoveBranding).toBe(false);
  });

  it('gives Growth every treatment and frame, and the social features', () => {
    const growth = entitlementsFor(live('growth'));

    expect(growth.allowedStyles).toHaveLength(6);
    expect(growth.allowedFrames).toHaveLength(5);
    expect(growth.canUseSharedLists).toBe(true);
    expect(growth.canUseFriendVotes).toBe(true);
    expect(growth.canRemoveBranding).toBe(true);
  });

  it('treats a plan it does not recognise as Basic, never as more', () => {
    // A withdrawn charge, or one Shopify reports under a name we retired.
    const unknown = entitlementsFor(live(null));

    expect([...unknown.allowedStyles]).toEqual(['original', 'warm', 'film']);
    expect(unknown.canUseSharedLists).toBe(false);
  });

  it('grants nothing at all to a shop that may not publish', () => {
    const lapsed = entitlementsFor({ ...live('growth'), status: 'cancelled' });

    expect(lapsed.canPublish).toBe(false);
    expect([...lapsed.allowedStyles]).toEqual(['original', 'warm', 'film']);
    expect(lapsed.canUseSharedLists).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the shareable card', () => {
  it('fetches photographs from Shopify and nowhere else', () => {
    expect(isAllowedImageUrl('https://cdn.shopify.com/s/files/1/x.jpg')).toBe(true);
    expect(isAllowedImageUrl('https://cdn.shopifycdn.net/s/files/1/x.jpg')).toBe(true);

    // The shapes an SSRF attempt actually takes.
    expect(isAllowedImageUrl('http://cdn.shopify.com/x.jpg'), 'plaintext').toBe(false);
    expect(isAllowedImageUrl('https://169.254.169.254/latest/meta-data/'), 'link-local').toBe(false);
    expect(isAllowedImageUrl('http://localhost:3001/health'), 'loopback').toBe(false);
    expect(isAllowedImageUrl('file:///etc/passwd'), 'a file').toBe(false);
    expect(isAllowedImageUrl('https://cdn.shopify.com.evil.test/x.jpg'), 'a lookalike host').toBe(false);
    expect(isAllowedImageUrl('https://evil.test/?x=cdn.shopify.com'), 'the host in a query').toBe(false);
    expect(isAllowedImageUrl(null)).toBe(false);
  });

  it('escapes merchant text on its way into the drawing', () => {
    // A product called "Salt & Pepper" is ordinary. Unescaped it would not
    // merely look wrong, it would break the render for that one product.
    expect(escapeXml('Salt & Pepper')).toBe('Salt &amp; Pepper');
    expect(escapeXml('<script>alert(1)</script>')).not.toContain('<script>');

    const svg = overlaySvg({
      post: post(1, 'Salt & Pepper <b>'),
      shopName: 'Ampersand & Co',
      productUrl: 'https://demo.myshopify.com/products/p-1',
      tagline: 'Shop this "look"',
      showBranding: true,
      style: 'warm',
      intensity: 100,
      priceLabel: '20.00',
    });

    expect(svg).not.toMatch(/<b>/);
    expect(svg).toContain('&amp;');
    expect(svg).toContain('made with Sillages');
  });

  it('drops the Sillages mark when the plan says so', () => {
    const svg = overlaySvg({
      post: post(1),
      shopName: 'Shop',
      productUrl: 'https://demo.myshopify.com/products/p-1',
      tagline: 'Shop this look',
      showBranding: false,
      style: 'original',
      intensity: 0,
      priceLabel: '20.00',
    });

    expect(svg).not.toContain('Sillages');
  });

  it('draws its text with attributes, not a stylesheet', () => {
    // librsvg — the renderer behind sharp — ignores the `font` shorthand in a
    // <style> block. Declaring it that way drew every line at the default size:
    // legible in a desktop preview and unreadable on the phone the card is for.
    const svg = overlaySvg({
      post: post(1),
      shopName: 'Shop',
      productUrl: 'https://demo.myshopify.com/products/p-1',
      tagline: 'Shop this look',
      showBranding: true,
      style: 'warm',
      intensity: 100,
      priceLabel: '20.00',
    });

    expect(svg).not.toContain('<style>');
    expect(svg).toMatch(/font-size="\d+"/);
    expect(svg).toMatch(/font-family="[^"]+"/);
  });

  it('shortens the address so it does not run under the mark', () => {
    expect(trimUrl('https://demo.myshopify.com/products/p-1', 60)).toBe('demo.myshopify.com/products/p-1');

    const long = trimUrl('https://a-very-long-shop-name.myshopify.com/products/a-very-long-product-handle', 34);
    expect(long).toHaveLength(34);
    expect(long.endsWith('…')).toBe(true);
    // The host survives: it is the part that tells a stranger whose shop it is.
    expect(long.startsWith('a-very-long-shop-name')).toBe(true);
  });

  it('breaks a long title instead of letting it run off the card', () => {
    const lines = wrap('A very long product name that would never fit on one line of a card', 26, 2);
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.length <= 27)).toBe(true);
    expect(lines[1].endsWith('…')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('turning saved products into a link', () => {
  const deps = (over: Partial<PublicGallery> = {}) => ({
    picks,
    gallery: (async () => gallery(over)) as never,
    connectionIdFor: async () => 'conn-1',
    shopDomainFor: async () => 'demo.myshopify.com',
  });

  it('refuses a Basic shop even when the request arrives directly', async () => {
    // The storefront never shows the button on Basic. This is the case where
    // somebody calls the endpoint anyway.
    const result = await createPicks(
      'demo.myshopify.com',
      [1, 2],
      'list',
      deps({ features: { sharedLists: false, friendVotes: false } }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it('refuses a vote on a shop that has lists but not votes', async () => {
    const result = await createPicks(
      'demo.myshopify.com',
      [1, 2],
      'vote',
      deps({ features: { sharedLists: true, friendVotes: false } }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it('keeps only products the merchant actually published', async () => {
    // 99 is not in the gallery: either the shopper's saved list is stale, or
    // somebody is fishing for products the merchant chose not to show.
    const result = await createPicks('demo.myshopify.com', [1, 99, 2], 'list', deps());

    expect(result.ok).toBe(true);
    const stored = [...picks.rows.values()][0];
    expect(stored.productIds).toEqual([1, 2]);
  });

  it('refuses a vote between fewer than two things', async () => {
    const result = await createPicks('demo.myshopify.com', [1], 'vote', deps());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('refuses an empty list rather than making a link to nothing', async () => {
    expect(normalisePicks([], 'list')).toBeNull();
    expect(normalisePicks('not an array', 'list')).toBeNull();
    expect(normalisePicks([0, -1, 'x', null], 'list')).toBeNull();
  });

  it('caps how many things one list can hold, and drops duplicates', () => {
    const many = Array.from({ length: 60 }, (_, i) => i + 1);
    const normalised = normalisePicks([...many, ...many], 'list');

    expect(normalised?.productIds).toHaveLength(MAX_PICKS);
    expect(new Set(normalised?.productIds).size).toBe(MAX_PICKS);
  });

  it('makes tokens that are not worth guessing', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newPicksToken()));
    expect(seen.size).toBe(200);
    for (const token of seen) expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('stops serving a list once the shop stops publishing', async () => {
    const created = await createPicks('demo.myshopify.com', [1, 2], 'list', deps());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // The gallery is turned off. The link outlives it; the products must not.
    const view = await readPicks(created.value.token, {
      picks,
      gallery: (async () => gallery({ active: false })) as never,
      shopDomainFor: async () => 'demo.myshopify.com',
    });
    expect(view).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the vote', () => {
  async function aVote() {
    const created = await createPicks('demo.myshopify.com', [1, 2, 3], 'vote', {
      picks,
      gallery: (async () => gallery()) as never,
      connectionIdFor: async () => 'conn-1',
    });
    if (!created.ok) throw new Error('setup failed');
    return created.value.token;
  }

  it('counts one opinion per browser, and lets it change', async () => {
    const token = await aVote();

    await castPickVote(token, 1, 'voter-aaaaaaaa', { picks });
    await castPickVote(token, 1, 'voter-bbbbbbbb', { picks });
    let result = await castPickVote(token, 2, 'voter-aaaaaaaa', { picks });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // The first voter moved rather than voting twice.
      expect(result.value.votes).toEqual({ 1: 1, 2: 1 });
    }

    result = await castPickVote(token, 2, 'voter-bbbbbbbb', { picks });
    if (result.ok) expect(result.value.votes).toEqual({ 2: 2 });
  });

  it('refuses a vote for something that is not on the list', async () => {
    const token = await aVote();
    const result = await castPickVote(token, 999, 'voter-aaaaaaaa', { picks });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });

  it('refuses a malformed voter key rather than storing whatever arrives', async () => {
    const token = await aVote();

    for (const key of ['', 'short', 'x'.repeat(100), 'has spaces', '<script>']) {
      const result = await castPickVote(token, 1, key, { picks });
      expect(result.ok, key).toBe(false);
    }
  });

  it('answers the same way for a token that never existed', async () => {
    const result = await castPickVote('a'.repeat(32), 1, 'voter-aaaaaaaa', { picks });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('removing a list', () => {
  it('only the device that made it can, and the key is not the token', async () => {
    const created = await createPicks('demo.myshopify.com', [1, 2], 'list', {
      picks,
      gallery: (async () => gallery()) as never,
      connectionIdFor: async () => 'conn-1',
    });
    if (!created.ok) throw new Error('setup failed');
    const { token, ownerKey } = created.value;

    expect(ownerKey).not.toBe(token);
    expect(await deletePicks(token, 'not-the-key', { picks })).toBe(false);
    expect(await deletePicks(token, '', { picks })).toBe(false);
    expect(await deletePicks(token, ownerKey, { picks })).toBe(true);

    expect(
      await readPicks(token, {
        picks,
        gallery: (async () => gallery()) as never,
        shopDomainFor: async () => 'demo.myshopify.com',
      }),
    ).toBeNull();
  });
});

// ===========================================================================
describe('the card has a font to draw with', () => {
  it('ships the font rather than assuming the machine has one', () => {
    // A plain Node container has no fonts at all. Without this the card drew
    // every character as an empty box — in production only, because the
    // developer's machine has fonts of its own and looked fine.
    const family = ensureShareCardFont();
    expect(family).toBe('DejaVu Sans');
    expect(process.env.FONTCONFIG_FILE, 'fontconfig was never pointed at it').toBeTruthy();

    const conf = readFileSync(process.env.FONTCONFIG_FILE!, 'utf8');
    const dir = /<dir>(.*)<\/dir>/.exec(conf)?.[1] ?? '';
    expect(existsSync(join(dir, 'DejaVuSans.ttf')), `no font in ${dir}`).toBe(true);
    expect(existsSync(join(dir, 'LICENSE')), 'the font ships without its licence').toBe(true);
  });
});
