import type { CatalogStore, ShopContext, StoredVariantRef, SyncRun } from '../../services/catalog/catalogStore.js';
import type { CatalogCollection, CatalogProduct, SyncCounts, SyncTrigger } from '../../services/catalog/catalogTypes.js';
import { emptyCounts } from '../../services/catalog/catalogTypes.js';
import { RUN_STALE_AFTER_MS, STALE_RUN_ERROR } from '../../services/catalog/catalogStore.js';

/**
 * In-memory `CatalogStore` that mirrors the SQL semantics of
 * `supabaseCatalogStore`: upsert on (connection_id, shopify_id), soft deletion
 * via `deletedAt`, `lastSeenAt` bookkeeping, and one running sync per shop.
 *
 * Lets the sync algorithm, idempotency and reconciliation be tested for real
 * without a database or any Shopify credentials.
 */

interface ProductRow {
  id: string;
  connectionId: string;
  shopifyId: string;
  title: string;
  handle: string;
  featuredImageUrl: string | null;
  lastSeenAt: string;
  deletedAt: string | null;
}

interface VariantRow {
  id: string;
  productId: string;
  connectionId: string;
  shopifyId: string;
  inventoryItemId: string | null;
  price: string;
  inventoryQuantity: number | null;
  availableForSale: boolean;
  lastSeenAt: string;
  deletedAt: string | null;
}

interface ImageRow {
  id: string;
  productId: string;
  connectionId: string;
  shopifyId: string;
  url: string;
  lastSeenAt: string;
  deletedAt: string | null;
}

interface CollectionRow {
  id: string;
  connectionId: string;
  shopifyId: string;
  title: string;
  handle: string;
  imageUrl: string | null;
  productsCount: number | null;
  lastSeenAt: string;
  deletedAt: string | null;
}

interface LinkRow {
  collectionId: string;
  productId: string;
  connectionId: string;
  position: number;
  lastSeenAt: string;
}

interface RunRow {
  id: string;
  connectionId: string;
  trigger: SyncTrigger;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  heartbeats: number;
  heartbeatAt: number;
  counts: SyncCounts;
  error: string | null;
}

export class MemoryCatalogStore implements CatalogStore {
  products: ProductRow[] = [];
  variants: VariantRow[] = [];
  images: ImageRow[] = [];
  collections: CollectionRow[] = [];
  links: LinkRow[] = [];
  runs: RunRow[] = [];

  private seq = 0;
  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  // ── Sync runs ─────────────────────────────────────────────

  async startSyncRun(ctx: ShopContext, trigger: SyncTrigger): Promise<SyncRun | null> {
    // Mirrors the store: a run whose heartbeat stopped is reclaimed first, so a
    // process that died mid-sync cannot block this shop forever.
    const cutoff = Date.now() - RUN_STALE_AFTER_MS;
    for (const run of this.runs) {
      if (run.connectionId === ctx.connectionId && run.status === 'running' && run.heartbeatAt < cutoff) {
        run.status = 'failed';
        run.finishedAt = new Date().toISOString();
        run.error = STALE_RUN_ERROR;
      }
    }

    // Mirrors the partial unique index: one running row per connection.
    if (this.runs.some((r) => r.connectionId === ctx.connectionId && r.status === 'running')) {
      return null;
    }
    const run: RunRow = {
      id: this.nextId('run'),
      connectionId: ctx.connectionId,
      trigger,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      heartbeats: 0,
      heartbeatAt: Date.now(),
      counts: emptyCounts(),
      error: null,
    };
    this.runs.push(run);
    return { id: run.id, status: 'running' };
  }

  async heartbeatSyncRun(runId: string): Promise<void> {
    const run = this.runs.find((r) => r.id === runId);
    if (!run) return;
    run.heartbeats += 1;
    run.heartbeatAt = Date.now();
  }

  /** Simulates a process that died mid-sync: the row stays 'running', the
   *  heartbeat stops. */
  stallRun(runId: string, ageMs = RUN_STALE_AFTER_MS + 60_000): void {
    const run = this.runs.find((r) => r.id === runId);
    if (run) run.heartbeatAt = Date.now() - ageMs;
  }

  async finishSyncRun(runId: string, counts: SyncCounts, error?: string): Promise<void> {
    const run = this.runs.find((r) => r.id === runId);
    if (!run) return;
    run.status = error ? 'failed' : 'completed';
    run.finishedAt = new Date().toISOString();
    run.counts = counts;
    run.error = error ?? null;
  }

  async getLastSyncRun(connectionId: string) {
    const runs = this.runs.filter((r) => r.connectionId === connectionId);
    const run = runs[runs.length - 1];
    if (!run) return null;
    return {
      id: run.id,
      trigger: run.trigger,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      counts: run.counts,
      error: run.error,
      stale: run.status === 'running' && run.heartbeatAt < Date.now() - RUN_STALE_AFTER_MS,
    };
  }

  // ── Products ──────────────────────────────────────────────

  async upsertProduct(ctx: ShopContext, product: CatalogProduct, seenAt: string) {
    let row = this.products.find((p) => p.connectionId === ctx.connectionId && p.shopifyId === product.shopifyId);

    if (row) {
      row.title = product.title;
      row.handle = product.handle;
      row.featuredImageUrl = product.featuredImageUrl;
      row.lastSeenAt = seenAt;
      row.deletedAt = null; // resurrect if it had been removed
    } else {
      row = {
        id: this.nextId('product'),
        connectionId: ctx.connectionId,
        shopifyId: product.shopifyId,
        title: product.title,
        handle: product.handle,
        featuredImageUrl: product.featuredImageUrl,
        lastSeenAt: seenAt,
        deletedAt: null,
      };
      this.products.push(row);
    }

    for (const variant of product.variants) {
      const existing = this.variants.find(
        (v) => v.connectionId === ctx.connectionId && v.shopifyId === variant.shopifyId,
      );
      if (existing) {
        existing.price = variant.price;
        existing.inventoryItemId = variant.inventoryItemId;
        existing.inventoryQuantity = variant.inventoryQuantity;
        existing.availableForSale = variant.availableForSale;
        existing.lastSeenAt = seenAt;
        existing.deletedAt = null;
      } else {
        this.variants.push({
          id: this.nextId('variant'),
          productId: row.id,
          connectionId: ctx.connectionId,
          shopifyId: variant.shopifyId,
          inventoryItemId: variant.inventoryItemId,
          price: variant.price,
          inventoryQuantity: variant.inventoryQuantity,
          availableForSale: variant.availableForSale,
          lastSeenAt: seenAt,
          deletedAt: null,
        });
      }
    }

    for (const image of product.images) {
      const existing = this.images.find(
        (i) => i.connectionId === ctx.connectionId && i.shopifyId === image.shopifyId,
      );
      if (existing) {
        existing.url = image.url;
        existing.lastSeenAt = seenAt;
        existing.deletedAt = null;
      } else {
        this.images.push({
          id: this.nextId('image'),
          productId: row.id,
          connectionId: ctx.connectionId,
          shopifyId: image.shopifyId,
          url: image.url,
          lastSeenAt: seenAt,
          deletedAt: null,
        });
      }
    }

    // Children no longer present upstream are soft-deleted.
    const now = new Date().toISOString();
    for (const v of this.variants) {
      if (v.productId === row.id && v.deletedAt === null && v.lastSeenAt < seenAt) v.deletedAt = now;
    }
    for (const i of this.images) {
      if (i.productId === row.id && i.deletedAt === null && i.lastSeenAt < seenAt) i.deletedAt = now;
    }

    return {
      productId: row.id,
      variantsUpserted: product.variants.length,
      imagesUpserted: product.images.length,
    };
  }

  async softDeleteProductsNotSeenSince(connectionId: string, seenAt: string): Promise<number> {
    const now = new Date().toISOString();
    let count = 0;
    for (const p of this.products) {
      if (p.connectionId === connectionId && p.deletedAt === null && p.lastSeenAt < seenAt) {
        p.deletedAt = now;
        count += 1;
      }
    }
    return count;
  }

  async softDeleteProduct(connectionId: string, shopifyId: string): Promise<boolean> {
    const row = this.products.find(
      (p) => p.connectionId === connectionId && p.shopifyId === shopifyId && p.deletedAt === null,
    );
    if (!row) return false;
    row.deletedAt = new Date().toISOString();
    return true;
  }

  // ── Collections ───────────────────────────────────────────

  async upsertCollection(ctx: ShopContext, collection: CatalogCollection, seenAt: string) {
    let row = this.collections.find(
      (c) => c.connectionId === ctx.connectionId && c.shopifyId === collection.shopifyId,
    );
    if (row) {
      row.title = collection.title;
      row.handle = collection.handle;
      row.imageUrl = collection.imageUrl;
      row.productsCount = collection.productsCount;
      row.lastSeenAt = seenAt;
      row.deletedAt = null;
    } else {
      row = {
        id: this.nextId('collection'),
        connectionId: ctx.connectionId,
        shopifyId: collection.shopifyId,
        title: collection.title,
        handle: collection.handle,
        imageUrl: collection.imageUrl,
        productsCount: collection.productsCount,
        lastSeenAt: seenAt,
        deletedAt: null,
      };
      this.collections.push(row);
    }
    return { collectionId: row.id };
  }

  async setCollectionProducts(
    ctx: ShopContext,
    collectionId: string,
    productShopifyIds: string[],
    seenAt: string,
  ): Promise<number> {
    let written = 0;
    productShopifyIds.forEach((shopifyId, index) => {
      const product = this.products.find(
        (p) => p.connectionId === ctx.connectionId && p.shopifyId === shopifyId,
      );
      if (!product) return;
      const existing = this.links.find((l) => l.collectionId === collectionId && l.productId === product.id);
      if (existing) {
        existing.position = index;
        existing.lastSeenAt = seenAt;
      } else {
        this.links.push({
          collectionId,
          productId: product.id,
          connectionId: ctx.connectionId,
          position: index,
          lastSeenAt: seenAt,
        });
      }
      written += 1;
    });

    this.links = this.links.filter((l) => !(l.collectionId === collectionId && l.lastSeenAt < seenAt));
    return written;
  }

  async softDeleteCollectionsNotSeenSince(connectionId: string, seenAt: string): Promise<number> {
    const now = new Date().toISOString();
    let count = 0;
    for (const c of this.collections) {
      if (c.connectionId === connectionId && c.deletedAt === null && c.lastSeenAt < seenAt) {
        c.deletedAt = now;
        count += 1;
      }
    }
    return count;
  }

  async softDeleteCollection(connectionId: string, shopifyId: string): Promise<boolean> {
    const row = this.collections.find(
      (c) => c.connectionId === connectionId && c.shopifyId === shopifyId && c.deletedAt === null,
    );
    if (!row) return false;
    row.deletedAt = new Date().toISOString();
    return true;
  }

  // ── Inventory ─────────────────────────────────────────────

  async findVariantByInventoryItem(connectionId: string, inventoryItemId: string): Promise<StoredVariantRef | null> {
    const row = this.variants.find(
      (v) => v.connectionId === connectionId && v.inventoryItemId === inventoryItemId && v.deletedAt === null,
    );
    return row ? { variantId: row.id, productId: row.productId } : null;
  }

  async updateVariantInventory(variantId: string, quantity: number, availableForSale: boolean): Promise<void> {
    const row = this.variants.find((v) => v.id === variantId);
    if (!row) return;
    row.inventoryQuantity = quantity;
    row.availableForSale = availableForSale;
  }

  // ── Reads ─────────────────────────────────────────────────

  async countProducts(connectionId: string): Promise<number> {
    return this.products.filter((p) => p.connectionId === connectionId && p.deletedAt === null).length;
  }

  async listCollections(connectionId: string) {
    return this.collections
      .filter((c) => c.connectionId === connectionId && c.deletedAt === null)
      .map((c) => ({
        id: c.id,
        shopifyId: c.shopifyId,
        title: c.title,
        handle: c.handle,
        imageUrl: c.imageUrl,
        productsCount: c.productsCount,
      }));
  }

  // ── Test conveniences ─────────────────────────────────────

  liveProducts(connectionId: string) {
    return this.products.filter((p) => p.connectionId === connectionId && p.deletedAt === null);
  }

  liveVariants(connectionId: string) {
    return this.variants.filter((v) => v.connectionId === connectionId && v.deletedAt === null);
  }

  liveImages(connectionId: string) {
    return this.images.filter((i) => i.connectionId === connectionId && i.deletedAt === null);
  }
}
