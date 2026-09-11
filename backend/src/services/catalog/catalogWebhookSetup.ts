import { createCatalogClient, type CatalogClient } from '../../lib/shopifyCatalog.js';
import { env } from '../../config/env.js';
import { CATALOG_WEBHOOK_TOPICS } from './catalogWebhooks.js';

/**
 * Topics registered for the new product: the catalogue ones plus
 * `app/uninstalled`, which must keep working in every mode.
 */
export const SOCIAL_GALLERY_WEBHOOK_TOPICS = [
  ...CATALOG_WEBHOOK_TOPICS,
  'app/uninstalled',
  // Without this a cancellation, a declined payment or an expired trial never
  // reaches us and the gallery keeps serving indefinitely.
  'app_subscriptions/update',
  // The only source of purchases and revenue. Signed by Shopify, so it cannot
  // be forged the way the old public endpoint could.
  'orders/create',
] as const;

const LOG = '[catalogWebhookSetup]';

/**
 * Registers the catalogue webhook topics through the current GraphQL Admin API.
 *
 * Separate from `services/shopifyWebhooks.ts`, which registers the legacy
 * order/checkout topics over REST 2024-04 and is left untouched.
 */

/** GraphQL enum values for the topics we register. */
const TOPIC_TO_ENUM: Record<string, string> = {
  'products/create': 'PRODUCTS_CREATE',
  'products/update': 'PRODUCTS_UPDATE',
  'products/delete': 'PRODUCTS_DELETE',
  'collections/create': 'COLLECTIONS_CREATE',
  'collections/update': 'COLLECTIONS_UPDATE',
  'collections/delete': 'COLLECTIONS_DELETE',
  'inventory_levels/update': 'INVENTORY_LEVELS_UPDATE',
  'app/uninstalled': 'APP_UNINSTALLED',
  'app_subscriptions/update': 'APP_SUBSCRIPTIONS_UPDATE',
  'orders/create': 'ORDERS_CREATE',
};

const LIST_QUERY = `
  query CatalogWebhooks($first: Int!) {
    webhookSubscriptions(first: $first) {
      nodes {
        id
        topic
        endpoint { ... on WebhookHttpEndpoint { callbackUrl } }
      }
    }
  }
`;

const CREATE_MUTATION = `
  mutation CatalogWebhookCreate($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
    webhookSubscriptionCreate(
      topic: $topic
      webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
    ) {
      webhookSubscription { id topic }
      userErrors { field message }
    }
  }
`;

export interface WebhookSetupResult {
  registered: string[];
  alreadyPresent: string[];
  failed: { topic: string; message: string }[];
}

export function catalogWebhookCallbackUrl(): string {
  return `${env.SHOPIFY_APP_URL}/api/webhooks/shopify`;
}

export async function registerCatalogWebhooks(
  shopDomain: string,
  accessToken: string,
  options: { createClient?: (shop: string, token: string) => CatalogClient } = {},
): Promise<WebhookSetupResult> {
  const client = (options.createClient ?? createCatalogClient)(shopDomain, accessToken);
  const callbackUrl = catalogWebhookCallbackUrl();

  const result: WebhookSetupResult = { registered: [], alreadyPresent: [], failed: [] };

  let existing: Set<string>;
  try {
    existing = await listRegisteredTopics(client, callbackUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${LOG} ${shopDomain}: could not list webhooks (${message}) — attempting registration anyway`);
    existing = new Set();
  }

  for (const topic of SOCIAL_GALLERY_WEBHOOK_TOPICS) {
    const topicEnum = TOPIC_TO_ENUM[topic];
    if (existing.has(topicEnum)) {
      result.alreadyPresent.push(topic);
      continue;
    }

    try {
      const data = await client.request<{
        webhookSubscriptionCreate: {
          webhookSubscription: { id: string } | null;
          userErrors: { field: string[] | null; message: string }[];
        };
      }>(CREATE_MUTATION, { topic: topicEnum, callbackUrl });

      const errors = data.webhookSubscriptionCreate.userErrors;
      if (errors.length > 0) {
        // Shopify reports an existing identical subscription as a user error.
        if (errors.some((e) => /already|taken/i.test(e.message))) {
          result.alreadyPresent.push(topic);
        } else {
          result.failed.push({ topic, message: errors.map((e) => e.message).join('; ') });
        }
        continue;
      }

      result.registered.push(topic);
    } catch (err) {
      result.failed.push({ topic, message: err instanceof Error ? err.message : String(err) });
    }
  }

  console.log(
    `${LOG} ${shopDomain}: registered=${result.registered.length} ` +
      `alreadyPresent=${result.alreadyPresent.length} failed=${result.failed.length}`,
  );
  return result;
}

async function listRegisteredTopics(client: CatalogClient, callbackUrl: string): Promise<Set<string>> {
  const data = await client.request<{
    webhookSubscriptions: {
      nodes: { id: string; topic: string; endpoint: { callbackUrl?: string } | null }[];
    };
  }>(LIST_QUERY, { first: 100 });

  return new Set(
    data.webhookSubscriptions.nodes
      .filter((node) => node.endpoint?.callbackUrl === callbackUrl)
      .map((node) => node.topic),
  );
}
