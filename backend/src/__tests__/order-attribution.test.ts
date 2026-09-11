/**
 * Attribution from Shopify's signed `orders/create` webhook.
 *
 * The storefront used to report purchases on a public endpoint. Its only
 * credential is the gallery ingest token, which is handed to every visitor of a
 * published gallery, so anyone could post an order id and a total — and because
 * order ids are unique per shop, a forged one permanently blocked the shop's
 * real order from ever being credited.
 *
 * These cover what has to hold now: only Shopify can create revenue, an order
 * is credited exactly once however many times it is delivered, the order of
 * arrival relative to the browser's events does not change the answer, and
 * nothing about a person is stored.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The handler's module graph reaches the Supabase client, which validates the
// environment at import time. Nothing here talks to a database.
vi.mock('../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PRODUCT_MODE: 'social_gallery',
    SHOPIFY_API_SECRET: 'test-shopify-secret',
    SHOPIFY_APP_URL: 'https://example.test',
  },
}));
vi.mock('../lib/supabase.js', () => ({
  supabase: { from: () => { throw new Error('no db in tests'); } },
}));

import { MemoryEventStore } from './helpers/memoryEventStore.js';
import { handleOrderCreated } from '../services/events/orderWebhook.js';
import { ATTRIBUTION_WINDOW_MS } from '../services/events/attribution.js';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const readRepo = (relative: string) =>
  readFileSync(resolve(__dirname, '../../..', relative), 'utf8');

const SHOP = {
  accountId: 'acc-a',
  connectionId: 'conn-a',
  shopDomain: 'shop-a.myshopify.com',
  accessToken: 'token-a',
};

const SESSION = 'sid-abcdefgh';
const VARIANT = 47437951664316;

let store: MemoryEventStore;

const deps = () => ({
  store,
  resolveShop: async (domain: string) => (domain === SHOP.shopDomain ? SHOP : null),
  galleryStore: { getByConnection: async () => ({ id: 'gallery-1' }) as never },
});

/** A Shopify order payload, with the personal fields Shopify really sends. */
function orderPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 6670044528828,
    total_price: '629.95',
    currency: 'USD',
    created_at: new Date().toISOString(),
    line_items: [{ variant_id: VARIANT, quantity: 1 }],
    note_attributes: [{ name: '_sillages_sid', value: SESSION }],
    // Everything below is in a real payload and must never be stored.
    email: 'shopper@example.com',
    phone: '+15125550123',
    customer: { id: 1, first_name: 'QA', last_name: 'Tester', email: 'shopper@example.com' },
    billing_address: { address1: '1 Test Street', city: 'Austin', zip: '78701' },
    shipping_address: { address1: '1 Test Street', city: 'Austin', zip: '78701' },
    browser_ip: '203.0.113.4',
    ...overrides,
  };
}

beforeEach(() => {
  store = new MemoryEventStore();
  store.seedTouched(SHOP.connectionId, SESSION, VARIANT, Date.now() - 60_000);
});

// ===========================================================================
describe('only Shopify can create revenue', () => {
  it('there is no public purchase endpoint left to forge against', () => {
    const router = read('../routes/publicGallery.ts');
    expect(router).not.toMatch(/router\.(post|get|put)\(\s*'\/purchase'/);
    expect(router).not.toContain('ingestPurchase');
  });

  it('the pixel no longer reports purchases from the browser', () => {
    const pixel = readRepo('extensions/social-gallery-pixel/src/index.js');
    expect(pixel).not.toContain('/api/public/purchase');
    expect(pixel).not.toContain("subscribe('checkout_completed'");
  });

  it('the storefront cannot report a purchase through the events endpoint either', async () => {
    const { CLIENT_REPORTABLE_TYPES } = await import('../services/events/eventTypes.js');
    expect(CLIENT_REPORTABLE_TYPES).not.toContain('purchase');
  });

  it('credits an order that carried the gallery session, with the amount Shopify sent', async () => {
    const result = await handleOrderCreated(SHOP.shopDomain, orderPayload(), deps());

    expect(result).toMatchObject({ handled: true, outcome: { attributed: true, match: 'session' } });
    expect(store.attribution).toHaveLength(1);
    expect(store.attribution[0]).toMatchObject({
      orderId: 6670044528828,
      amount: 629.95,
      currency: 'USD',
      match: 'session',
    });
  });

  it('records the purchase as coming from Shopify, not from the pixel', async () => {
    await handleOrderCreated(SHOP.shopDomain, orderPayload(), deps());

    const purchase = store.events.find((e) => e.type === 'purchase');
    expect(purchase?.source).toBe('shopify');
  });
});

// ===========================================================================
describe('an order is credited exactly once', () => {
  it('a redelivered webhook does not double the revenue', async () => {
    const payload = orderPayload();

    const first = await handleOrderCreated(SHOP.shopDomain, payload, deps());
    const second = await handleOrderCreated(SHOP.shopDomain, payload, deps());

    expect(first).toMatchObject({ outcome: { attributed: true } });
    expect(second).toMatchObject({ outcome: { attributed: false, reason: 'already_attributed' } });
    expect(store.attribution).toHaveLength(1);
    expect(store.events.filter((e) => e.type === 'purchase')).toHaveLength(1);
  });

  it('a different total on a redelivery cannot overwrite what was credited', async () => {
    await handleOrderCreated(SHOP.shopDomain, orderPayload(), deps());
    await handleOrderCreated(SHOP.shopDomain, orderPayload({ total_price: '99999.00' }), deps());

    expect(store.attribution).toHaveLength(1);
    expect(store.attribution[0].amount).toBe(629.95);
  });
});

// ===========================================================================
describe('the order of arrival does not change the answer', () => {
  it('credits when the webhook arrives after the browser events', async () => {
    // The default case: seedTouched in beforeEach already happened.
    const result = await handleOrderCreated(SHOP.shopDomain, orderPayload(), deps());
    expect(result).toMatchObject({ outcome: { attributed: true, match: 'session' } });
  });

  it('does not credit when the webhook arrives before anything was browsed', async () => {
    store = new MemoryEventStore(); // no interactions at all
    const result = await handleOrderCreated(SHOP.shopDomain, orderPayload(), deps());

    expect(result).toMatchObject({ outcome: { attributed: false, reason: 'no_match' } });
    expect(store.attribution).toHaveLength(0);
  });

  it('still credits by variant when the cart lost the session marker', async () => {
    const result = await handleOrderCreated(
      SHOP.shopDomain,
      orderPayload({ note_attributes: [] }),
      deps(),
    );

    expect(result).toMatchObject({ outcome: { attributed: true, match: 'variant' } });
  });
});

// ===========================================================================
describe('an order with no correlation is left alone', () => {
  it('is not credited when neither the session nor any variant is ours', async () => {
    const result = await handleOrderCreated(
      SHOP.shopDomain,
      orderPayload({ note_attributes: [], line_items: [{ variant_id: 99999999 }] }),
      deps(),
    );

    expect(result).toMatchObject({ outcome: { attributed: false, reason: 'no_match' } });
    expect(store.attribution).toHaveLength(0);
  });

  it('is not credited when the interaction is older than the window', async () => {
    store = new MemoryEventStore();
    store.seedTouched(
      SHOP.connectionId,
      SESSION,
      VARIANT,
      Date.now() - ATTRIBUTION_WINDOW_MS - 60_000,
    );

    const result = await handleOrderCreated(SHOP.shopDomain, orderPayload(), deps());
    expect(result).toMatchObject({ outcome: { attributed: false, reason: 'no_match' } });
  });

  it('ignores an order for a shop we do not know', async () => {
    const result = await handleOrderCreated('stranger.myshopify.com', orderPayload(), deps());
    expect(result).toEqual({ handled: false, reason: 'unknown_shop' });
  });

  it('refuses a payload without a usable order id', async () => {
    expect(await handleOrderCreated(SHOP.shopDomain, orderPayload({ id: 'not-an-id' }), deps()))
      .toEqual({ handled: false, reason: 'malformed' });
    expect(await handleOrderCreated(SHOP.shopDomain, orderPayload({ id: 0 }), deps()))
      .toEqual({ handled: false, reason: 'malformed' });
  });
});

// ===========================================================================
describe('a forged session attribute cannot invent revenue', () => {
  it('a session that never touched this shop is not credited', async () => {
    const result = await handleOrderCreated(
      SHOP.shopDomain,
      orderPayload({
        note_attributes: [{ name: '_sillages_sid', value: 'sid-forgedxx' }],
        line_items: [{ variant_id: 99999999 }],
      }),
      deps(),
    );

    expect(result).toMatchObject({ outcome: { attributed: false, reason: 'no_match' } });
  });

  it('a malformed session attribute is discarded rather than stored', async () => {
    const result = await handleOrderCreated(
      SHOP.shopDomain,
      orderPayload({ note_attributes: [{ name: '_sillages_sid', value: '<script>x</script>' }] }),
      deps(),
    );

    // Falls back to the variant signal; the bad value never reaches the store.
    expect(result).toMatchObject({ outcome: { attributed: true, match: 'variant' } });
    expect(JSON.stringify(store.attribution)).not.toContain('script');
  });
});

// ===========================================================================
describe('nothing about a person is stored', () => {
  const personal = [
    'shopper@example.com',
    '+15125550123',
    'QA',
    'Tester',
    '1 Test Street',
    'Austin',
    '78701',
    '203.0.113.4',
  ];

  it('no personal field from the order payload reaches the database', async () => {
    await handleOrderCreated(SHOP.shopDomain, orderPayload(), deps());

    const written = JSON.stringify({ attribution: store.attribution, events: store.events });
    for (const value of personal) {
      expect(written, `stored "${value}"`).not.toContain(value);
    }
  });

  it('only the fields attribution needs are read from the order', () => {
    const source = read('../services/events/orderWebhook.ts');

    for (const field of [
      'payload.email',
      'payload.phone',
      'payload.customer',
      'payload.billing_address',
      'payload.shipping_address',
      'payload.browser_ip',
    ]) {
      expect(source, field).not.toContain(field);
    }
  });
});
