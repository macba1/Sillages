/**
 * Install scopes.
 *
 * A social_gallery install was asking merchants for the legacy twelve scopes —
 * read_all_orders, read_customers, write_products among them — because the
 * install URL read SHOPIFY_SCOPES, whose default is that legacy string. It was
 * caught by looking at the `scope=` parameter of a real Shopify authorize page,
 * not by any test, so here are the tests.
 *
 * Asking for a permission the product does not use is both an App Store review
 * failure and a promise to the merchant that is not kept.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const BASE_ENV = {
  NODE_ENV: 'test',
  SHOPIFY_API_KEY: 'key',
  SHOPIFY_API_SECRET: 'secret',
  SHOPIFY_APP_URL: 'https://example.test',
  FRONTEND_URL: 'http://localhost:5173',
  SHOPIFY_SCOPES:
    'read_all_orders,read_products,write_products,read_customers,write_customers,' +
    'read_analytics,read_inventory,read_reports,read_pixels,write_discounts,' +
    'read_checkouts,write_marketing_events',
};

async function load(mode: 'legacy' | 'social_gallery') {
  vi.resetModules();
  vi.doMock('../config/env.js', () => ({ env: { ...BASE_ENV, PRODUCT_MODE: mode } }));
  vi.doMock('../lib/supabase.js', () => ({ supabase: {} }));
  return import('../lib/shopify.js');
}

beforeEach(() => {
  delete process.env.SCOPES;
});

afterEach(() => {
  delete process.env.SCOPES;
  vi.doUnmock('../config/env.js');
  vi.doUnmock('../lib/supabase.js');
  vi.resetModules();
});

describe('the new product asks for two scopes and no more', () => {
  it('requests exactly the two it uses', async () => {
    const { scopesForInstall } = await load('social_gallery');
    expect(scopesForInstall().split(',').sort()).toEqual(['read_inventory', 'read_products']);
  });

  it('ignores the legacy default even when the environment supplies it', async () => {
    const { scopesForInstall } = await load('social_gallery');
    const scopes = scopesForInstall();
    for (const legacy of ['read_all_orders', 'read_customers', 'write_products', 'read_checkouts']) {
      expect(scopes, legacy).not.toContain(legacy);
    }
  });

  it('honours what the Shopify CLI supplies', async () => {
    process.env.SCOPES = 'read_products,read_inventory';
    const { scopesForInstall } = await load('social_gallery');
    expect(scopesForInstall()).toBe('read_products,read_inventory');
  });

  it('refuses outright if anything hands it a scope the product does not use', async () => {
    // Closed rather than filtered: silently dropping a scope would hide a
    // misconfiguration that belongs in front of a person.
    process.env.SCOPES = 'read_products,write_products';
    const { scopesForInstall } = await load('social_gallery');
    expect(() => scopesForInstall()).toThrow(/does not use.*write_products/);
  });

  it('builds an install URL carrying only those two', async () => {
    const { buildInstallUrl } = await load('social_gallery');
    const url = new URL(buildInstallUrl('shop.myshopify.com', 'state-1', {
      clientId: 'cid', clientSecret: 'sec', label: 'dev',
    } as never));

    expect(url.searchParams.get('scope')!.split(',').sort()).toEqual(['read_inventory', 'read_products']);
  });

  it('asks for nothing the public app has not already been granted', async () => {
    // This launch ships over the existing public app. Its granted scopes are
    // the legacy set; requesting anything outside it would re-prompt every
    // installed merchant for a permission the gallery does not use.
    const granted = BASE_ENV.SHOPIFY_SCOPES.split(',');
    const { scopesForInstall } = await load('social_gallery');

    for (const scope of scopesForInstall().split(',')) {
      expect(granted, scope).toContain(scope);
    }
  });

  it('does not create a Web Pixel while write_pixels is not requested', async () => {
    const { webPixelAvailable, DEFERRED_MEASUREMENT_SCOPES } = await load('social_gallery');

    expect(webPixelAvailable()).toBe(false);
    expect([...DEFERRED_MEASUREMENT_SCOPES]).toEqual(['write_pixels', 'read_customer_events']);
  });

  it('leaves the legacy product asking for exactly what it always asked for', async () => {
    const { scopesForInstall } = await load('legacy');
    expect(scopesForInstall()).toBe(BASE_ENV.SHOPIFY_SCOPES);
    expect(scopesForInstall()).toContain('read_all_orders');
  });
});
