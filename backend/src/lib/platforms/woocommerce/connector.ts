import axios, { type AxiosInstance } from 'axios';

const LOG = '[woocommerce]';

// ═══════════════════════════════════════════════════════════════════════════
// WOOCOMMERCE CONNECTOR
//
// WooCommerce REST API v3 — Basic Auth with Consumer Key / Secret.
// Base: https://store.com/wp-json/wc/v3/
//
// Cart recovery: requires merchant to have a cart tracking plugin
// (CartFlows, WooCommerce Cart Abandonment Recovery, etc.).
// If no plugin, getAbandonedCarts() returns [].
// ═══════════════════════════════════════════════════════════════════════════

export interface WCProduct {
  id: number;
  name: string;
  description: string;
  short_description: string;
  type: string;
  categories: Array<{ id: number; name: string }>;
  tags: Array<{ id: number; name: string }>;
  price: string;
  regular_price: string;
  images: Array<{ id: number; src: string; alt: string }>;
  permalink: string;
}

export interface WCOrder {
  id: number;
  status: string;
  total: string;
  subtotal?: string;
  currency: string;
  date_created: string;
  billing: { email: string; first_name: string; last_name: string };
  line_items: Array<{
    id: number;
    name: string;
    quantity: number;
    price: number;
    product_id: number;
    variation_id: number;
  }>;
}

export interface WCCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  orders_count: number;
  total_spent: string;
  date_created: string;
}

export interface WCStoreInfo {
  name: string;
  description: string;
  url: string;
  currency: string;
  timezone: string;
}

export interface WCAbandonedCart {
  id: string;
  email: string;
  customer_name: string;
  total: number;
  currency: string;
  products: Array<{ title: string; quantity: number; price: number; image_url?: string }>;
  checkout_url: string;
  abandoned_at: string;
}

// ── Connector class ───────────────────────────────────────────────────────

export class WooCommerceConnector {
  private api: AxiosInstance;
  private storeUrl: string;

  constructor(storeUrl: string, consumerKey: string, consumerSecret: string) {
    // Normalize URL
    this.storeUrl = storeUrl.replace(/\/+$/, '');
    this.api = axios.create({
      baseURL: `${this.storeUrl}/wp-json/wc/v3`,
      auth: { username: consumerKey, password: consumerSecret },
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Verify the connection works. Returns store info or throws.
   */
  async connect(): Promise<WCStoreInfo> {
    try {
      const { data } = await this.api.get('/system_status');
      const env = data.environment ?? {};
      const settings = data.settings ?? {};
      return {
        name: settings.store_name ?? env.site_title ?? 'Unknown Store',
        description: settings.store_description ?? '',
        url: this.storeUrl,
        currency: settings.currency ?? 'EUR',
        timezone: env.default_timezone ?? 'UTC',
      };
    } catch (err) {
      // Fallback: try the simpler endpoint
      try {
        const { data } = await this.api.get('/', { params: { _fields: 'store_name,currency' } });
        return {
          name: data.store_name ?? 'Unknown Store',
          description: data.store_description ?? '',
          url: this.storeUrl,
          currency: data.currency ?? 'EUR',
          timezone: 'UTC',
        };
      } catch {
        throw new Error(`Cannot connect to WooCommerce at ${this.storeUrl}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Fetch products (paginated, default 50).
   */
  async getProducts(limit = 50): Promise<WCProduct[]> {
    try {
      const { data } = await this.api.get('/products', {
        params: { per_page: Math.min(limit, 100), status: 'publish', orderby: 'date', order: 'desc' },
      });
      return data as WCProduct[];
    } catch (err) {
      console.error(`${LOG} getProducts failed: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Fetch orders since a given date.
   */
  async getOrders(since?: string, limit = 100): Promise<WCOrder[]> {
    try {
      const params: Record<string, unknown> = {
        per_page: Math.min(limit, 100),
        orderby: 'date',
        order: 'desc',
      };
      if (since) params.after = since;

      const { data } = await this.api.get('/orders', { params });
      return data as WCOrder[];
    } catch (err) {
      console.error(`${LOG} getOrders failed: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Fetch customers.
   */
  async getCustomers(limit = 50): Promise<WCCustomer[]> {
    try {
      const { data } = await this.api.get('/customers', {
        params: { per_page: Math.min(limit, 100), orderby: 'registered_date', order: 'desc' },
      });
      return data as WCCustomer[];
    } catch (err) {
      console.error(`${LOG} getCustomers failed: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Fetch abandoned carts.
   *
   * WooCommerce has no native abandoned cart API.
   * This tries common plugin endpoints:
   *   1. CartFlows: /wp-json/cartflows/v1/abandoned-carts
   *   2. WC Cart Abandonment Recovery: /wp-json/wc-cart-abandonment/v1/carts
   *
   * If none work, returns [] — feature is soft-disabled for this store.
   */
  async getAbandonedCarts(): Promise<WCAbandonedCart[]> {
    // Try CartFlows
    try {
      const { data } = await axios.get(`${this.storeUrl}/wp-json/cartflows/v1/abandoned-carts`, {
        auth: this.api.defaults.auth as { username: string; password: string },
        timeout: 15000,
      });
      if (Array.isArray(data)) {
        return data.map((c: Record<string, unknown>) => this.normalizePluginCart(c, 'cartflows'));
      }
    } catch { /* not available */ }

    // Try WC Cart Abandonment Recovery
    try {
      const { data } = await axios.get(`${this.storeUrl}/wp-json/wc-cart-abandonment/v1/carts`, {
        auth: this.api.defaults.auth as { username: string; password: string },
        timeout: 15000,
        params: { status: 'abandoned' },
      });
      if (Array.isArray(data)) {
        return data.map((c: Record<string, unknown>) => this.normalizePluginCart(c, 'wcar'));
      }
    } catch { /* not available */ }

    console.log(`${LOG} No abandoned cart plugin detected at ${this.storeUrl} — cart recovery disabled`);
    return [];
  }

  /**
   * Check store info (lightweight version).
   */
  async getStoreInfo(): Promise<WCStoreInfo> {
    return this.connect();
  }

  /**
   * Check if a customer has purchased since a given date.
   */
  async hasCustomerPurchased(email: string, sinceDate: string): Promise<boolean> {
    try {
      const orders = await this.getOrders(sinceDate, 50);
      return orders.some(
        o => o.billing.email?.toLowerCase() === email.toLowerCase() &&
             !['cancelled', 'refunded', 'failed'].includes(o.status),
      );
    } catch {
      return true; // fail-closed
    }
  }

  /**
   * Create a coupon (discount code).
   */
  async createCoupon(params: {
    code: string;
    type: 'percent' | 'fixed_cart';
    amount: string;
    usageLimit?: number;
    expiresAt?: string;
  }): Promise<{ id: number; code: string }> {
    const { data } = await this.api.post('/coupons', {
      code: params.code,
      discount_type: params.type,
      amount: params.amount,
      usage_limit: params.usageLimit,
      date_expires: params.expiresAt,
      individual_use: true,
    });
    return { id: data.id, code: data.code };
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private normalizePluginCart(raw: Record<string, unknown>, source: string): WCAbandonedCart {
    if (source === 'cartflows') {
      return {
        id: String(raw.id ?? ''),
        email: String(raw.email ?? ''),
        customer_name: String(raw.customer_name ?? raw.first_name ?? ''),
        total: Number(raw.cart_total ?? raw.total ?? 0),
        currency: String(raw.currency ?? 'EUR'),
        products: this.extractProducts(raw.cart_contents ?? raw.products),
        checkout_url: String(raw.checkout_url ?? ''),
        abandoned_at: String(raw.created_at ?? raw.date ?? ''),
      };
    }

    // wcar (WC Cart Abandonment Recovery)
    return {
      id: String(raw.id ?? ''),
      email: String(raw.email ?? ''),
      customer_name: String(raw.name ?? ''),
      total: Number(raw.cart_total ?? 0),
      currency: 'EUR',
      products: this.extractProducts(raw.cart_contents),
      checkout_url: String(raw.checkout_url ?? ''),
      abandoned_at: String(raw.time ?? raw.created_at ?? ''),
    };
  }

  private extractProducts(raw: unknown): WCAbandonedCart['products'] {
    if (!raw) return [];
    try {
      const items = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(items)) return [];
      return items.map((item: Record<string, unknown>) => ({
        title: String(item.name ?? item.title ?? ''),
        quantity: Number(item.quantity ?? 1),
        price: Number(item.line_total ?? item.price ?? 0),
        image_url: item.image_url as string | undefined,
      }));
    } catch {
      return [];
    }
  }
}
