import crypto from 'crypto';
import axios from 'axios';
import { env } from '../config/env.js';
import { supabase } from './supabase.js';

// ── Multi-app credential resolution ─────────────────────────────────────────

export interface ShopifyCredentials {
  clientId: string;
  clientSecret: string;
}

/** All known credential sets (primary first, then beta if configured). */
export function getAllShopifyCredentials(): ShopifyCredentials[] {
  const all: ShopifyCredentials[] = [
    { clientId: env.SHOPIFY_API_KEY, clientSecret: env.SHOPIFY_API_SECRET },
  ];
  if (env.SHOPIFY_BETA_API_KEY && env.SHOPIFY_BETA_API_SECRET) {
    all.push({ clientId: env.SHOPIFY_BETA_API_KEY, clientSecret: env.SHOPIFY_BETA_API_SECRET });
  }
  return all;
}

/**
 * Resolves the correct Shopify app credentials based on the client_id.
 * Falls back to the primary app if no clientId is provided or it doesn't match beta.
 */
export function resolveShopifyCredentials(clientId?: string): ShopifyCredentials {
  if (
    clientId &&
    env.SHOPIFY_BETA_API_KEY &&
    env.SHOPIFY_BETA_API_SECRET &&
    clientId === env.SHOPIFY_BETA_API_KEY
  ) {
    return {
      clientId: env.SHOPIFY_BETA_API_KEY,
      clientSecret: env.SHOPIFY_BETA_API_SECRET,
    };
  }

  return {
    clientId: env.SHOPIFY_API_KEY,
    clientSecret: env.SHOPIFY_API_SECRET,
  };
}

/**
 * Tries HMAC validation against all known credential sets.
 * Returns the matching credentials, or null if none match.
 */
export function validateHmacMultiApp(query: Record<string, string>): ShopifyCredentials | null {
  for (const creds of getAllShopifyCredentials()) {
    if (validateHmac(query, creds)) {
      return creds;
    }
  }
  return null;
}

// ── OAuth helpers ────────────────────────────────────────────────────────────

export function buildInstallUrl(shop: string, state: string, credentials?: ShopifyCredentials): string {
  const creds = credentials ?? resolveShopifyCredentials();
  // Use offline access (no per-user) to get permanent shpat_ tokens
  // that don't expire when the merchant's session ends
  const params = new URLSearchParams({
    client_id: creds.clientId,
    scope: env.SHOPIFY_SCOPES,
    redirect_uri: `${env.SHOPIFY_APP_URL}/api/shopify/callback`,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

export function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function validateHmac(query: Record<string, string>, credentials?: ShopifyCredentials): boolean {
  const creds = credentials ?? resolveShopifyCredentials();
  const { hmac, ...rest } = query;
  if (!hmac) return false;

  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('&');

  const digest = crypto
    .createHmac('sha256', creds.clientSecret)
    .update(message)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

export function validateShopDomain(shop: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

// ── Token exchange ────────────────────────────────────────────────────────────

export interface AccessTokenResponse {
  access_token: string;
  scope: string;
  expires_in?: number;
  /** Refresh token — only returned by Custom Distribution apps (online tokens). */
  refresh_token?: string;
  associated_user_scope?: string;
  associated_user?: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    account_owner: boolean;
  };
}

export async function exchangeCodeForToken(
  shop: string,
  code: string,
  credentials?: ShopifyCredentials,
): Promise<AccessTokenResponse> {
  const creds = credentials ?? resolveShopifyCredentials();
  const response = await axios.post<AccessTokenResponse>(
    `https://${shop}/admin/oauth/access_token`,
    {
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
    },
  );
  return response.data;
}

// ── Token refresh (Custom Distribution / online tokens) ─────────────────────

/**
 * Refreshes an online access token using the stored refresh_token.
 * Custom Distribution apps issue online tokens (shpca_) that expire;
 * this rotates the token pair and updates the DB.
 *
 * Returns the new access_token, or null if refresh failed.
 */
export async function refreshShopifyToken(shopDomain: string): Promise<string | null> {
  const LOG = '[token-refresh]';

  // Load connection with refresh_token and app_client_id
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('id, account_id, refresh_token, app_client_id')
    .eq('shop_domain', shopDomain)
    .single();

  if (!conn?.refresh_token) {
    console.log(`${LOG} No refresh_token for ${shopDomain} — cannot refresh`);
    return null;
  }

  const creds = resolveShopifyCredentials(conn.app_client_id ?? undefined);

  try {
    const response = await axios.post<AccessTokenResponse>(
      `https://${shopDomain}/admin/oauth/access_token`,
      {
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: conn.refresh_token,
      },
    );

    const { access_token, refresh_token, expires_in } = response.data;

    // Calculate expiry — default to 24h if Shopify doesn't send expires_in
    const expiresAt = expires_in
      ? new Date(Date.now() + expires_in * 1000).toISOString()
      : new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    await supabase
      .from('shopify_connections')
      .update({
        access_token,
        refresh_token: refresh_token ?? conn.refresh_token, // keep old if not rotated
        token_expires_at: expiresAt,
        token_status: 'active',
        token_failing_since: null,
        token_retry_count: 0,
      })
      .eq('id', conn.id);

    console.log(`${LOG} Token refreshed for ${shopDomain} — new prefix: ${access_token.slice(0, 8)}... expires: ${expiresAt}`);
    return access_token;
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : null;
    const body = axios.isAxiosError(err) ? JSON.stringify(err.response?.data) : '';
    console.error(`${LOG} Refresh FAILED for ${shopDomain} — HTTP ${status} ${body}`);
    return null;
  }
}

/**
 * Checks if a token is expiring soon (within the given threshold) and refreshes proactively.
 * Returns true if token was refreshed or is still valid, false if refresh failed.
 */
export async function ensureTokenFresh(shopDomain: string, thresholdMs = 3600000): Promise<boolean> {
  const LOG = '[token-refresh]';

  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('token_expires_at, refresh_token')
    .eq('shop_domain', shopDomain)
    .single();

  if (!conn) return false;

  // No expiry tracked — token might be offline (shpat_), assume OK
  if (!conn.token_expires_at) return true;

  // No refresh_token — can't refresh
  if (!conn.refresh_token) return true;

  const expiresAt = new Date(conn.token_expires_at).getTime();
  const timeLeft = expiresAt - Date.now();

  if (timeLeft > thresholdMs) {
    return true; // Still fresh
  }

  console.log(`${LOG} ${shopDomain} token expires in ${Math.round(timeLeft / 60000)}min — refreshing proactively`);
  const result = await refreshShopifyToken(shopDomain);
  return result !== null;
}

// ── Shopify REST API client ──────────────────────────────────────────────────

export function shopifyClient(shop: string, accessToken: string) {
  const base = axios.create({
    baseURL: `https://${shop}/admin/api/2024-04`,
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
  });

  return {
    // Shop info
    async getShop() {
      const { data } = await base.get('/shop.json');
      return data.shop as {
        id: number;
        name: string;
        email: string;
        currency: string;
        timezone: string;
        domain: string;
        myshopify_domain: string;
      };
    },

    // Orders for a date range — returns orders + next page cursor
    async getOrders(params: {
      created_at_min: string;
      created_at_max: string;
      status?: string;
      limit?: number;
      fields?: string;
      page_info?: string;
    }): Promise<{ orders: ShopifyOrder[]; nextPageInfo?: string }> {
      const requestParams: Record<string, string | number> = {
        status: 'any',
        limit: 250,
        fields: 'id,total_price,subtotal_price,financial_status,cancel_reason,customer,line_items,refunds,created_at,email',
      };

      // When using page_info cursor, Shopify forbids other filter params
      if (params.page_info) {
        requestParams.page_info = params.page_info;
        requestParams.limit = params.limit ?? 250;
      } else {
        if (params.created_at_min) requestParams.created_at_min = params.created_at_min;
        if (params.created_at_max) requestParams.created_at_max = params.created_at_max;
        if (params.status) requestParams.status = params.status;
        if (params.limit) requestParams.limit = params.limit;
        if (params.fields) requestParams.fields = params.fields;
      }

      const response = await base.get('/orders.json', { params: requestParams });
      const orders = response.data.orders as ShopifyOrder[];

      // Parse Link header for next page cursor
      const linkHeader = response.headers['link'] as string | undefined;
      let nextPageInfo: string | undefined;
      if (linkHeader) {
        const nextMatch = linkHeader.match(/<[^>]+page_info=([^&>]+)[^>]*>;\s*rel="next"/);
        if (nextMatch) nextPageInfo = nextMatch[1];
      }

      return { orders, nextPageInfo };
    },

    // Abandoned checkouts count for date range
    async getAbandonedCheckoutsCount(params: {
      created_at_min: string;
      created_at_max: string;
    }): Promise<number> {
      const { data } = await base.get('/checkouts/count.json', { params });
      return (data.count as number) ?? 0;
    },

    // Abandoned checkouts with details
    async getAbandonedCheckouts(params: {
      created_at_min: string;
      created_at_max: string;
      limit?: number;
    }): Promise<ShopifyAbandonedCheckout[]> {
      try {
        const { data } = await base.get('/checkouts.json', {
          params: {
            created_at_min: params.created_at_min,
            created_at_max: params.created_at_max,
            limit: params.limit ?? 50,
            status: 'open',
          },
        });
        return (data.checkouts ?? []) as ShopifyAbandonedCheckout[];
      } catch {
        return [];
      }
    },

    // Customers count
    async getCustomersCount(params: { created_at_min: string; created_at_max: string }) {
      const { data } = await base.get('/customers/count.json', { params });
      return data.count as number;
    },

    // Products (for brand analysis)
    async getProducts(params?: { limit?: number; fields?: string }): Promise<Array<Record<string, unknown>>> {
      const { data } = await base.get('/products.json', {
        params: {
          limit: params?.limit ?? 50,
          fields: params?.fields ?? 'id,title,body_html,product_type,tags,vendor,handle,variants,images',
        },
      });
      return data.products;
    },

    // Collections
    async getCollections(): Promise<Array<Record<string, unknown>>> {
      const [custom, smart] = await Promise.all([
        base.get('/custom_collections.json', { params: { limit: 50 } }).catch(() => ({ data: { custom_collections: [] } })),
        base.get('/smart_collections.json', { params: { limit: 50 } }).catch(() => ({ data: { smart_collections: [] } })),
      ]);
      return [...(custom.data.custom_collections ?? []), ...(smart.data.smart_collections ?? [])];
    },

    // List all webhooks
    async listWebhooks(): Promise<Array<{ id: number; topic: string; address: string }>> {
      const { data } = await base.get('/webhooks.json');
      return (data.webhooks ?? []) as Array<{ id: number; topic: string; address: string }>;
    },

    // Register a webhook
    async registerWebhook(topic: string, address: string) {
      const { data } = await base.post('/webhooks.json', {
        webhook: { topic, address, format: 'json' },
      });
      return data.webhook as { id: number; topic: string };
    },

    // Delete a webhook
    async deleteWebhook(webhookId: string) {
      await base.delete(`/webhooks/${webhookId}.json`);
    },
  };
}

// ── Shopify connection type (mirrors DB row fields needed by sync) ────────────

export interface ShopifyConnection {
  id: string;
  account_id: string;
  shop_domain: string;
  shop_timezone: string | null;
  access_token: string;
}

// ── Shopify order type (subset of fields we use) ─────────────────────────────

export interface ShopifyOrder {
  id: number;
  total_price: string;
  subtotal_price: string;
  financial_status: string;
  cancel_reason: string | null;
  created_at: string;
  customer: {
    id: number;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    orders_count: number;
  } | null;
  line_items: Array<{
    product_id: number;
    variant_id: number;
    title: string;
    variant_title: string;
    quantity: number;
    price: string;
  }>;
  refunds: Array<{
    transactions: Array<{ amount: string }>;
  }>;
}

export interface ShopifyAbandonedCheckout {
  id: number;
  created_at: string;
  abandoned_checkout_url: string | null;
  customer: {
    id: number;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
  line_items: Array<{
    title: string;
    quantity: number;
    price: string;
    product_id: number | null;
    variant_id: number | null;
  }>;
  total_price: string;
}

// ── HMAC webhook verification ────────────────────────────────────────────────

export function verifyShopifyWebhook(rawBody: Buffer, hmacHeader: string, credentials?: ShopifyCredentials): boolean {
  const creds = credentials ?? resolveShopifyCredentials();
  const digest = crypto
    .createHmac('sha256', creds.clientSecret)
    .update(rawBody)
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
}

// ── Shopify Billing (GraphQL) ────────────────────────────────────────────────

export interface ShopifyBillingPlan {
  name: string;
  price: number;       // monthly USD
  trialDays: number;
}

export const SHOPIFY_PLANS: Record<string, ShopifyBillingPlan> = {
  starter: { name: 'Starter', price: 19, trialDays: 14 },
  growth:  { name: 'Growth',  price: 39, trialDays: 14 },
  pro:     { name: 'Pro',     price: 59, trialDays: 14 },
};

export async function shopifyGraphQL<T>(shop: string, accessToken: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await axios.post(
    `https://${shop}/admin/api/2024-04/graphql.json`,
    { query, variables },
    { headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' } },
  );
  if (response.data.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(response.data.errors)}`);
  }
  return response.data.data as T;
}

/**
 * Creates a recurring app subscription via Shopify Billing API.
 * Returns the confirmation URL where the merchant must approve the charge.
 */
export async function createAppSubscription(
  shop: string,
  accessToken: string,
  planKey: string,
  returnUrl: string,
): Promise<{ confirmationUrl: string; subscriptionId: string }> {
  const plan = SHOPIFY_PLANS[planKey];
  if (!plan) throw new Error(`Unknown plan: ${planKey}`);

  const mutation = `
    mutation appSubscriptionCreate($name: String!, $returnUrl: URL!, $trialDays: Int!, $amount: Decimal!, $currencyCode: CurrencyCode!) {
      appSubscriptionCreate(
        name: $name
        returnUrl: $returnUrl
        trialDays: $trialDays
        test: ${env.NODE_ENV !== 'production' ? 'true' : 'false'}
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: $amount, currencyCode: $currencyCode }
              }
            }
          }
        ]
      ) {
        appSubscription {
          id
        }
        confirmationUrl
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await shopifyGraphQL<{
    appSubscriptionCreate: {
      appSubscription: { id: string } | null;
      confirmationUrl: string | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(shop, accessToken, mutation, {
    name: `Sillages ${plan.name}`,
    returnUrl,
    trialDays: plan.trialDays,
    amount: plan.price.toFixed(1),
    currencyCode: 'USD',
  });

  const result = data.appSubscriptionCreate;
  if (result.userErrors.length > 0) {
    throw new Error(`Billing error: ${result.userErrors.map(e => e.message).join(', ')}`);
  }
  if (!result.confirmationUrl || !result.appSubscription) {
    throw new Error('Shopify did not return a confirmation URL');
  }

  return {
    confirmationUrl: result.confirmationUrl,
    subscriptionId: result.appSubscription.id,
  };
}

/**
 * Fetches the current status of an app subscription.
 */
export async function getAppSubscriptionStatus(
  shop: string,
  accessToken: string,
  subscriptionId: string,
): Promise<{ status: string; trialEndsOn: string | null }> {
  const query = `
    query {
      node(id: "${subscriptionId}") {
        ... on AppSubscription {
          status
          trialDays
          currentPeriodEnd
          createdAt
        }
      }
    }
  `;

  const data = await shopifyGraphQL<{
    node: { status: string; trialDays: number; currentPeriodEnd: string | null; createdAt: string } | null;
  }>(shop, accessToken, query);

  if (!data.node) throw new Error(`Subscription ${subscriptionId} not found`);

  // Calculate trial end from createdAt + trialDays
  const trialEndsOn = data.node.trialDays > 0
    ? new Date(new Date(data.node.createdAt).getTime() + data.node.trialDays * 86400000).toISOString()
    : null;

  return { status: data.node.status, trialEndsOn };
}
