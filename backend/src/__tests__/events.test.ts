/**
 * Sprint 4 — measurement, interactions and attribution.
 *
 * Acceptance criteria covered here:
 *   D4 view, interaction, variant, cart and purchase events
 *   D7 batched ingestion with a signed token and its own rate limit
 *   D8 measurement collects nothing about a person
 *   D9 the merchant can follow interaction -> cart -> purchase
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PRODUCT_MODE: 'social_gallery',
    SHOPIFY_API_SECRET: 'test-shopify-secret',
    SHOPIFY_APP_URL: 'https://example.test',
  },
}));
vi.mock('../lib/supabase.js', () => ({ supabase: { from: () => { throw new Error('no db in tests'); } } }));

import { issueIngestToken, verifyIngestToken } from '../services/events/ingestToken.js';
import { ingestEventBatch, ingestPurchase } from '../services/events/eventIngestion.js';
import { attributePurchase } from '../services/events/attribution.js';
import { containsForbiddenField } from '../services/events/eventTypes.js';
import { MemoryEventStore } from './helpers/memoryEventStore.js';

const SHOP = 'alpha.myshopify.com';
const RESOLVED = { accountId: 'acc-a', connectionId: 'conn-a', shopDomain: SHOP, accessToken: 'x' };
const SESSION = 'sess-abcdefgh12345678';

let store: MemoryEventStore;

function deps(extra: Record<string, unknown> = {}) {
  return {
    store,
    galleryStore: { getByConnection: async () => ({ id: 'gallery-1' }) } as never,
    resolveShop: async (domain: string) => (domain === SHOP ? RESOLVED : null),
    ...extra,
  };
}

function batch(events: unknown[], overrides: Record<string, unknown> = {}) {
  return { token: issueIngestToken(SHOP), sessionId: SESSION, events, ...overrides };
}

function event(type: string, extra: Record<string, unknown> = {}) {
  return { type, id: `evt-${type}-${Math.random().toString(36).slice(2, 10)}`, occurredAt: new Date().toISOString(), ...extra };
}

beforeEach(() => {
  store = new MemoryEventStore();
});

// ═══════════════════════════════════════════════════════════════════════════
describe('D7: the signed ingest token', () => {
  it('round-trips and carries the shop in the signature', () => {
    const token = issueIngestToken(SHOP);
    expect(verifyIngestToken(token)?.shopDomain).toBe(SHOP);
  });

  it('rejects a tampered token', () => {
    const token = issueIngestToken(SHOP);
    const [payload, signature] = token.split('.');
    const otherShop = Buffer.from('evil.myshopify.com.99999999999999').toString('base64url');

    expect(verifyIngestToken(`${otherShop}.${signature}`)).toBeNull();
    expect(verifyIngestToken(`${payload}.${signature.slice(0, -2)}xx`)).toBeNull();
    expect(verifyIngestToken('nonsense')).toBeNull();
    expect(verifyIngestToken('')).toBeNull();
  });

  it('expires', () => {
    const token = issueIngestToken(SHOP, () => Date.now());
    const wayLater = () => Date.now() + 13 * 60 * 60 * 1000;
    expect(verifyIngestToken(token, wayLater)).toBeNull();
  });

  it('refuses a batch whose token is invalid, without saying why', async () => {
    const result = await ingestEventBatch(batch([event('gallery_view')], { token: 'a'.repeat(40) }), deps());
    expect(result).toEqual({ ok: false, status: 401, reason: 'invalid_or_expired_token' });
    expect(store.events).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('D4: the events a gallery reports', () => {
  it('accepts a batch of the full journey', async () => {
    const result = await ingestEventBatch(
      batch([
        event('gallery_view', { meta: { style: 'warm' } }),
        event('post_view', { productId: 10, meta: { position: 0 } }),
        event('post_open', { productId: 10 }),
        event('variant_select', { productId: 10, variantId: 99 }),
        event('add_to_cart', { productId: 10, variantId: 99 }),
      ]),
      deps(),
    );

    expect(result).toEqual({ ok: true, accepted: 5, stored: 5 });
    expect(store.events.map((e) => e.type)).toEqual([
      'gallery_view', 'post_view', 'post_open', 'variant_select', 'add_to_cart',
    ]);
    expect(store.events.every((e) => e.connectionId === 'conn-a')).toBe(true);
    expect(store.events[0].galleryConfigId).toBe('gallery-1');
  });

  it('credits checkout_started to the pixel, because nothing else can send it', async () => {
    // The gallery script never sees checkout. Storing it as 'gallery' made the
    // Performance screen tell merchants their pixel was "not switched on for
    // your store" while it was reporting.
    await ingestEventBatch(
      batch([event('post_open', { productId: 10 }), event('checkout_started', { productId: 10 })]),
      deps(),
    );

    const bySource = Object.fromEntries(store.events.map((e) => [e.type, e.source]));
    expect(bySource.checkout_started).toBe('web_pixel');
    expect(bySource.post_open).toBe('gallery');
  });

  it('is idempotent: a retried batch stores nothing twice', async () => {
    const payload = batch([event('post_open', { productId: 10 })]);

    await ingestEventBatch(payload, deps());
    const second = await ingestEventBatch(payload, deps());

    expect(store.events).toHaveLength(1);
    expect(second).toEqual({ ok: true, accepted: 1, stored: 0 });
  });

  it('keeps a save as state, not only as a fact', async () => {
    await ingestEventBatch(batch([event('save', { productId: 10, variantId: 99 })]), deps());
    expect(store.saves).toEqual([
      { connectionId: 'conn-a', sessionId: SESSION, productId: 10, variantId: 99 },
    ]);

    await ingestEventBatch(batch([event('unsave', { productId: 10 })]), deps());
    expect(store.saves).toHaveLength(0);
  });

  it('refuses event types only the server may write', async () => {
    const result = await ingestEventBatch(batch([event('purchase', { productId: 10 })]), deps());
    expect(result).toEqual({ ok: true, accepted: 0, stored: 0 });
    expect(store.events).toHaveLength(0);
  });

  it('drops events with an implausible timestamp', async () => {
    const old = { ...event('post_open', { productId: 1 }), occurredAt: '2001-01-01T00:00:00.000Z' };
    const future = { ...event('post_open', { productId: 2 }), occurredAt: new Date(Date.now() + 5 * 86400000).toISOString() };

    const result = await ingestEventBatch(batch([old, future]), deps());
    expect(result).toEqual({ ok: true, accepted: 0, stored: 0 });
  });

  it('caps a batch instead of accepting an unbounded one', async () => {
    const tooMany = Array.from({ length: 51 }, () => event('post_view', { productId: 1 }));
    const result = await ingestEventBatch(batch(tooMany), deps());
    expect(result).toEqual({ ok: false, status: 400, reason: 'malformed_batch' });
  });

  it('ignores a batch for a shop we do not know', async () => {
    const result = await ingestEventBatch(
      { token: issueIngestToken('stranger.myshopify.com'), sessionId: SESSION, events: [event('gallery_view')] },
      deps(),
    );
    expect(result).toEqual({ ok: false, status: 404, reason: 'unknown_shop' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('D8: measurement collects nothing about a person', () => {
  it('rejects the whole batch when anything person-shaped is present', async () => {
    for (const poison of [
      { email: 'a@b.com' },
      { customerId: 42 },
      { events: [{ ...event('post_open'), userAgent: 'Mozilla' }] },
      { meta: { phone: '+34600000000' } },
    ]) {
      const result = await ingestEventBatch({ ...batch([event('gallery_view')]), ...poison }, deps());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('personal_data_not_accepted');
    }
    expect(store.events).toHaveLength(0);
  });

  it('finds a forbidden field however it is nested or cased', () => {
    expect(containsForbiddenField({ a: { b: { Email: 'x' } } })).toBe('Email');
    expect(containsForbiddenField({ user_agent: 'x' })).toBe('user_agent');
    expect(containsForbiddenField({ productId: 1, variantId: 2 })).toBeNull();
  });

  it('refuses any field the contract does not define', async () => {
    const result = await ingestEventBatch(
      { ...batch([{ ...event('post_open'), referrer: 'https://google.com' }]) },
      deps(),
    );
    expect(result).toEqual({ ok: false, status: 400, reason: 'malformed_batch' });
  });

  it('stores no identifier beyond the browser-generated session', async () => {
    await ingestEventBatch(batch([event('post_open', { productId: 10 })]), deps());
    const stored = store.events[0];
    expect(Object.keys(stored)).not.toContain('ip');
    expect(Object.keys(stored)).not.toContain('userAgent');
    expect(stored.sessionId).toBe(SESSION);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('D9: interaction -> cart -> purchase', () => {
  it('credits an order when the cart carried the gallery session', async () => {
    await ingestEventBatch(batch([event('add_to_cart', { productId: 10, variantId: 99 })]), deps());

    const outcome = await attributePurchase(
      {
        connectionId: 'conn-a',
        galleryConfigId: 'gallery-1',
        orderId: 5001,
        sessionId: SESSION,
        amount: 42.5,
        currency: 'EUR',
        purchasedVariantIds: [99],
        occurredAt: new Date().toISOString(),
      },
      { store },
    );

    expect(outcome).toEqual({ attributed: true, match: 'session', variantIds: [99] });
    expect(store.attribution[0].amount).toBe(42.5);
    // The purchase joins the same timeline the funnel is built from.
    expect(store.events.some((e) => e.type === 'purchase' && e.orderId === 5001)).toBe(true);
  });

  it('credits by variant when there is no session marker, and says so', async () => {
    await ingestEventBatch(batch([event('variant_select', { productId: 10, variantId: 99 })]), deps());

    const outcome = await attributePurchase(
      {
        connectionId: 'conn-a', galleryConfigId: null, orderId: 5002, sessionId: null,
        amount: 20, currency: 'EUR', purchasedVariantIds: [99, 123],
        occurredAt: new Date().toISOString(),
      },
      { store },
    );

    expect(outcome).toEqual({ attributed: true, match: 'variant', variantIds: [99] });
  });

  it('does not credit an order that has nothing to do with the gallery', async () => {
    await ingestEventBatch(batch([event('post_open', { productId: 10, variantId: 99 })]), deps());

    const outcome = await attributePurchase(
      {
        connectionId: 'conn-a', galleryConfigId: null, orderId: 5003, sessionId: null,
        amount: 80, currency: 'EUR', purchasedVariantIds: [777],
        occurredAt: new Date().toISOString(),
      },
      { store },
    );

    expect(outcome).toEqual({ attributed: false, reason: 'no_match' });
    expect(store.attribution).toHaveLength(0);
  });

  it('credits an order at most once', async () => {
    await ingestEventBatch(batch([event('add_to_cart', { productId: 10, variantId: 99 })]), deps());
    const input = {
      connectionId: 'conn-a', galleryConfigId: null, orderId: 5004, sessionId: SESSION,
      amount: 30, currency: 'EUR', purchasedVariantIds: [99], occurredAt: new Date().toISOString(),
    };

    expect((await attributePurchase(input, { store })).attributed).toBe(true);
    expect(await attributePurchase(input, { store })).toEqual({ attributed: false, reason: 'already_attributed' });
    expect(store.attribution).toHaveLength(1);
  });

  it('ignores interactions older than the attribution window', async () => {
    store.seedTouched('conn-a', SESSION, 99, Date.now() - 30 * 86400000);

    const outcome = await attributePurchase(
      {
        connectionId: 'conn-a', galleryConfigId: null, orderId: 5005, sessionId: SESSION,
        amount: 30, currency: 'EUR', purchasedVariantIds: [99], occurredAt: new Date().toISOString(),
      },
      { store },
    );

    expect(outcome).toEqual({ attributed: false, reason: 'no_match' });
  });

  it('a purchase reported by the pixel goes through the same gate', async () => {
    await ingestEventBatch(batch([event('add_to_cart', { productId: 10, variantId: 99 })]), deps());

    const result = await ingestPurchase(
      {
        token: issueIngestToken(SHOP),
        sessionId: SESSION,
        orderId: 6001,
        amount: 55,
        currency: 'EUR',
        variantIds: [99],
        occurredAt: new Date().toISOString(),
      },
      deps(),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.outcome.attributed).toBe(true);
  });

  it('refuses a purchase dated outside the plausible window', async () => {
    // A forged purchase dated in the future would otherwise satisfy every
    // reporting window the merchant can select, forever.
    for (const occurredAt of ['2099-01-01T00:00:00.000Z', '2001-01-01T00:00:00.000Z']) {
      const result = await ingestPurchase(
        { token: issueIngestToken(SHOP), orderId: 6100, variantIds: [99], occurredAt },
        deps(),
      );
      expect(result).toEqual({ ok: false, status: 400, reason: 'implausible_timestamp' });
    }
    expect(store.attribution).toHaveLength(0);
  });

  it('refuses a purchase report carrying customer data', async () => {
    const result = await ingestPurchase(
      {
        token: issueIngestToken(SHOP), orderId: 6002, variantIds: [99],
        occurredAt: new Date().toISOString(), email: 'buyer@example.com',
      },
      deps(),
    );
    expect(result).toEqual({ ok: false, status: 400, reason: 'personal_data_not_accepted' });
  });

  it('builds a funnel the merchant can read', async () => {
    await ingestEventBatch(
      batch([
        event('gallery_view'),
        event('post_open', { productId: 10 }),
        event('variant_select', { productId: 10, variantId: 99 }),
        event('add_to_cart', { productId: 10, variantId: 99 }),
      ]),
      deps(),
    );
    await attributePurchase(
      {
        connectionId: 'conn-a', galleryConfigId: null, orderId: 7001, sessionId: SESSION,
        amount: 42, currency: 'EUR', purchasedVariantIds: [99], occurredAt: new Date().toISOString(),
      },
      { store },
    );

    const totals = await store.totals('conn-a', new Date(Date.now() - 86400000).toISOString());
    expect(totals.galleryViews).toBe(1);
    expect(totals.postOpens).toBe(1);
    expect(totals.addToCarts).toBe(1);
    expect(totals.purchases).toBe(1);
    expect(totals.attributedOrders).toBe(1);
    expect(totals.attributedRevenue).toBe(42);
  });

  it('never mixes one shop\'s numbers into another\'s', async () => {
    await ingestEventBatch(batch([event('gallery_view')]), deps());
    const other = await store.totals('conn-b', new Date(Date.now() - 86400000).toISOString());
    expect(other.galleryViews).toBe(0);
    expect(other.sessions).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D1/D2/D3 — the storefront behaviour itself, imported from the extension.
describe('D1-D3: saving, sharing and the event queue in the browser', () => {
  let core: Record<string, (...args: never[]) => never>;

  beforeEach(async () => {
    const file = resolve(__dirname, '../../../extensions/social-gallery/assets/gallery-core.js');
    core = await import(pathToFileURL(file).href);
  });

  function fakeStorage(initial: Record<string, string> = {}) {
    const data = { ...initial };
    return {
      getItem: (k: string) => (k in data ? data[k] : null),
      setItem: (k: string, v: string) => { data[k] = v; },
      data,
    };
  }

  it('creates a session id that identifies nobody, and reuses it', () => {
    const storage = fakeStorage();
    const first = (core.readSession as unknown as (s: unknown) => string)(storage);
    const second = (core.readSession as unknown as (s: unknown) => string)(storage);

    expect(first).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(second).toBe(first);
    expect(JSON.stringify(storage.data)).not.toMatch(/@|\+\d/);
  });

  it('still works when storage is unavailable', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const session = (core.readSession as unknown as (s: unknown) => string)(broken);
    expect(session).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('toggles a save locally, with no account and no request', () => {
    const storage = fakeStorage();
    const toggle = core.toggleSaved as unknown as (s: unknown, shop: string, id: number) => { saved: boolean; list: number[] };
    const read = core.readSaved as unknown as (s: unknown, shop: string) => number[];

    expect(toggle(storage, SHOP, 10)).toEqual({ saved: true, list: [10] });
    expect(read(storage, SHOP)).toEqual([10]);
    expect(toggle(storage, SHOP, 10)).toEqual({ saved: false, list: [] });
    // Saves are per shop.
    toggle(storage, SHOP, 10);
    expect(read(storage, 'beta.myshopify.com')).toEqual([]);
  });

  it('offers a link and WhatsApp always, and the native sheet only when supported', () => {
    const share = core.shareLinks as unknown as (post: unknown, origin: string, native: boolean) => {
      link: string; whatsapp: string; native: unknown;
    };
    const post = { title: 'Candle', url: '/products/candle' };

    const withoutNative = share(post, 'https://shop.example/', false);
    expect(withoutNative.link).toBe('https://shop.example/products/candle');
    expect(withoutNative.whatsapp).toContain('https://wa.me/?text=');
    expect(withoutNative.whatsapp).toContain(encodeURIComponent('https://shop.example/products/candle'));
    expect(withoutNative.native).toBeNull();

    expect(share(post, 'https://shop.example', true).native).toEqual({
      title: 'Candle',
      url: 'https://shop.example/products/candle',
    });
  });

  it('batches events instead of sending one request per interaction', async () => {
    const sent: unknown[][] = [];
    const queue = (core.createEventQueue as unknown as (o: unknown) => {
      push: (t: string, f?: unknown) => Promise<void>;
      flush: () => Promise<void>;
      size: number;
    })({ send: (events: unknown[]) => { sent.push(events); }, maxBatch: 3 });

    await queue.push('post_view', { productId: 1 });
    await queue.push('post_view', { productId: 2 });
    expect(sent).toHaveLength(0); // nothing sent yet

    await queue.push('post_view', { productId: 3 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(3);

    await queue.push('save', { productId: 4 });
    await queue.flush();
    expect(sent).toHaveLength(2);
  });

  it('drops a failed send rather than blocking the storefront', async () => {
    const queue = (core.createEventQueue as unknown as (o: unknown) => {
      push: (t: string) => Promise<void>; flush: () => Promise<void>;
    })({ send: () => Promise.reject(new Error('offline')), maxBatch: 1 });

    await expect(queue.push('gallery_view')).resolves.toBeUndefined();
    await expect(queue.flush()).resolves.toBeUndefined();
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// D5 — the Web Pixel. It runs in Shopify's sandbox and cannot be executed here,
// so its contract is pinned against the source: what it subscribes to, what it
// refuses to send, and that nothing leaves before consent.
describe('D5: the Web Pixel contract', () => {
  const source = readFileSync(
    resolve(__dirname, '../../../extensions/social-gallery-pixel/src/index.js'),
    'utf8',
  );

  it('subscribes only to consent, checkout started and checkout completed', () => {
    const topics = [...source.matchAll(/analytics\.subscribe\('([^']+)'/g)].map((m) => m[1]);
    expect(topics.sort()).toEqual(['checkout_completed', 'checkout_started', 'visitor_consent_collected']);
  });

  it('does not report add-to-cart, which the gallery already reports with the real session', () => {
    // Shopify's add-to-cart event carries no cart attributes, so the pixel
    // cannot know the gallery session. Reporting anyway would double-count
    // every add and inflate the shopper count with invented sessions.
    expect(source).not.toContain("subscribe('product_added_to_cart'");
    expect(source).toContain('Deliberately NOT subscribing');
  });

  it('sends nothing until Shopify allows analytics, and re-checks on consent change', () => {
    expect(source).toMatch(/analyticsProcessingAllowed/);
    expect(source).toMatch(/if \(!allowed\) return/);
    // Consent is re-read when the shopper changes it, not just once at load.
    const consentHandler = source.slice(source.indexOf("subscribe('visitor_consent_collected'"));
    expect(consentHandler).toMatch(/allowed = Boolean/);
  });

  it('reads the gallery session from the cart attribute rather than inventing one', () => {
    expect(source).toContain("SESSION_ATTRIBUTE = '_sillages_sid'");
    // The value is validated before being sent, so a tampered cart attribute
    // cannot become an arbitrary session id.
    expect(source).toMatch(/\^\[A-Za-z0-9_-\]\{8,64\}\$/);
  });

  it('never sends anything person-shaped', () => {
    for (const field of ['email', 'phone', 'customerId', 'firstName', 'lastName', 'address']) {
      expect(source.toLowerCase(), field).not.toContain(`${field.toLowerCase()}:`);
    }
  });

  it('never lets measurement interfere with a purchase', () => {
    // Every send is fire-and-forget with a catch, so a failing endpoint cannot
    // break somebody's checkout.
    expect(source).toMatch(/\.catch\(\(\) => \{/);
    expect(source).toContain('keepalive: true');
  });
});
