import { supabase } from '../../lib/supabase.js';
import {
  RUN_STALE_AFTER_MS,
  STALE_RUN_ERROR,
  type CatalogStore,
  type ShopContext,
  type StoredVariantRef,
  type SyncRun,
} from './catalogStore.js';
import type { CatalogCollection, CatalogProduct, SyncCounts, SyncTrigger } from './catalogTypes.js';
import { emptyCounts } from './catalogTypes.js';

/**
 * Supabase-backed implementation of `CatalogStore`.
 *
 * Kept deliberately thin: one query per operation, no business rules. The sync
 * algorithm lives in `catalogSync.ts` and is tested against an in-memory store.
 */

function toNumeric(value: string | null): number | null {
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export const supabaseCatalogStore: CatalogStore = {
  async startSyncRun(ctx: ShopContext, trigger: SyncTrigger): Promise<SyncRun | null> {
    // Reclaim any run whose process died before inserting a new one. The unique
    // index means a single abandoned row would otherwise freeze this shop's
    // catalogue permanently.
    const staleCutoff = new Date(Date.now() - RUN_STALE_AFTER_MS).toISOString();
    const { data: reclaimed } = await supabase
      .from('catalog_sync_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), error: STALE_RUN_ERROR })
      .eq('connection_id', ctx.connectionId)
      .eq('status', 'running')
      .lt('heartbeat_at', staleCutoff)
      .select('id');

    if (reclaimed && reclaimed.length > 0) {
      console.warn(`[catalogSync] ${ctx.shopDomain}: reclaimed ${reclaimed.length} abandoned sync run(s)`);
    }

    const { data, error } = await supabase
      .from('catalog_sync_runs')
      .insert({
        account_id: ctx.accountId,
        connection_id: ctx.connectionId,
        trigger,
        status: 'running',
      })
      .select('id, status')
      .single();

    if (error) {
      // 23505 = the partial unique index on (connection_id) where status='running'.
      // Another sync is already in flight for this shop.
      if (error.code === '23505') return null;
      throw new Error(`startSyncRun failed: ${error.message}`);
    }
    return { id: data.id as string, status: data.status as SyncRun['status'] };
  },

  async heartbeatSyncRun(runId: string): Promise<void> {
    await supabase
      .from('catalog_sync_runs')
      .update({ heartbeat_at: new Date().toISOString() })
      .eq('id', runId);
  },

  async finishSyncRun(runId: string, counts: SyncCounts, error?: string): Promise<void> {
    await supabase
      .from('catalog_sync_runs')
      .update({
        status: error ? 'failed' : 'completed',
        finished_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
        error: error ?? null,
        products_seen: counts.productsSeen,
        products_upserted: counts.productsUpserted,
        products_deleted: counts.productsDeleted,
        variants_upserted: counts.variantsUpserted,
        images_upserted: counts.imagesUpserted,
        collections_seen: counts.collectionsSeen,
        collections_upserted: counts.collectionsUpserted,
        collections_deleted: counts.collectionsDeleted,
        collection_links_upserted: counts.collectionLinksUpserted,
      })
      .eq('id', runId);
  },

  async getLastSyncRun(connectionId: string) {
    const { data, error } = await supabase
      .from('catalog_sync_runs')
      .select('*')
      .eq('connection_id', connectionId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    const status = data.status as 'running' | 'completed' | 'failed';
    const heartbeatAt = Date.parse((data.heartbeat_at as string) ?? (data.started_at as string));

    return {
      id: data.id as string,
      trigger: data.trigger as SyncTrigger,
      status,
      startedAt: data.started_at as string,
      finishedAt: (data.finished_at as string | null) ?? null,
      error: (data.error as string | null) ?? null,
      // A run that says "running" but stopped reporting is stopped, and the
      // interface must not claim otherwise.
      stale: status === 'running' && Number.isFinite(heartbeatAt) && heartbeatAt < Date.now() - RUN_STALE_AFTER_MS,
      counts: {
        ...emptyCounts(),
        productsSeen: (data.products_seen as number) ?? 0,
        productsUpserted: (data.products_upserted as number) ?? 0,
        productsDeleted: (data.products_deleted as number) ?? 0,
        variantsUpserted: (data.variants_upserted as number) ?? 0,
        imagesUpserted: (data.images_upserted as number) ?? 0,
        collectionsSeen: (data.collections_seen as number) ?? 0,
        collectionsUpserted: (data.collections_upserted as number) ?? 0,
        collectionsDeleted: (data.collections_deleted as number) ?? 0,
        collectionLinksUpserted: (data.collection_links_upserted as number) ?? 0,
      },
    };
  },

  async upsertProduct(ctx: ShopContext, product: CatalogProduct, seenAt: string) {
    const { data, error } = await supabase
      .from('catalog_products')
      .upsert(
        {
          account_id: ctx.accountId,
          connection_id: ctx.connectionId,
          shopify_id: product.shopifyId,
          handle: product.handle,
          title: product.title,
          status: product.status,
          product_type: product.productType,
          vendor: product.vendor,
          tags: product.tags,
          description: product.description,
          online_store_url: product.onlineStoreUrl,
          featured_image_url: product.featuredImageUrl,
          total_inventory: product.totalInventory,
          shopify_updated_at: product.shopifyUpdatedAt,
          last_seen_at: seenAt,
          // A product that comes back after a deletion is restored, not duplicated.
          deleted_at: null,
        },
        { onConflict: 'connection_id,shopify_id' },
      )
      .select('id')
      .single();

    if (error) throw new Error(`upsertProduct failed: ${error.message}`);
    const productId = data.id as string;

    let variantsUpserted = 0;
    if (product.variants.length > 0) {
      const { error: variantError } = await supabase.from('catalog_variants').upsert(
        product.variants.map((variant) => ({
          product_id: productId,
          connection_id: ctx.connectionId,
          shopify_id: variant.shopifyId,
          inventory_item_id: variant.inventoryItemId,
          title: variant.title,
          sku: variant.sku,
          price: toNumeric(variant.price),
          compare_at_price: toNumeric(variant.compareAtPrice),
          available_for_sale: variant.availableForSale,
          inventory_quantity: variant.inventoryQuantity,
          inventory_policy: variant.inventoryPolicy,
          position: variant.position,
          selected_options: variant.selectedOptions,
          image_shopify_id: variant.imageShopifyId,
          last_seen_at: seenAt,
          deleted_at: null,
        })),
        { onConflict: 'connection_id,shopify_id' },
      );
      if (variantError) throw new Error(`upsertVariants failed: ${variantError.message}`);
      variantsUpserted = product.variants.length;
    }

    let imagesUpserted = 0;
    if (product.images.length > 0) {
      const { error: imageError } = await supabase.from('catalog_product_images').upsert(
        product.images.map((image) => ({
          product_id: productId,
          connection_id: ctx.connectionId,
          shopify_id: image.shopifyId,
          url: image.url,
          alt_text: image.altText,
          width: image.width,
          height: image.height,
          position: image.position,
          last_seen_at: seenAt,
          deleted_at: null,
        })),
        { onConflict: 'connection_id,shopify_id' },
      );
      if (imageError) throw new Error(`upsertImages failed: ${imageError.message}`);
      imagesUpserted = product.images.length;
    }

    // Variants and images removed from the product upstream disappear here too.
    const now = new Date().toISOString();
    await supabase
      .from('catalog_variants')
      .update({ deleted_at: now })
      .eq('product_id', productId)
      .is('deleted_at', null)
      .lt('last_seen_at', seenAt);
    await supabase
      .from('catalog_product_images')
      .update({ deleted_at: now })
      .eq('product_id', productId)
      .is('deleted_at', null)
      .lt('last_seen_at', seenAt);

    return { productId, variantsUpserted, imagesUpserted };
  },

  async softDeleteProductsNotSeenSince(connectionId: string, seenAt: string): Promise<number> {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('catalog_products')
      .update({ deleted_at: now })
      .eq('connection_id', connectionId)
      .is('deleted_at', null)
      .lt('last_seen_at', seenAt)
      .select('id');

    if (error) throw new Error(`softDeleteProductsNotSeenSince failed: ${error.message}`);
    return data?.length ?? 0;
  },

  async softDeleteProduct(connectionId: string, shopifyId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('catalog_products')
      .update({ deleted_at: new Date().toISOString() })
      .eq('connection_id', connectionId)
      .eq('shopify_id', shopifyId)
      .is('deleted_at', null)
      .select('id');

    if (error) throw new Error(`softDeleteProduct failed: ${error.message}`);
    return (data?.length ?? 0) > 0;
  },

  async upsertCollection(ctx: ShopContext, collection: CatalogCollection, seenAt: string) {
    const { data, error } = await supabase
      .from('catalog_collections')
      .upsert(
        {
          account_id: ctx.accountId,
          connection_id: ctx.connectionId,
          shopify_id: collection.shopifyId,
          handle: collection.handle,
          title: collection.title,
          description: collection.description,
          image_url: collection.imageUrl,
          sort_order: collection.sortOrder,
          products_count: collection.productsCount,
          shopify_updated_at: collection.shopifyUpdatedAt,
          last_seen_at: seenAt,
          deleted_at: null,
        },
        { onConflict: 'connection_id,shopify_id' },
      )
      .select('id')
      .single();

    if (error) throw new Error(`upsertCollection failed: ${error.message}`);
    return { collectionId: data.id as string };
  },

  async setCollectionProducts(
    ctx: ShopContext,
    collectionId: string,
    productShopifyIds: string[],
    seenAt: string,
  ): Promise<number> {
    if (productShopifyIds.length === 0) {
      await supabase.from('catalog_collection_products').delete().eq('collection_id', collectionId);
      return 0;
    }

    const { data: products, error } = await supabase
      .from('catalog_products')
      .select('id, shopify_id')
      .eq('connection_id', ctx.connectionId)
      .in('shopify_id', productShopifyIds);

    if (error) throw new Error(`setCollectionProducts lookup failed: ${error.message}`);

    const byShopifyId = new Map((products ?? []).map((p) => [p.shopify_id as string, p.id as string]));
    const rows = productShopifyIds
      .map((shopifyId, index) => {
        const productId = byShopifyId.get(shopifyId);
        return productId
          ? {
              collection_id: collectionId,
              product_id: productId,
              connection_id: ctx.connectionId,
              position: index,
              last_seen_at: seenAt,
            }
          : null;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (rows.length > 0) {
      const { error: upsertError } = await supabase
        .from('catalog_collection_products')
        .upsert(rows, { onConflict: 'collection_id,product_id' });
      if (upsertError) throw new Error(`setCollectionProducts failed: ${upsertError.message}`);
    }

    // Products no longer in the collection lose their membership row.
    await supabase
      .from('catalog_collection_products')
      .delete()
      .eq('collection_id', collectionId)
      .lt('last_seen_at', seenAt);

    return rows.length;
  },

  async softDeleteCollectionsNotSeenSince(connectionId: string, seenAt: string): Promise<number> {
    const { data, error } = await supabase
      .from('catalog_collections')
      .update({ deleted_at: new Date().toISOString() })
      .eq('connection_id', connectionId)
      .is('deleted_at', null)
      .lt('last_seen_at', seenAt)
      .select('id');

    if (error) throw new Error(`softDeleteCollectionsNotSeenSince failed: ${error.message}`);
    return data?.length ?? 0;
  },

  async softDeleteCollection(connectionId: string, shopifyId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('catalog_collections')
      .update({ deleted_at: new Date().toISOString() })
      .eq('connection_id', connectionId)
      .eq('shopify_id', shopifyId)
      .is('deleted_at', null)
      .select('id');

    if (error) throw new Error(`softDeleteCollection failed: ${error.message}`);
    return (data?.length ?? 0) > 0;
  },

  async findVariantByInventoryItem(connectionId: string, inventoryItemId: string): Promise<StoredVariantRef | null> {
    const { data, error } = await supabase
      .from('catalog_variants')
      .select('id, product_id')
      .eq('connection_id', connectionId)
      .eq('inventory_item_id', inventoryItemId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !data) return null;
    return { variantId: data.id as string, productId: data.product_id as string };
  },

  async updateVariantInventory(variantId: string, quantity: number, availableForSale: boolean): Promise<void> {
    const { error } = await supabase
      .from('catalog_variants')
      .update({ inventory_quantity: quantity, available_for_sale: availableForSale })
      .eq('id', variantId);
    if (error) throw new Error(`updateVariantInventory failed: ${error.message}`);
  },

  async countProducts(connectionId: string): Promise<number> {
    const { count, error } = await supabase
      .from('catalog_products')
      .select('id', { count: 'exact', head: true })
      .eq('connection_id', connectionId)
      .is('deleted_at', null);

    if (error) return 0;
    return count ?? 0;
  },

  async listCollections(connectionId: string) {
    const { data, error } = await supabase
      .from('catalog_collections')
      .select('id, shopify_id, title, handle, image_url, products_count')
      .eq('connection_id', connectionId)
      .is('deleted_at', null)
      .order('title', { ascending: true });

    if (error || !data) return [];
    return data.map((row) => ({
      id: row.id as string,
      shopifyId: row.shopify_id as string,
      title: row.title as string,
      handle: row.handle as string,
      imageUrl: (row.image_url as string | null) ?? null,
      productsCount: (row.products_count as number | null) ?? null,
    }));
  },
};
