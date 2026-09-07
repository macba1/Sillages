import { createCatalogClient, type CatalogClient } from '../../lib/shopifyCatalog.js';
import { fetchCollectionProductIds, fetchProduct } from './catalogFetch.js';
import type { CatalogStore } from './catalogStore.js';
import { resolveShopByDomain, type ResolvedShop } from './catalogContext.js';
import { supabaseCatalogStore } from './supabaseCatalogStore.js';
import type { CatalogCollection } from './catalogTypes.js';

const LOG = '[catalogWebhook]';

/**
 * Catalogue webhook topics. Registered only in `social_gallery` mode; the
 * legacy order/checkout topics live in `services/shopifyWebhooks.ts` and are
 * untouched.
 */
export const CATALOG_WEBHOOK_TOPICS = [
  'products/create',
  'products/update',
  'products/delete',
  'collections/create',
  'collections/update',
  'collections/delete',
  'inventory_levels/update',
] as const;

export type CatalogWebhookTopic = (typeof CATALOG_WEBHOOK_TOPICS)[number];

export function isCatalogWebhookTopic(topic: string): topic is CatalogWebhookTopic {
  return (CATALOG_WEBHOOK_TOPICS as readonly string[]).includes(topic);
}

export interface CatalogWebhookDeps {
  store?: CatalogStore;
  resolveShop?: (shopDomain: string) => Promise<ResolvedShop | null>;
  createClient?: (shop: string, accessToken: string) => CatalogClient;
  now?: () => Date;
}

export type WebhookOutcome =
  | { handled: true; action: 'upserted' | 'deleted' | 'inventory_updated' | 'ignored'; detail?: string }
  | { handled: false; reason: 'unknown_shop' | 'unknown_topic' | 'not_found' | 'malformed' };

/**
 * Applies one catalogue webhook.
 *
 * Product and collection payloads are treated as a *notification*, not as the
 * source of truth: we re-read the entity through GraphQL so the stored row is
 * always the complete, current shape (webhook payloads are REST-shaped and can
 * omit fields the gallery needs). That also makes replays harmless — re-reading
 * and upserting the same entity twice produces the same row.
 */
export async function handleCatalogWebhook(
  topic: string,
  shopDomain: string,
  payload: Record<string, unknown>,
  deps: CatalogWebhookDeps = {},
): Promise<WebhookOutcome> {
  if (!isCatalogWebhookTopic(topic)) {
    return { handled: false, reason: 'unknown_topic' };
  }

  const store = deps.store ?? supabaseCatalogStore;
  const resolveShop = deps.resolveShop ?? resolveShopByDomain;
  const now = deps.now ?? (() => new Date());

  const shop = await resolveShop(shopDomain);
  if (!shop) {
    console.warn(`${LOG} ${topic}: no connection for ${shopDomain}`);
    return { handled: false, reason: 'unknown_shop' };
  }

  const createClient = deps.createClient ?? ((s: string, token: string) => createCatalogClient(s, token));
  const seenAt = now().toISOString();

  switch (topic) {
    case 'products/create':
    case 'products/update': {
      const gid = toProductGid(payload.id ?? payload.admin_graphql_api_id);
      if (!gid) return { handled: false, reason: 'malformed' };

      const client = createClient(shop.shopDomain, shop.accessToken);
      const product = await fetchProduct(client, gid);
      if (!product) {
        // Created and removed before we read it — treat as a deletion.
        await store.softDeleteProduct(shop.connectionId, gid);
        return { handled: true, action: 'deleted', detail: gid };
      }

      await store.upsertProduct(shop, product, seenAt);
      return { handled: true, action: 'upserted', detail: gid };
    }

    case 'products/delete': {
      const gid = toProductGid(payload.id ?? payload.admin_graphql_api_id);
      if (!gid) return { handled: false, reason: 'malformed' };
      const deleted = await store.softDeleteProduct(shop.connectionId, gid);
      return { handled: true, action: deleted ? 'deleted' : 'ignored', detail: gid };
    }

    case 'collections/create':
    case 'collections/update': {
      const gid = toCollectionGid(payload.id ?? payload.admin_graphql_api_id);
      if (!gid) return { handled: false, reason: 'malformed' };

      const collection = collectionFromPayload(gid, payload);
      const { collectionId } = await store.upsertCollection(shop, collection, seenAt);

      // Membership must be re-read: the payload does not carry it.
      const client = createClient(shop.shopDomain, shop.accessToken);
      const productIds = await fetchCollectionProductIds(client, gid);
      await store.setCollectionProducts(shop, collectionId, productIds, seenAt);

      return { handled: true, action: 'upserted', detail: gid };
    }

    case 'collections/delete': {
      const gid = toCollectionGid(payload.id ?? payload.admin_graphql_api_id);
      if (!gid) return { handled: false, reason: 'malformed' };
      const deleted = await store.softDeleteCollection(shop.connectionId, gid);
      return { handled: true, action: deleted ? 'deleted' : 'ignored', detail: gid };
    }

    case 'inventory_levels/update': {
      const inventoryItemGid = toInventoryItemGid(payload.inventory_item_id ?? payload.admin_graphql_api_id);
      const available = payload.available;
      if (!inventoryItemGid || typeof available !== 'number') {
        return { handled: false, reason: 'malformed' };
      }

      const variant = await store.findVariantByInventoryItem(shop.connectionId, inventoryItemGid);
      if (!variant) return { handled: false, reason: 'not_found' };

      // Shopify fires this per location. Writing one location's count as the
      // variant's total, and deriving availability from it, marked multi-location
      // products Sold out while they were still buyable — and ignored variants
      // whose inventory policy lets them oversell. Re-read the product instead:
      // it is one request, and it is the only way to get the real totals.
      const client = createClient(shop.shopDomain, shop.accessToken);
      const product = await fetchProductByInventoryItem(client, store, shop.connectionId, variant.productId);
      if (product) {
        await store.upsertProduct(shop, product, seenAt);
        return { handled: true, action: 'inventory_updated', detail: inventoryItemGid };
      }

      // Falling back to the single-location figure is still better than nothing,
      // but availability is left alone rather than guessed.
      await store.updateVariantInventory(variant.variantId, available, available > 0);
      return { handled: true, action: 'inventory_updated', detail: inventoryItemGid };
    }
  }
}

/**
 * Re-reads the product that owns a variant, so inventory is taken from Shopify's
 * own totals rather than from one location's slice of them.
 */
async function fetchProductByInventoryItem(
  client: CatalogClient,
  store: CatalogStore,
  connectionId: string,
  productId: string,
) {
  const shopifyId = await store.productShopifyId(connectionId, productId);
  if (!shopifyId) return null;
  try {
    return await fetchProduct(client, shopifyId);
  } catch {
    return null;
  }
}

// ── Payload helpers ─────────────────────────────────────────────────────────
// Shopify webhook payloads carry numeric REST ids; the GraphQL API needs GIDs.

function toGid(resource: string, value: unknown): string | null {
  if (typeof value === 'string' && value.startsWith('gid://')) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return `gid://shopify/${resource}/${value}`;
  if (typeof value === 'string' && /^\d+$/.test(value)) return `gid://shopify/${resource}/${value}`;
  return null;
}

const toProductGid = (value: unknown) => toGid('Product', value);
const toCollectionGid = (value: unknown) => toGid('Collection', value);
const toInventoryItemGid = (value: unknown) => toGid('InventoryItem', value);

function collectionFromPayload(gid: string, payload: Record<string, unknown>): CatalogCollection {
  const image = payload.image as { src?: string } | null | undefined;
  return {
    shopifyId: gid,
    title: typeof payload.title === 'string' ? payload.title : '',
    handle: typeof payload.handle === 'string' ? payload.handle : '',
    description: typeof payload.body_html === 'string' ? payload.body_html : null,
    imageUrl: image?.src ?? null,
    sortOrder: typeof payload.sort_order === 'string' ? payload.sort_order : null,
    productsCount: typeof payload.products_count === 'number' ? payload.products_count : null,
    shopifyUpdatedAt: typeof payload.updated_at === 'string' ? payload.updated_at : null,
  };
}
