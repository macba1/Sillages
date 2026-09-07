import axios from 'axios';
import type { AxiosInstance } from 'axios';

/**
 * Shopify GraphQL Admin API client for the social-gallery catalogue.
 *
 * Deliberately separate from `lib/shopify.ts`, which stays pinned to the legacy
 * 2024-04 REST/GraphQL surface. Nothing here is reachable from the legacy
 * product, so migrating the catalogue to a current API version cannot regress
 * briefs, actions or billing.
 */
export const SHOPIFY_CATALOG_API_VERSION = '2026-01';

/** Shopify's documented ceiling for a single `first:` argument. */
const MAX_PAGE_SIZE = 250;

export interface GraphQLPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface ThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: { cost?: { requestedQueryCost: number; throttleStatus: ThrottleStatus } };
}

export class ShopifyGraphQLError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = 'ShopifyGraphQLError';
  }
}

export interface CatalogClientOptions {
  /** Injected in tests so no network call is made. */
  transport?: AxiosInstance;
  maxRetries?: number;
  /** Injected in tests to avoid real waiting. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Leave a safety margin in the leaky bucket. Below this, we pause long enough
 * for the bucket to refill instead of letting Shopify throttle us.
 */
const COST_FLOOR = 200;

export function createCatalogClient(shop: string, accessToken: string, options: CatalogClientOptions = {}) {
  const maxRetries = options.maxRetries ?? 5;
  const sleep = options.sleep ?? defaultSleep;

  const http =
    options.transport ??
    axios.create({
      baseURL: `https://${shop}/admin/api/${SHOPIFY_CATALOG_API_VERSION}`,
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });

  async function request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let attempt = 0;

    for (;;) {
      let body: GraphQLResponse<T>;
      try {
        const response = await http.post<GraphQLResponse<T>>('/graphql.json', { query, variables });
        body = response.data;
      } catch (err) {
        const status = (err as { response?: { status?: number } }).response?.status;
        const retryable = status === 429 || (status !== undefined && status >= 500);
        if (retryable && attempt < maxRetries) {
          attempt += 1;
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new ShopifyGraphQLError(
          `Shopify request failed${status ? ` (HTTP ${status})` : ''}: ${(err as Error).message}`,
          retryable,
        );
      }

      if (body.errors?.length) {
        const throttled = body.errors.some((e) => e.extensions?.code === 'THROTTLED');
        if (throttled && attempt < maxRetries) {
          attempt += 1;
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new ShopifyGraphQLError(
          `Shopify GraphQL error: ${body.errors.map((e) => e.message).join('; ')}`,
          throttled,
        );
      }

      if (!body.data) {
        throw new ShopifyGraphQLError('Shopify GraphQL returned no data', false);
      }

      // Respect the leaky bucket before the next call rather than after a 429.
      const throttle = body.extensions?.cost?.throttleStatus;
      if (throttle && throttle.currentlyAvailable < COST_FLOOR && throttle.restoreRate > 0) {
        const deficit = COST_FLOOR - throttle.currentlyAvailable;
        await sleep(Math.ceil((deficit / throttle.restoreRate) * 1000));
      }

      return body.data;
    }
  }

  return { request, shop, apiVersion: SHOPIFY_CATALOG_API_VERSION, pageSize: MAX_PAGE_SIZE };
}

export type CatalogClient = ReturnType<typeof createCatalogClient>;

function backoffMs(attempt: number): number {
  // 1s, 2s, 4s, 8s, 16s — capped.
  return Math.min(1000 * 2 ** (attempt - 1), 16_000);
}
