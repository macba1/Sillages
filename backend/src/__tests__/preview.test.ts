/**
 * Sprint 5 — the public before/after generator.
 *
 * Acceptance criteria covered here:
 *   E1 accept a public store address
 *   E2 detect products and photographs
 *   E3 three proposals
 *   E5 an unguessable, temporary link
 *   E7 after installing, the same proposal is recovered
 *   E8 expired demos remove themselves
 *   E9 the generator cannot be used to reach a private network
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PRODUCT_MODE: 'social_gallery',
    FRONTEND_URL: 'https://sillages.app',
    SHOPIFY_APP_URL: 'https://api.sillages.app',
    SHOPIFY_API_SECRET: 'test-shopify-secret',
  },
}));
vi.mock('../lib/supabase.js', () => ({ supabase: { from: () => { throw new Error('no db in tests'); } } }));

import { safeFetch, UnsafeUrlError, __testing } from '../services/preview/safeFetch.js';
import { detectStore, normaliseStoreUrl, StoreDetectionError } from '../services/preview/storeDetector.js';
import { buildProposals, newPublicToken } from '../services/preview/previewGenerator.js';
import {
  claimPreview,
  createPreview,
  publicPreviewPayload,
  recordPreviewChoice,
  startClaim,
} from '../services/preview/previewService.js';
import { MemoryPreviewStore } from './helpers/memoryPreviewStore.js';

function product(i: number, images = 2) {
  return {
    id: 1000 + i,
    title: `Candle ${i}`,
    handle: `candle-${i}`,
    product_type: 'Home',
    images: Array.from({ length: images }, (_, n) => ({
      src: `https://cdn.shopify.com/s/files/candle-${i}-${n}.jpg`,
      alt: null,
      width: 1200,
      height: 1200,
    })),
    variants: [{ price: `${20 + i}.00`, available: true }],
  };
}

function storefront(products: unknown[]) {
  return async () =>
    new Response(JSON.stringify({ products }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const PUBLIC_DNS = async () => ['93.184.216.34'];

function fetchOptions(transport: () => Promise<Response>) {
  return { lookup: PUBLIC_DNS, transport: transport as never };
}

let store: MemoryPreviewStore;

beforeEach(() => {
  store = new MemoryPreviewStore();
});

// ===========================================================================
describe('E9: the generator cannot reach a private network', () => {
  it('classifies every private range as unreachable', () => {
    const isPrivate = __testing.isPrivateAddress;
    for (const address of [
      '127.0.0.1', '10.0.0.1', '192.168.1.1', '172.16.0.1', '172.31.255.255',
      '169.254.169.254',
      '0.0.0.0', '100.64.0.1', '224.0.0.1',
      '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1',
      'not-an-address',
    ]) {
      expect(isPrivate(address), address).toBe(true);
    }
    for (const address of ['93.184.216.34', '1.1.1.1', '2606:4700::1111']) {
      expect(isPrivate(address), address).toBe(false);
    }
  });

  it('refuses a hostname that resolves to a private address', async () => {
    await expect(
      safeFetch('https://internal.example', { lookup: async () => ['10.0.0.5'], transport: storefront([]) as never }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('refuses a hostname where only one of several answers is private', async () => {
    await expect(
      safeFetch('https://mixed.example', {
        lookup: async () => ['93.184.216.34', '127.0.0.1'],
        transport: storefront([]) as never,
      }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('refuses a literal private address, a non-https scheme and embedded credentials', async () => {
    const opts = { lookup: PUBLIC_DNS, transport: storefront([]) as never };
    await expect(safeFetch('https://169.254.169.254/latest/meta-data/', opts)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeFetch('file:///etc/passwd', opts)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeFetch('http://example.com', opts)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeFetch('https://user:pass@example.com', opts)).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('re-checks every redirect instead of following it blindly', async () => {
    const transport = vi.fn(async (url: string) => {
      if (url.startsWith('https://public.example')) {
        return new Response(null, { status: 302, headers: { location: 'https://internal.example/secret' } });
      }
      return new Response('{"products":[]}', { status: 200 });
    });

    await expect(
      safeFetch('https://public.example/products.json', {
        lookup: async (host: string) => (host === 'internal.example' ? ['10.1.2.3'] : ['93.184.216.34']),
        transport: transport as never,
      }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('stops a redirect loop', async () => {
    const transport = async () => new Response(null, { status: 302, headers: { location: 'https://loop.example/again' } });
    await expect(
      safeFetch('https://loop.example/', { lookup: PUBLIC_DNS, transport: transport as never }),
    ).rejects.toThrow(/redirects too many times/);
  });

  it('refuses a response larger than the cap', async () => {
    const transport = async () => new Response('x'.repeat(5000), { status: 200 });
    await expect(
      safeFetch('https://big.example/', { lookup: PUBLIC_DNS, transport: transport as never, maxBytes: 1000 }),
    ).rejects.toThrow(/too much data/);
  });
});

// ===========================================================================
describe('E1 + E2: reading a public storefront', () => {
  it('accepts an address however it was pasted', () => {
    for (const input of ['shop.myshopify.com', 'https://shop.myshopify.com', 'https://shop.myshopify.com/collections/all?x=1']) {
      expect(normaliseStoreUrl(input).origin).toBe('https://shop.myshopify.com');
    }
  });

  it('rejects something that is not an address', () => {
    for (const bad of ['', '   ', 'not a url', 'localhost']) {
      expect(() => normaliseStoreUrl(bad)).toThrow(StoreDetectionError);
    }
  });

  it('detects products and their photographs', async () => {
    const detected = await detectStore(
      'https://shop.myshopify.com',
      fetchOptions(storefront([product(1), product(2), product(3)])),
    );

    expect(detected.shopDomain).toBe('shop.myshopify.com');
    expect(detected.products).toHaveLength(3);
    expect(detected.products[0].images[0].url).toMatch(/^https:\/\/cdn\.shopify\.com/);
    expect(detected.products[0].priceMin).toBe('21.00');
  });

  it('ignores products with no photograph, since a gallery is made of photographs', async () => {
    const detected = await detectStore(
      'https://shop.myshopify.com',
      fetchOptions(storefront([product(1), { ...product(2), images: [] }])),
    );
    expect(detected.products.map((p) => p.handle)).toEqual(['candle-1']);
  });

  it('says so plainly when the address is not a Shopify store', async () => {
    const notShopify = async () => new Response('<html>hello</html>', { status: 200 });
    await expect(detectStore('https://example.com', fetchOptions(notShopify))).rejects.toMatchObject({
      code: 'not_shopify',
    });

    const closed = async () => new Response('', { status: 404 });
    await expect(detectStore('https://example.com', fetchOptions(closed))).rejects.toMatchObject({
      code: 'not_shopify',
    });
  });

  it('says so plainly when a store has no usable products', async () => {
    await expect(
      detectStore('https://shop.myshopify.com', fetchOptions(storefront([{ ...product(1), images: [] }]))),
    ).rejects.toMatchObject({ code: 'no_products' });
  });
});

// ===========================================================================
describe('E3 + E5: three proposals behind an unguessable link', () => {
  it('builds exactly three proposals from the merchant own products', async () => {
    const detected = await detectStore('https://shop.myshopify.com', fetchOptions(storefront([product(1), product(2)])));
    const proposals = buildProposals(detected);

    expect(proposals.map((p) => p.style)).toEqual(['original', 'warm', 'film']);
    for (const proposal of proposals) {
      expect(proposal.posts).toHaveLength(2);
      expect(proposal.posts[0].imageUrl).toMatch(/^https:\/\/cdn\.shopify\.com/);
      expect(proposal.posts[0].url).toBe('https://shop.myshopify.com/products/candle-1');
    }
  });

  it('orders products the same way in every proposal, so only the look differs', async () => {
    const detected = await detectStore(
      'https://shop.myshopify.com',
      fetchOptions(storefront([product(1, 1), product(2, 4), product(3, 2)])),
    );
    const proposals = buildProposals(detected);
    const order = proposals.map((p) => p.posts.map((post) => post.handle));

    expect(order[0]).toEqual(['candle-2', 'candle-3', 'candle-1']);
    expect(order[1]).toEqual(order[0]);
    expect(order[2]).toEqual(order[0]);
  });

  it('issues a long random token that cannot be guessed', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newPublicToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  });

  it('creates a preview that expires', async () => {
    const result = await createPreview(
      { url: 'shop.myshopify.com' },
      { store, fetchOptions: fetchOptions(storefront([product(1)])) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // /preview is the merchant's own screen; the public demo is /demo.
    expect(result.url).toBe(`https://sillages.app/demo/${result.project.publicToken}`);
    expect(Date.parse(result.project.expiresAt)).toBeGreaterThan(Date.now());
    expect(result.project.proposals).toHaveLength(3);
  });

  it('shows nothing once a preview has expired', () => {
    const expired = {
      id: 'p1', shopDomain: 'shop.myshopify.com', sourceUrl: 'https://shop.myshopify.com',
      shopName: null, status: 'ready' as const, error: null,
      proposals: [{ style: 'warm' as const, name: 'Warm', description: '', posts: [] }],
      productCount: 3, publicToken: 'tok', claimedByConnectionId: null, claimedProposal: null,
      expiresAt: new Date(Date.now() - 1000).toISOString(), createdAt: new Date().toISOString(),
    };

    const payload = publicPreviewPayload(expired);
    expect(payload.expired).toBe(true);
    expect(payload.status).toBe('expired');
    expect(payload.proposals).toEqual([]);
  });

  it('refuses a store it cannot reach, with a message a person can read', async () => {
    const result = await createPreview(
      { url: 'https://internal.example' },
      { store, fetchOptions: { lookup: async () => ['10.0.0.1'], transport: storefront([]) as never } },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.message).toMatch(/not reachable|could not reach/i);
    }
  });
});

// ===========================================================================
describe('E6 + E7: install from the demo and get the same design', () => {
  async function seedPreview() {
    const result = await createPreview(
      { url: 'shop.myshopify.com' },
      { store, fetchOptions: fetchOptions(storefront([product(1), product(2)])) },
    );
    if (!result.ok) throw new Error('seed failed');
    return result.project;
  }

  it('builds an install link carrying a single-use claim token', async () => {
    const project = await seedPreview();

    const claim = await startClaim(project.publicToken, 'film', { store });

    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.installUrl).toContain('https://api.sillages.app/api/shopify/auth');
    expect(claim.installUrl).toContain('shop=shop.myshopify.com');
    expect(claim.installUrl).toContain(`preview=${claim.claimToken}`);
  });

  it('refuses a design that is not one of the three', async () => {
    const project = await seedPreview();
    const claim = await startClaim(project.publicToken, 'neon', { store });
    expect(claim).toMatchObject({ ok: false, status: 400, reason: 'unknown_proposal' });
  });

  it('recovers exactly the chosen proposal after installing', async () => {
    const project = await seedPreview();
    const claim = await startClaim(project.publicToken, 'film', { store });
    if (!claim.ok) throw new Error('claim failed');

    const claimed = await claimPreview(claim.claimToken, 'shop.myshopify.com', 'conn-1', { store });

    expect(claimed).toEqual({ proposal: 'film', projectId: project.id });
    expect(store.projects[0].claimedByConnectionId).toBe('conn-1');
    expect(store.projects[0].status).toBe('claimed');
  });

  it('a claim token works once', async () => {
    const project = await seedPreview();
    const claim = await startClaim(project.publicToken, 'warm', { store });
    if (!claim.ok) throw new Error('claim failed');

    await claimPreview(claim.claimToken, 'shop.myshopify.com', 'conn-1', { store });
    expect(await claimPreview(claim.claimToken, 'shop.myshopify.com', 'conn-2', { store })).toBeNull();
  });

  it('recovers the design the merchant actually chose, not the first one', async () => {
    // The install link goes through our own /auth, but Shopify's authorize URL
    // carries only client_id, scope, redirect_uri and state — our claim token
    // does not survive the round trip. The choice therefore has to be recorded
    // before the redirect, or a merchant who picks Film gets Original.
    const project = await seedPreview();
    const claim = await startClaim(project.publicToken, 'film', { store });
    if (!claim.ok) throw new Error('claim failed');

    await recordPreviewChoice(claim.claimToken, { store });

    const claimed = await claimPreview(undefined, 'shop.myshopify.com', 'conn-1', { store });

    expect(claimed?.proposal).toBe('film');
  });

  it('still recovers the demo when the merchant installs from the App Store instead', async () => {
    await seedPreview();

    const claimed = await claimPreview(undefined, 'shop.myshopify.com', 'conn-9', { store });

    expect(claimed?.proposal).toBe('original');
    expect(store.projects[0].claimedByConnectionId).toBe('conn-9');
  });

  it('recovers nothing for a shop that was never shown a demo', async () => {
    await seedPreview();
    expect(await claimPreview(undefined, 'stranger.myshopify.com', 'conn-3', { store })).toBeNull();
  });

  it('refuses to start an install from an expired demo', async () => {
    const project = await seedPreview();
    store.expire(project.id);

    const claim = await startClaim(project.publicToken, 'warm', { store });
    expect(claim).toMatchObject({ ok: false, status: 410, reason: 'expired' });
  });
});

// ===========================================================================
describe('E8: expired demos remove themselves', () => {
  it('deletes what expired and keeps what a merchant claimed', async () => {
    const a = await createPreview({ url: 'a.myshopify.com' }, { store, fetchOptions: fetchOptions(storefront([product(1)])) });
    const b = await createPreview({ url: 'b.myshopify.com' }, { store, fetchOptions: fetchOptions(storefront([product(2)])) });
    if (!a.ok || !b.ok) throw new Error('seed failed');

    await claimPreview(undefined, 'b.myshopify.com', 'conn-b', { store });
    store.expire(a.project.id);
    store.expire(b.project.id);

    const removed = await store.deleteExpired(new Date().toISOString());

    expect(removed).toBe(1);
    expect(store.projects.map((p) => p.shopDomain)).toEqual(['b.myshopify.com']);
  });
});
