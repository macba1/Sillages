/**
 * Tests for platform abstraction layer.
 * Verifies that ShopifyConnector correctly wraps shopifyClient and
 * the factory resolves the right connector.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';

const srcDir = path.resolve(process.cwd(), 'src');
const readSrc = (relPath: string) => fs.promises.readFile(path.join(srcDir, relPath), 'utf-8');

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          shop_domain: 'test.myshopify.com',
          access_token: 'shpat_test123',
          shop_name: 'TestShop',
          shop_currency: 'EUR',
          token_status: 'healthy',
        },
        error: null,
      }),
    })),
  },
}));

vi.mock('../lib/shopify.js', () => ({
  shopifyClient: vi.fn(() => ({
    getShop: vi.fn().mockResolvedValue({
      id: 12345, name: 'TestShop', email: 'test@shop.com',
      currency: 'EUR', timezone: 'Europe/Madrid',
      domain: 'testshop.com', myshopify_domain: 'test.myshopify.com',
    }),
    getOrders: vi.fn().mockResolvedValue({
      orders: [{
        id: 1001, total_price: '42.90', subtotal_price: '42.90',
        financial_status: 'paid', cancel_reason: null,
        customer: { email: 'maria@test.com', first_name: 'María', last_name: 'García' },
        line_items: [{ id: 1, title: 'TARTA', quantity: 1, price: '34.90', product_id: 100, variant_id: 200 }],
        created_at: '2026-04-01T10:00:00Z',
      }],
      nextPageInfo: undefined,
    }),
    getProducts: vi.fn().mockResolvedValue([
      { id: 100, title: 'TARTA DE LIMÓN', body_html: 'Tarta artesanal', product_type: 'Pasteles', tags: 'sin gluten, limón', vendor: 'NICOLINA', handle: 'tarta-de-limon', variants: [{ id: 200, title: 'Default', price: '34.90', sku: 'TL001' }], images: [{ id: 300, src: 'https://img.shopify.com/tarta.jpg', alt: null }] },
    ]),
    getAbandonedCheckouts: vi.fn().mockResolvedValue([]),
    getAbandonedCheckoutsCount: vi.fn().mockResolvedValue(3),
    getCollections: vi.fn().mockResolvedValue([{ id: 1, title: 'Pasteles' }]),
    listWebhooks: vi.fn().mockResolvedValue([{ id: 1, topic: 'orders/create', address: 'https://api.sillages.app/webhooks' }]),
    registerWebhook: vi.fn().mockResolvedValue({ id: 2, topic: 'orders/updated' }),
    deleteWebhook: vi.fn().mockResolvedValue(undefined),
  })),
  ensureTokenFresh: vi.fn().mockResolvedValue(true),
}));

vi.mock('../config/env.js', () => ({
  env: {
    SHOPIFY_API_KEY: 'test', SHOPIFY_API_SECRET: 'test',
    SHOPIFY_APP_URL: 'https://test.sillages.app',
    FRONTEND_URL: 'https://test.sillages.app',
  },
}));

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Platform abstraction', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('PlatformConnector interface', () => {
    it('types file exports PlatformConnector interface', async () => {
      const code = await readSrc('lib/platforms/types.ts');
      expect(code).toContain('export interface PlatformConnector');
      expect(code).toContain('getStoreInfo');
      expect(code).toContain('getProducts');
      expect(code).toContain('getOrders');
      expect(code).toContain('getAbandonedCarts');
      expect(code).toContain('hasCustomerPurchased');
      expect(code).toContain('createDiscount');
      expect(code).toContain('updateProductSEO');
      expect(code).toContain('registerWebhook');
    });

    it('types file exports normalized data types', async () => {
      const code = await readSrc('lib/platforms/types.ts');
      expect(code).toContain('export interface Product');
      expect(code).toContain('export interface Order');
      expect(code).toContain('export interface Customer');
      expect(code).toContain('export interface AbandonedCart');
      expect(code).toContain('export interface StoreInfo');
    });
  });

  describe('ShopifyConnector', () => {
    it('implements PlatformConnector with platform=shopify', async () => {
      const { ShopifyConnector } = await import('../lib/platforms/shopify.js');
      const conn = new ShopifyConnector('test.myshopify.com', 'shpat_test');
      expect(conn.platform).toBe('shopify');
    });

    it('getStoreInfo returns normalized StoreInfo', async () => {
      const { ShopifyConnector } = await import('../lib/platforms/shopify.js');
      const conn = new ShopifyConnector('test.myshopify.com', 'shpat_test');
      const info = await conn.getStoreInfo();
      expect(info.id).toBe('12345');
      expect(info.name).toBe('TestShop');
      expect(info.currency).toBe('EUR');
      expect(info.platformDomain).toBe('test.myshopify.com');
    });

    it('getProducts returns normalized Product[]', async () => {
      const { ShopifyConnector } = await import('../lib/platforms/shopify.js');
      const conn = new ShopifyConnector('test.myshopify.com', 'shpat_test');
      const products = await conn.getProducts();
      expect(products).toHaveLength(1);
      expect(products[0].id).toBe('100');
      expect(products[0].title).toBe('TARTA DE LIMÓN');
      expect(products[0].tags).toContain('sin gluten');
      expect(products[0].variants[0].price).toBe('34.90');
      expect(products[0].images[0].src).toContain('shopify.com');
    });

    it('getOrders returns normalized Order[]', async () => {
      const { ShopifyConnector } = await import('../lib/platforms/shopify.js');
      const conn = new ShopifyConnector('test.myshopify.com', 'shpat_test');
      const { orders } = await conn.getOrders({ since: '2026-04-01', until: '2026-04-09' });
      expect(orders).toHaveLength(1);
      expect(orders[0].id).toBe('1001');
      expect(orders[0].totalPrice).toBe('42.90');
      expect(orders[0].customer?.email).toBe('maria@test.com');
      expect(orders[0].lineItems[0].title).toBe('TARTA');
    });

    it('hasCustomerPurchased checks orders', async () => {
      const { ShopifyConnector } = await import('../lib/platforms/shopify.js');
      const conn = new ShopifyConnector('test.myshopify.com', 'shpat_test');
      const hasPurchased = await conn.hasCustomerPurchased('maria@test.com', '2026-04-01');
      expect(hasPurchased).toBe(true);
    });
  });

  describe('Factory', () => {
    it('getConnector returns ShopifyConnector for Shopify accounts', async () => {
      const { getConnector } = await import('../lib/platforms/index.js');
      const connector = await getConnector('test-account');
      expect(connector).not.toBeNull();
      expect(connector!.platform).toBe('shopify');
    });

    it('getConnectorDirect creates connector without DB lookup', async () => {
      const { getConnectorDirect } = await import('../lib/platforms/index.js');
      const connector = getConnectorDirect('shopify', {
        shopDomain: 'test.myshopify.com',
        accessToken: 'shpat_test',
      });
      expect(connector).not.toBeNull();
      expect(connector!.platform).toBe('shopify');
    });

    it('getConnectorDirect returns null for WooCommerce (not yet implemented)', async () => {
      const { getConnectorDirect } = await import('../lib/platforms/index.js');
      const connector = getConnectorDirect('woocommerce', {
        storeUrl: 'https://shop.example.com',
        consumerKey: 'ck_test',
        consumerSecret: 'cs_test',
      });
      expect(connector).toBeNull();
    });
  });
});
