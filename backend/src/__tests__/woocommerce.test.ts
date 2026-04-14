/**
 * Tests for WooCommerce connector + plans_v2.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Axios mock ─────────────────────────────────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: mockGet,
      post: mockPost,
      defaults: { auth: { username: 'ck_test', password: 'cs_test' } },
    })),
    get: mockGet,
  },
}));

// ── Supabase mock ──────────────────────────────────────────────────────────

const mockMaybeSingle = vi.fn();
const mockSingle = vi.fn();
const mockSelect = vi.fn().mockReturnThis();
const mockEq = vi.fn().mockReturnThis();
const mockUpdate = vi.fn().mockReturnThis();

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: mockSelect,
      eq: mockEq,
      update: mockUpdate,
      maybeSingle: mockMaybeSingle,
      single: mockSingle,
    })),
  },
}));

// ── Tests ──────────────────────────────────────────────────────────────────

describe('WooCommerce Connector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('connect() returns store info', async () => {
    const { WooCommerceConnector } = await import('../lib/platforms/woocommerce/connector.js');

    mockGet.mockResolvedValueOnce({
      data: {
        environment: { site_title: 'La Pastelería', default_timezone: 'Europe/Madrid' },
        settings: { store_name: 'La Pastelería', currency: 'EUR' },
      },
    });

    const wc = new WooCommerceConnector('https://lapasteleria.com', 'ck_test', 'cs_test');
    const info = await wc.connect();

    expect(info.name).toBe('La Pastelería');
    expect(info.currency).toBe('EUR');
    expect(info.url).toBe('https://lapasteleria.com');
  });

  it('getProducts() returns product list', async () => {
    const { WooCommerceConnector } = await import('../lib/platforms/woocommerce/connector.js');

    mockGet.mockResolvedValueOnce({
      data: [
        { id: 1, name: 'Tarta de Limón', description: 'Artesanal', short_description: 'Sin gluten', type: 'simple', categories: [{ id: 1, name: 'Tartas' }], tags: [], price: '34.90', regular_price: '34.90', images: [{ id: 1, src: 'https://img.com/tarta.jpg', alt: '' }], permalink: 'https://shop.com/tarta' },
      ],
    });

    const wc = new WooCommerceConnector('https://shop.com', 'ck_test', 'cs_test');
    const products = await wc.getProducts();

    expect(products).toHaveLength(1);
    expect(products[0].name).toBe('Tarta de Limón');
    expect(products[0].price).toBe('34.90');
  });

  it('getOrders() returns orders with customer info', async () => {
    const { WooCommerceConnector } = await import('../lib/platforms/woocommerce/connector.js');

    mockGet.mockResolvedValueOnce({
      data: [
        {
          id: 101, status: 'completed', total: '42.90', currency: 'EUR',
          date_created: '2026-04-01T10:00:00',
          billing: { email: 'maria@test.com', first_name: 'María', last_name: 'García' },
          line_items: [{ id: 1, name: 'Tarta', quantity: 1, price: 34.90, product_id: 1, variation_id: 0 }],
        },
      ],
    });

    const wc = new WooCommerceConnector('https://shop.com', 'ck_test', 'cs_test');
    const orders = await wc.getOrders('2026-04-01');

    expect(orders).toHaveLength(1);
    expect(orders[0].billing.email).toBe('maria@test.com');
    expect(orders[0].total).toBe('42.90');
  });

  it('getAbandonedCarts() returns [] if no plugin', async () => {
    const { WooCommerceConnector } = await import('../lib/platforms/woocommerce/connector.js');

    mockGet.mockRejectedValueOnce(new Error('404')); // CartFlows
    mockGet.mockRejectedValueOnce(new Error('404')); // WCAR

    const wc = new WooCommerceConnector('https://shop.com', 'ck_test', 'cs_test');
    const carts = await wc.getAbandonedCarts();

    expect(carts).toEqual([]);
  });

  it('hasCustomerPurchased() returns true when order exists', async () => {
    const { WooCommerceConnector } = await import('../lib/platforms/woocommerce/connector.js');

    mockGet.mockResolvedValueOnce({
      data: [{
        id: 101, status: 'completed', total: '42.90', currency: 'EUR',
        date_created: '2026-04-05T10:00:00',
        billing: { email: 'maria@test.com', first_name: 'María', last_name: 'García' },
        line_items: [],
      }],
    });

    const wc = new WooCommerceConnector('https://shop.com', 'ck_test', 'cs_test');
    const purchased = await wc.hasCustomerPurchased('maria@test.com', '2026-04-01');
    expect(purchased).toBe(true);
  });

  it('hasCustomerPurchased() returns false for cancelled orders', async () => {
    const { WooCommerceConnector } = await import('../lib/platforms/woocommerce/connector.js');

    mockGet.mockResolvedValueOnce({
      data: [{
        id: 101, status: 'cancelled', total: '42.90', currency: 'EUR',
        date_created: '2026-04-05T10:00:00',
        billing: { email: 'maria@test.com', first_name: 'María', last_name: 'García' },
        line_items: [],
      }],
    });

    const wc = new WooCommerceConnector('https://shop.com', 'ck_test', 'cs_test');
    const purchased = await wc.hasCustomerPurchased('maria@test.com', '2026-04-01');
    expect(purchased).toBe(false);
  });

  it('createCoupon() posts to /coupons', async () => {
    const { WooCommerceConnector } = await import('../lib/platforms/woocommerce/connector.js');

    mockPost.mockResolvedValueOnce({ data: { id: 55, code: 'BIENVENIDA10' } });

    const wc = new WooCommerceConnector('https://shop.com', 'ck_test', 'cs_test');
    const result = await wc.createCoupon({ code: 'BIENVENIDA10', type: 'percent', amount: '10' });

    expect(result.code).toBe('BIENVENIDA10');
    expect(result.id).toBe(55);
    expect(mockPost).toHaveBeenCalledWith('/coupons', expect.objectContaining({ code: 'BIENVENIDA10' }));
  });
});

describe('Plans v2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns wc_free defaults when no subscription', async () => {
    const { getPlan } = await import('../lib/plans_v2.js');
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const plan = await getPlan('new-merchant');
    expect(plan.plan_id).toBe('wc_free');
    expect(plan.features.cart_recovery).toBe(true);
    expect(plan.features.welcome_emails).toBe(false);
    expect(plan.limits.cart_recoveries_per_month).toBe(10);
  });

  it('returns wc_pro features when subscribed', async () => {
    const { getPlan, invalidatePlanCache } = await import('../lib/plans_v2.js');
    invalidatePlanCache('pro-merchant');

    mockMaybeSingle.mockResolvedValueOnce({ data: { plan_id: 'wc_pro' }, error: null });
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'wc_pro', name: 'Pro', price_usd: 29,
        features: { dashboard: true, daily_brief: true, cart_recovery: true, welcome_emails: true, weekly_brief: true },
        limits: { cart_recoveries_per_month: -1, welcome_emails_per_month: -1 },
      },
      error: null,
    });

    const plan = await getPlan('pro-merchant');
    expect(plan.plan_id).toBe('wc_pro');
    expect(plan.features.welcome_emails).toBe(true);
    expect(plan.limits.cart_recoveries_per_month).toBe(-1);
  });

  it('hasFeature checks correctly', async () => {
    const { hasFeature, invalidatePlanCache } = await import('../lib/plans_v2.js');
    invalidatePlanCache('free-merchant');

    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    expect(await hasFeature('free-merchant', 'cart_recovery')).toBe(true);
    expect(await hasFeature('free-merchant', 'welcome_emails')).toBe(false);
  });

  it('checkLimit blocks at limit', async () => {
    const { checkLimit, invalidatePlanCache } = await import('../lib/plans_v2.js');
    invalidatePlanCache('limited-merchant');

    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const result = await checkLimit('limited-merchant', 'cart_recoveries_per_month', 10);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('checkLimit allows unlimited (-1)', async () => {
    const { checkLimit, invalidatePlanCache } = await import('../lib/plans_v2.js');
    invalidatePlanCache('unlimited-merchant');

    mockMaybeSingle.mockResolvedValueOnce({ data: { plan_id: 'wc_pro' }, error: null });
    mockSingle.mockResolvedValueOnce({
      data: { id: 'wc_pro', name: 'Pro', price_usd: 29, features: {}, limits: { cart_recoveries_per_month: -1 } },
      error: null,
    });

    const result = await checkLimit('unlimited-merchant', 'cart_recoveries_per_month', 999);
    expect(result.allowed).toBe(true);
  });
});
