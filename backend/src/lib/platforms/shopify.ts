import { shopifyClient } from '../shopify.js';
import type {
  PlatformConnector, PlatformType, Product, Order, Customer,
  AbandonedCart, StoreInfo, DiscountParams, SEOData, OrderLineItem,
} from './types.js';
import axios from 'axios';

// ═══════════════════════════════════════════════════════════════════════════
// SHOPIFY CONNECTOR
//
// Wraps the existing shopifyClient() to implement PlatformConnector.
// All Shopify-specific logic stays here — the rest of the codebase uses
// the normalized interface.
// ═══════════════════════════════════════════════════════════════════════════

export class ShopifyConnector implements PlatformConnector {
  readonly platform: PlatformType = 'shopify';
  private client: ReturnType<typeof shopifyClient>;
  private shop: string;
  private accessToken: string;

  constructor(shopDomain: string, accessToken: string) {
    this.shop = shopDomain;
    this.accessToken = accessToken;
    this.client = shopifyClient(shopDomain, accessToken);
  }

  async getStoreInfo(): Promise<StoreInfo> {
    const shop = await this.client.getShop();
    return {
      id: String(shop.id),
      name: shop.name,
      email: shop.email,
      currency: shop.currency,
      timezone: shop.timezone,
      domain: shop.domain,
      platformDomain: shop.myshopify_domain,
    };
  }

  async getProducts(limit = 50): Promise<Product[]> {
    const raw = await this.client.getProducts({ limit });
    return raw.map(p => normalizeProduct(p));
  }

  async getOrders(params: {
    since: string;
    until: string;
    status?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ orders: Order[]; nextCursor?: string }> {
    const result = await this.client.getOrders({
      created_at_min: params.since,
      created_at_max: params.until,
      status: params.status,
      limit: params.limit,
      page_info: params.cursor,
    });
    return {
      orders: result.orders.map(o => normalizeOrder(o as unknown as Record<string, unknown>)),
      nextCursor: result.nextPageInfo,
    };
  }

  async getCustomers(_limit = 50): Promise<Customer[]> {
    // Shopify REST doesn't have a simple customer list endpoint we use.
    // Customers are extracted from orders in practice.
    return [];
  }

  async getAbandonedCarts(params?: {
    since?: string;
    until?: string;
    limit?: number;
  }): Promise<AbandonedCart[]> {
    const checkouts = await this.client.getAbandonedCheckouts({
      created_at_min: params?.since ?? new Date(Date.now() - 30 * 86400 * 1000).toISOString(),
      created_at_max: params?.until ?? new Date().toISOString(),
      limit: params?.limit,
    });
    return checkouts.map(c => normalizeAbandonedCart(c as unknown as Record<string, unknown>));
  }

  async getAbandonedCartsCount(params?: {
    since?: string;
    until?: string;
  }): Promise<number> {
    return this.client.getAbandonedCheckoutsCount({
      created_at_min: params?.since ?? new Date(Date.now() - 30 * 86400 * 1000).toISOString(),
      created_at_max: params?.until ?? new Date().toISOString(),
    });
  }

  async getCollections(): Promise<Array<Record<string, unknown>>> {
    return this.client.getCollections();
  }

  async createDiscount(params: DiscountParams): Promise<{ id: string; code: string }> {
    const base = axios.create({
      baseURL: `https://${this.shop}/admin/api/2024-04`,
      headers: { 'X-Shopify-Access-Token': this.accessToken, 'Content-Type': 'application/json' },
    });

    const priceRule: Record<string, unknown> = {
      title: params.title ?? params.code,
      target_type: 'line_item',
      target_selection: 'all',
      allocation_method: 'across',
      value_type: params.type,
      value: params.type === 'percentage' ? `-${params.value}` : `-${params.value}`,
      customer_selection: 'all',
      starts_at: new Date().toISOString(),
    };
    if (params.usageLimit) priceRule.usage_limit = params.usageLimit;
    if (params.expiresAt) priceRule.ends_at = params.expiresAt;

    const { data: prData } = await base.post('/price_rules.json', { price_rule: priceRule });
    const priceRuleId = prData.price_rule.id;

    const { data: dcData } = await base.post(`/price_rules/${priceRuleId}/discount_codes.json`, {
      discount_code: { code: params.code },
    });

    return { id: String(dcData.discount_code.id), code: dcData.discount_code.code };
  }

  async updateProductSEO(productId: string, seo: SEOData): Promise<void> {
    const base = axios.create({
      baseURL: `https://${this.shop}/admin/api/2024-04`,
      headers: { 'X-Shopify-Access-Token': this.accessToken, 'Content-Type': 'application/json' },
    });

    const update: Record<string, unknown> = {};
    if (seo.metaTitle) update.metafields_global_title_tag = seo.metaTitle;
    if (seo.metaDescription) update.metafields_global_description_tag = seo.metaDescription;
    if (seo.handle) update.handle = seo.handle;

    await base.put(`/products/${productId}.json`, { product: { id: productId, ...update } });
  }

  async hasCustomerPurchased(email: string, sinceDate: string): Promise<boolean> {
    const { orders } = await this.client.getOrders({
      created_at_min: sinceDate,
      created_at_max: new Date().toISOString(),
    });
    return orders.some(
      o => o.customer?.email?.toLowerCase() === email.toLowerCase() &&
           o.financial_status !== 'voided' && !o.cancel_reason,
    );
  }

  async listWebhooks(): Promise<Array<{ id: string; topic: string; address: string }>> {
    const hooks = await this.client.listWebhooks();
    return hooks.map(h => ({ id: String(h.id), topic: h.topic, address: h.address }));
  }

  async registerWebhook(topic: string, callbackUrl: string): Promise<{ id: string; topic: string }> {
    const result = await this.client.registerWebhook(topic, callbackUrl);
    return { id: String(result.id), topic: result.topic };
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    await this.client.deleteWebhook(webhookId);
  }
}

// ── Normalizers ───────────────────────────────────────────────────────────

function normalizeProduct(raw: Record<string, unknown>): Product {
  return {
    id: String(raw.id),
    title: String(raw.title ?? ''),
    description: String(raw.body_html ?? ''),
    productType: String(raw.product_type ?? ''),
    tags: typeof raw.tags === 'string' ? raw.tags.split(', ').filter(Boolean) : [],
    vendor: String(raw.vendor ?? ''),
    handle: String(raw.handle ?? ''),
    variants: ((raw.variants as Array<Record<string, unknown>>) ?? []).map(v => ({
      id: String(v.id),
      title: String(v.title ?? ''),
      price: String(v.price ?? '0'),
      sku: String(v.sku ?? ''),
    })),
    images: ((raw.images as Array<Record<string, unknown>>) ?? []).map(img => ({
      id: String(img.id),
      src: String(img.src ?? ''),
      alt: (img.alt as string) ?? null,
    })),
    raw,
  };
}

function normalizeOrder(raw: Record<string, unknown>): Order {
  const customer = raw.customer as Record<string, unknown> | null;
  const lineItems = (raw.line_items as Array<Record<string, unknown>>) ?? [];
  return {
    id: String(raw.id),
    totalPrice: String(raw.total_price ?? '0'),
    subtotalPrice: String(raw.subtotal_price ?? '0'),
    financialStatus: String(raw.financial_status ?? ''),
    cancelReason: (raw.cancel_reason as string) ?? null,
    customer: customer ? {
      email: String(customer.email ?? ''),
      firstName: (customer.first_name as string) ?? undefined,
      lastName: (customer.last_name as string) ?? undefined,
    } : null,
    lineItems: lineItems.map((li): OrderLineItem => ({
      id: String(li.id),
      title: String(li.title ?? ''),
      quantity: Number(li.quantity ?? 1),
      price: String(li.price ?? '0'),
      productId: li.product_id ? String(li.product_id) : null,
      variantId: li.variant_id ? String(li.variant_id) : null,
    })),
    createdAt: String(raw.created_at ?? ''),
    raw,
  };
}

function normalizeAbandonedCart(raw: Record<string, unknown>): AbandonedCart {
  const lineItems = (raw.line_items as Array<Record<string, unknown>>) ?? [];
  const customer = raw.customer as Record<string, unknown> | undefined;
  return {
    id: String(raw.id ?? raw.token ?? ''),
    customerEmail: String(customer?.email ?? raw.email ?? ''),
    customerName: [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || '',
    totalPrice: Number(raw.total_price ?? 0),
    currency: String(raw.currency ?? 'EUR'),
    products: lineItems.map(li => ({
      title: String(li.title ?? ''),
      quantity: Number(li.quantity ?? 1),
      price: Number(li.price ?? 0),
      imageUrl: undefined,
    })),
    checkoutUrl: String(raw.abandoned_checkout_url ?? ''),
    abandonedAt: String(raw.created_at ?? ''),
    raw,
  };
}
