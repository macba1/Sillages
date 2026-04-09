// ═══════════════════════════════════════════════════════════════════════════
// PLATFORM CONNECTOR — Shared interface for all e-commerce platforms
//
// Shopify, WooCommerce, BigCommerce all implement this interface.
// The rest of the codebase (agents, orchestrator, scheduler) works through
// this interface — never calls platform APIs directly.
// ═══════════════════════════════════════════════════════════════════════════

export type PlatformType = 'shopify' | 'woocommerce';

// ── Normalized data types ─────────────────────────────────────────────────

export interface Product {
  id: string;
  title: string;
  description: string;
  productType: string;
  tags: string[];
  vendor: string;
  handle: string;
  variants: Array<{
    id: string;
    title: string;
    price: string;
    sku: string;
  }>;
  images: Array<{
    id: string;
    src: string;
    alt: string | null;
  }>;
  raw: Record<string, unknown>;
}

export interface Customer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  ordersCount: number;
  totalSpent: string;
  createdAt: string;
  raw: Record<string, unknown>;
}

export interface OrderLineItem {
  id: string;
  title: string;
  quantity: number;
  price: string;
  productId: string | null;
  variantId: string | null;
}

export interface Order {
  id: string;
  totalPrice: string;
  subtotalPrice: string;
  financialStatus: string;
  cancelReason: string | null;
  customer: { email: string; firstName?: string; lastName?: string } | null;
  lineItems: OrderLineItem[];
  createdAt: string;
  raw: Record<string, unknown>;
}

export interface AbandonedCart {
  id: string;
  customerEmail: string;
  customerName: string;
  totalPrice: number;
  currency: string;
  products: Array<{
    title: string;
    quantity: number;
    price: number;
    imageUrl?: string;
  }>;
  checkoutUrl: string;
  abandonedAt: string;
  raw: Record<string, unknown>;
}

export interface StoreInfo {
  id: string;
  name: string;
  email: string;
  currency: string;
  timezone: string;
  domain: string;
  platformDomain: string; // myshopify.com, store WooCommerce URL, etc.
}

export interface DiscountParams {
  code: string;
  type: 'percentage' | 'fixed_amount';
  value: number;
  title?: string;
  usageLimit?: number;
  expiresAt?: string;
}

export interface SEOData {
  metaTitle?: string;
  metaDescription?: string;
  handle?: string;
}

// ── Platform Connector Interface ──────────────────────────────────────────

export interface PlatformConnector {
  readonly platform: PlatformType;

  // ── Read ────────────────────────────────────────────────────────────────
  getStoreInfo(): Promise<StoreInfo>;
  getProducts(limit?: number): Promise<Product[]>;
  getOrders(params: {
    since: string;
    until: string;
    status?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ orders: Order[]; nextCursor?: string }>;
  getCustomers(limit?: number): Promise<Customer[]>;
  getAbandonedCarts(params?: {
    since?: string;
    until?: string;
    limit?: number;
  }): Promise<AbandonedCart[]>;
  getAbandonedCartsCount(params?: {
    since?: string;
    until?: string;
  }): Promise<number>;
  getCollections(): Promise<Array<Record<string, unknown>>>;

  // ── Write ───────────────────────────────────────────────────────────────
  createDiscount(params: DiscountParams): Promise<{ id: string; code: string }>;
  updateProductSEO(productId: string, seo: SEOData): Promise<void>;

  // ── Customer checks ─────────────────────────────────────────────────────
  hasCustomerPurchased(email: string, sinceDate: string): Promise<boolean>;

  // ── Webhooks ────────────────────────────────────────────────────────────
  listWebhooks(): Promise<Array<{ id: string; topic: string; address: string }>>;
  registerWebhook(topic: string, callbackUrl: string): Promise<{ id: string; topic: string }>;
  deleteWebhook(webhookId: string): Promise<void>;
}

// ── Connection info stored in DB ──────────────────────────────────────────

export interface PlatformConnection {
  accountId: string;
  platform: PlatformType;
  // Shopify
  shopDomain?: string;
  accessToken?: string;
  // WooCommerce
  storeUrl?: string;
  consumerKey?: string;
  consumerSecret?: string;
  // Shared
  shopName?: string;
  shopCurrency?: string;
  tokenStatus?: string;
}
