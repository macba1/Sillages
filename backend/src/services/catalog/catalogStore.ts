import type { CatalogCollection, CatalogProduct, SyncCounts, SyncTrigger } from './catalogTypes.js';

/**
 * Persistence contract for the catalogue.
 *
 * The sync algorithm depends on this interface, not on Supabase, so the
 * reconciliation and idempotency rules can be exercised against a real store in
 * tests instead of a mocked query builder.
 */

export interface ShopContext {
  accountId: string;
  connectionId: string;
  shopDomain: string;
}

export interface SyncRun {
  id: string;
  status: 'running' | 'completed' | 'failed';
}

export interface StoredVariantRef {
  variantId: string;
  productId: string;
}

export interface CatalogStore {
  // ── Sync runs ─────────────────────────────────────────────
  /**
   * Opens a run. Returns null when another run is already in flight for this
   * shop — the caller must not start a second concurrent sync.
   */
  startSyncRun(ctx: ShopContext, trigger: SyncTrigger): Promise<SyncRun | null>;
  heartbeatSyncRun(runId: string): Promise<void>;
  finishSyncRun(runId: string, counts: SyncCounts, error?: string): Promise<void>;
  getLastSyncRun(connectionId: string): Promise<{
    id: string;
    trigger: SyncTrigger;
    status: 'running' | 'completed' | 'failed';
    startedAt: string;
    finishedAt: string | null;
    counts: SyncCounts;
    error: string | null;
  } | null>;

  // ── Products ──────────────────────────────────────────────
  /** Insert or update a product and its nested variants/images. Idempotent. */
  upsertProduct(ctx: ShopContext, product: CatalogProduct, seenAt: string): Promise<{
    productId: string;
    variantsUpserted: number;
    imagesUpserted: number;
  }>;
  /** Soft-deletes products (and their children) not touched since `seenAt`. */
  softDeleteProductsNotSeenSince(connectionId: string, seenAt: string): Promise<number>;
  /** Soft-deletes one product by Shopify GID. Used by `products/delete`. */
  softDeleteProduct(connectionId: string, shopifyId: string): Promise<boolean>;

  // ── Collections ───────────────────────────────────────────
  upsertCollection(ctx: ShopContext, collection: CatalogCollection, seenAt: string): Promise<{ collectionId: string }>;
  /** Replaces the membership of a collection with exactly these product GIDs. */
  setCollectionProducts(
    ctx: ShopContext,
    collectionId: string,
    productShopifyIds: string[],
    seenAt: string,
  ): Promise<number>;
  softDeleteCollectionsNotSeenSince(connectionId: string, seenAt: string): Promise<number>;
  softDeleteCollection(connectionId: string, shopifyId: string): Promise<boolean>;

  // ── Inventory ─────────────────────────────────────────────
  /** Resolves the variant that owns a Shopify inventory item. */
  findVariantByInventoryItem(connectionId: string, inventoryItemId: string): Promise<StoredVariantRef | null>;
  updateVariantInventory(variantId: string, quantity: number, availableForSale: boolean): Promise<void>;

  // ── Reads for the UI ──────────────────────────────────────
  countProducts(connectionId: string): Promise<number>;
  listCollections(connectionId: string): Promise<
    { id: string; shopifyId: string; title: string; handle: string; imageUrl: string | null; productsCount: number | null }[]
  >;
}
