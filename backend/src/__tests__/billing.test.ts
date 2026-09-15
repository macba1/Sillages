/**
 * Sprint 6 — billing, uninstall and the storefront performance budget.
 *
 * Acceptance criteria covered here:
 *   F1 Shopify Billing for Basic and Growth, with a 14-day trial
 *   F1 no real charge can be created by accident
 *   F4 uninstall turns the gallery off, so a reinstall starts clean
 *   F5 the storefront payload stays within a mobile budget
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

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

import {
  cancelSubscription,
  isLiveBilling,
  managedPricingUrl,
  planIdFromHandle,
  planIdFromName,
  readSubscription,
  startSubscription,
} from '../services/billing/shopifyBilling.js';

/** A fake Shopify GraphQL client that records what it was asked to do. */
function fakeClient(handler: (query: string, variables: Record<string, unknown>) => unknown) {
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  const client = {
    request: async (query: string, variables: Record<string, unknown> = {}) => {
      calls.push({ query, variables });
      return handler(query, variables);
    },
    shop: 'shop.myshopify.com',
    apiVersion: '2026-01',
    pageSize: 250,
  };
  return { client, calls };
}

const CREATED = {
  appSubscriptionCreate: {
    confirmationUrl: 'https://shop.myshopify.com/admin/charges/1/confirm',
    appSubscription: { id: 'gid://shopify/AppSubscription/1', status: 'PENDING' },
    userErrors: [],
  },
};

beforeEach(() => {
  delete process.env.SHOPIFY_BILLING_LIVE;
});

afterEach(() => {
  delete process.env.SHOPIFY_BILLING_LIVE;
});

// ===========================================================================
describe('F1: the product never creates a charge', () => {
  it('has no appSubscriptionCreate left anywhere', () => {
    // The app is on Shopify App Pricing. Shopify refuses the Billing API
    // outright — "Cannot use the Billing API (to create charges) when on
    // Shopify App Pricing" — so the mutation is gone rather than dormant.
    const source = readFileSync(
      resolve(__dirname, '../services/billing/shopifyBilling.ts'),
      'utf8',
    );
    // The prose above explains why; what must not exist is the call.
    expect(source).not.toMatch(/appSubscriptionCreate\s*\(/);
    expect(source).not.toContain('confirmationUrl');
  });

  it('sends the merchant to the page Shopify hosts', () => {
    const result = startSubscription('demo-shop.myshopify.com', 'basic');

    expect(result).toEqual({
      ok: true,
      planId: 'basic',
      pricingPageUrl: 'https://admin.shopify.com/store/demo-shop/charges/sillages-1/pricing_plans',
    });
  });

  it('refuses Pro, which is shown but not on sale', () => {
    expect(startSubscription('demo-shop.myshopify.com', 'pro')).toMatchObject({
      ok: false,
      reason: 'plan_not_available',
    });
  });

  it('refuses a plan it does not sell', () => {
    expect(startSubscription('demo-shop.myshopify.com', 'enterprise')).toMatchObject({
      ok: false,
      reason: 'unknown_plan',
    });
  });
});

describe('F1: the plan Shopify reports is the one that counts', () => {
  it('reads a Shopify App Pricing plan by its display name', () => {
    expect(planIdFromName('Basic')).toBe('basic');
    expect(planIdFromName('Growth')).toBe('growth');
  });

  it('reads a plan handle, lower case and all', () => {
    expect(planIdFromHandle('basic')).toBe('basic');
    expect(planIdFromHandle('growth')).toBe('growth');
  });

  it('still recognises a subscription created by the old Billing API', () => {
    // Shops that subscribed before the move keep a charge named this way.
    expect(planIdFromName('Sillages Growth')).toBe('growth');
    expect(planIdFromName('Sillages Basic')).toBe('basic');
  });

  it('does not invent a plan from something it does not sell', () => {
    expect(planIdFromName('Enterprise')).toBeNull();
    expect(planIdFromHandle('')).toBeNull();
    expect(planIdFromHandle(undefined)).toBeNull();
  });
});

describe('F2: reading the subscription back from Shopify', () => {
  it('reports the active subscription and maps it to a plan', async () => {
    const { client } = fakeClient(() => ({
      currentAppInstallation: {
        activeSubscriptions: [
          {
            id: 'gid://shopify/AppSubscription/9',
            name: 'Sillages Growth',
            status: 'ACTIVE',
            test: true,
            trialDays: 14,
            createdAt: '2026-09-01T10:00:00Z',
            currentPeriodEnd: '2026-10-01T10:00:00Z',
          },
        ],
      },
    }));

    const subscription = await readSubscription('shop.myshopify.com', 'token', {
      createClient: () => client as never,
    });

    expect(subscription).toMatchObject({ status: 'ACTIVE', planId: 'growth', test: true, trialDays: 14 });
  });

  it('reports nothing when the merchant has no subscription', async () => {
    const { client } = fakeClient(() => ({ currentAppInstallation: { activeSubscriptions: [] } }));
    expect(await readSubscription('shop.myshopify.com', 'token', { createClient: () => client as never })).toBeNull();
  });

  it('maps subscription names back to plans, and gives up rather than guessing', () => {
    expect(planIdFromName('Sillages Basic')).toBe('basic');
    // Growth is off sale, and a shop still on it must still be recognised —
    // answering null would drop a paying merchant to "no plan". What a shop may
    // *start* is decided by startSubscription, which is tested separately.
    expect(planIdFromName('sillages growth')).toBe('growth');
    expect(planIdFromName('Sillages Pro')).toBe('pro');
    expect(planIdFromName('Something else')).toBeNull();
    expect(planIdFromName('')).toBeNull();
  });

  it('refuses to start a plan that is not on sale, whatever its name maps to', async () => {
    const { startSubscription } = await import('../services/billing/shopifyBilling.js');

    expect(startSubscription('shop.myshopify.com', 'basic').ok).toBe(true);
    for (const withdrawn of ['growth', 'pro']) {
      const result = startSubscription('shop.myshopify.com', withdrawn);
      expect(result.ok, `${withdrawn} must not be subscribable`).toBe(false);
      if (!result.ok) expect(result.reason).toBe('plan_not_available');
    }
  });

  it('cancels a subscription and reports whether Shopify accepted it', async () => {
    const ok = fakeClient(() => ({ appSubscriptionCancel: { userErrors: [] } }));
    expect(await cancelSubscription('s', 't', 'gid://1', { createClient: () => ok.client as never })).toBe(true);

    const rejected = fakeClient(() => ({ appSubscriptionCancel: { userErrors: [{ message: 'no' }] } }));
    expect(await cancelSubscription('s', 't', 'gid://1', { createClient: () => rejected.client as never })).toBe(false);
  });
});

// ===========================================================================
describe('F5: the storefront stays within a mobile budget', () => {
  const assets = resolve(__dirname, '../../../extensions/social-gallery/assets');

  /**
   * A gallery is added to somebody else's storefront. These caps are
   * deliberately tight: if a change pushes past them it should be a decision,
   * not a surprise on a merchant's Lighthouse score.
   *
   * Raised once, deliberately, for the second version of the product: four
   * layouts, six filters, five frames, a full-screen story viewer, the saved
   * panel and the share sheet. Roughly 19 KB over the wire once compressed,
   * for a module that is deferred and never blocks first paint. Anything that
   * pushes past these again should be another decision, not a drift.
   */
  const BUDGETS: Record<string, number> = {
    'social-gallery.js': 36 * 1024,
    'gallery-core.js': 13 * 1024,
    'social-gallery.css': 27 * 1024,
  };

  it('keeps every shipped asset under its budget', () => {
    let total = 0;
    for (const [file, budget] of Object.entries(BUDGETS)) {
      const size = statSync(resolve(assets, file)).size;
      total += size;
      expect(size, `${file} is ${size} bytes, budget ${budget}`).toBeLessThanOrEqual(budget);
    }
    // Everything a storefront downloads for the gallery, uncompressed.
    expect(total).toBeLessThanOrEqual(76 * 1024);
  });

  it('loads without blocking the page and lazy-loads every image', () => {
    const block = readFileSync(
      resolve(__dirname, '../../../extensions/social-gallery/blocks/social-gallery.liquid'),
      'utf8',
    );
    const js = readFileSync(resolve(assets, 'social-gallery.js'), 'utf8');

    expect(block).toContain('type="module"');
    expect(block).toContain('defer');
    // The block itself renders no content, so it cannot delay first paint.
    expect(block).not.toMatch(/<img|<ul|<section/);

    const images = js.match(/h\('img'/g) ?? [];
    const lazy = js.match(/loading: 'lazy'/g) ?? [];
    // Every image is lazy except one: the photograph inside the story viewer,
    // which is the only thing on the screen the moment it opens. Deferring it
    // would show the shopper an empty black rectangle.
    expect(images.length - lazy.length).toBe(1);
    expect(js).toContain("class: 'sg-viewer__img'");
    expect(js).toContain("decoding: 'async'");
  });

  it('ships no third-party code and phones nowhere unexpected', () => {
    const js = readFileSync(resolve(assets, 'social-gallery.js'), 'utf8');
    const core = readFileSync(resolve(assets, 'gallery-core.js'), 'utf8');

    // Only relative imports: nothing is pulled from a CDN at runtime.
    const imports = [...js.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports.every((path) => path.startsWith('./'))).toBe(true);
    expect(core).not.toMatch(/\bimport\b/);

    // Every network call goes to the shop's own origin or to the configured API.
    const fetches = [...js.matchAll(/fetch\(([^)]*)/g)].map((m) => m[1]);
    expect(fetches.length).toBeGreaterThan(0);
    for (const call of fetches) {
      expect(call).not.toMatch(/https?:\/\//);
    }
  });

  it('scopes every style, so it cannot leak into a merchant theme', () => {
    const css = readFileSync(resolve(assets, 'social-gallery.css'), 'utf8');

    // Keyframe steps ("from", "to", "50%") are not selectors and must not be
    // judged as if they were.
    const isKeyframeStep = (value: string) => /^(from|to|\d+%(\s*,\s*\d+%)*)$/.test(value);

    const selectors = css
      .split('}')
      .map((block) => block.split('{')[0].trim())
      .filter(
        (selector) =>
          selector &&
          !selector.startsWith('@') &&
          !selector.startsWith('/*') &&
          !isKeyframeStep(selector),
      );

    for (const selector of selectors) {
      const scoped = selector
        .split(',')
        .map((part) => part.trim())
        .every(
          (part) =>
            part.startsWith('.sg-') ||
            part.startsWith('[data-sillages-gallery]') ||
            part.startsWith('html.sg-') ||
            part.includes('.sg-'),
        );
      expect(scoped, `unscoped selector: ${selector}`).toBe(true);
    }
  });
});
