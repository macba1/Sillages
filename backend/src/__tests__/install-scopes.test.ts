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

describe('the new product asks for five scopes and no more', () => {
  it('requests exactly the five it uses', async () => {
    const { scopesForInstall } = await load('social_gallery');
    expect(scopesForInstall().split(',').sort()).toEqual([
      'read_customer_events', 'read_inventory', 'read_orders', 'read_products', 'write_pixels',
    ]);
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

  it('builds an install URL carrying only those five', async () => {
    const { buildInstallUrl } = await load('social_gallery');
    const url = new URL(buildInstallUrl('shop.myshopify.com', 'state-1', {
      clientId: 'cid', clientSecret: 'sec', label: 'dev',
    } as never));

    expect(url.searchParams.get('scope')!.split(',').sort()).toEqual([
      'read_customer_events', 'read_inventory', 'read_orders', 'read_products', 'write_pixels',
    ]);
  });

  it('asks for read_orders but never read_all_orders', async () => {
    // Revenue comes from the signed orders/create webhook, which read_orders
    // covers. read_all_orders reaches back beyond 60 days, needs Shopify's
    // approval, and attribution never looks that far back.
    const { scopesForInstall } = await load('social_gallery');
    const scopes = scopesForInstall().split(',');

    expect(scopes).toContain('read_orders');
    expect(scopes).not.toContain('read_all_orders');
  });

  it('still refuses read_all_orders if something hands it in', async () => {
    process.env.SCOPES = 'read_products,read_all_orders';
    const { scopesForInstall } = await load('social_gallery');
    expect(() => scopesForInstall()).toThrow(/does not use.*read_all_orders/);
  });

  it('leaves the legacy product asking for exactly what it always asked for', async () => {
    const { scopesForInstall } = await load('legacy');
    expect(scopesForInstall()).toBe(BASE_ENV.SHOPIFY_SCOPES);
    expect(scopesForInstall()).toContain('read_all_orders');
  });
});
