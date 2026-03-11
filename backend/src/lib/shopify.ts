import crypto from 'crypto';
import axios from 'axios';
import { env } from '../config/env.js';

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
  const params = new URLSearchParams({
    client_id: creds.clientId,
    scope: env.SHOPIFY_SCOPES,
    redirect_uri: `${env.SHOPIFY_APP_URL}/api/shopify/callback`,
    state,
    'grant_options[]': 'per-user',
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
        fields: 'id,total_price,subtotal_price,financial_status,cancel_reason,customer,line_items,refunds,created_at',
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

    // Customers count
    async getCustomersCount(params: { created_at_min: string; created_at_max: string }) {
      const { data } = await base.get('/customers/count.json', { params });
      return data.count as number;
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
