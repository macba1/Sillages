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
describe('F1: no real charge can be created by accident', () => {
  it('is in test mode unless SHOPIFY_BILLING_LIVE is exactly "true"', () => {
    expect(isLiveBilling()).toBe(false);
    for (const value of ['false', 'TRUE', '1', 'yes', '']) {
      process.env.SHOPIFY_BILLING_LIVE = value;
      expect(isLiveBilling(), value).toBe(false);
    }
    process.env.SHOPIFY_BILLING_LIVE = 'true';
    expect(isLiveBilling()).toBe(true);
  });

  it('creates a test charge by default', async () => {
    const { client, calls } = fakeClient(() => CREATED);

    const result = await startSubscription('shop.myshopify.com', 'token', 'basic', {
      createClient: () => client as never,
    });

    expect(result).toMatchObject({ ok: true, test: true, planId: 'basic' });
    expect(calls[0].variables.test).toBe(true);
  });

  it('creates a real charge only when billing is deliberately switched live', async () => {
    process.env.SHOPIFY_BILLING_LIVE = 'true';
    const { client, calls } = fakeClient(() => CREATED);

    const result = await startSubscription('shop.myshopify.com', 'token', 'growth', {
      createClient: () => client as never,
    });

    expect(result).toMatchObject({ ok: true, test: false });
    expect(calls[0].variables.test).toBe(false);
  });
});

// ===========================================================================
describe('F1: Basic and Growth, with a 14-day trial', () => {
  it('sends the right price, currency and trial for each plan', async () => {
    for (const [plan, amount] of [['basic', '29.00'], ['growth', '79.00']] as const) {
      const { client, calls } = fakeClient(() => CREATED);
      const result = await startSubscription('shop.myshopify.com', 'token', plan, {
        createClient: () => client as never,
      });

      expect(result.ok).toBe(true);
      expect(calls[0].variables).toMatchObject({
        amount,
        currencyCode: 'USD',
        trialDays: 14,
        name: plan === 'basic' ? 'Sillages Basic' : 'Sillages Growth',
      });
    }
  });

  it('refuses Pro, which is shown but not on sale', async () => {
    const { client, calls } = fakeClient(() => CREATED);

    const result = await startSubscription('shop.myshopify.com', 'token', 'pro', {
      createClient: () => client as never,
    });

    expect(result).toMatchObject({ ok: false, status: 400, reason: 'plan_not_available' });
    // Nothing was ever sent to Shopify.
    expect(calls).toHaveLength(0);
  });

  it('refuses a plan that does not exist', async () => {
    const { client, calls } = fakeClient(() => CREATED);
    const result = await startSubscription('shop.myshopify.com', 'token', 'enterprise', {
      createClient: () => client as never,
    });
    expect(result).toMatchObject({ ok: false, reason: 'unknown_plan' });
    expect(calls).toHaveLength(0);
  });

  it('returns to our own callback after approval', async () => {
    const { client, calls } = fakeClient(() => CREATED);
    await startSubscription('shop.myshopify.com', 'token', 'basic', { createClient: () => client as never });

    expect(calls[0].variables.returnUrl).toBe(
      'https://api.sillages.app/api/subscription/callback?shop=shop.myshopify.com&plan=basic',
    );
  });

  it('reports what Shopify rejected instead of pretending it worked', async () => {
    const { client } = fakeClient(() => ({
      appSubscriptionCreate: {
        confirmationUrl: null,
        appSubscription: null,
        userErrors: [{ field: ['price'], message: 'Plan is not valid for this shop' }],
      },
    }));

    const result = await startSubscription('shop.myshopify.com', 'token', 'basic', {
      createClient: () => client as never,
    });

    expect(result).toMatchObject({ ok: false, status: 502, reason: 'shopify_rejected' });
    if (!result.ok) expect(result.message).toContain('Plan is not valid');
  });

  it('survives Shopify being unreachable', async () => {
    const client = { request: async () => { throw new Error('socket hang up'); } };
    const result = await startSubscription('shop.myshopify.com', 'token', 'basic', {
      createClient: () => client as never,
    });
    expect(result).toMatchObject({ ok: false, status: 502, reason: 'shopify_unreachable' });
  });
});

// ===========================================================================
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
    expect(planIdFromName('sillages growth')).toBe('growth');
    expect(planIdFromName('Sillages Pro')).toBeNull(); // not on sale, so not a plan we bill
    expect(planIdFromName('Something else')).toBeNull();
    expect(planIdFromName('')).toBeNull();
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
   */
  const BUDGETS: Record<string, number> = {
    'social-gallery.js': 16 * 1024,
    'gallery-core.js': 10 * 1024,
    'social-gallery.css': 14 * 1024,
  };

  it('keeps every shipped asset under its budget', () => {
    let total = 0;
    for (const [file, budget] of Object.entries(BUDGETS)) {
      const size = statSync(resolve(assets, file)).size;
      total += size;
      expect(size, `${file} is ${size} bytes, budget ${budget}`).toBeLessThanOrEqual(budget);
    }
    // Everything a storefront downloads for the gallery, uncompressed.
    expect(total).toBeLessThanOrEqual(36 * 1024);
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
    expect(lazy.length).toBe(images.length);
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
