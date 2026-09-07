/**
 * Sprint 1 validation — `supabaseCatalogStore` against a REAL Supabase.
 *
 * The other catalogue suites exercise the sync algorithm against an in-memory
 * store. This one exercises the actual Supabase implementation: PostgREST
 * upserts with `onConflict`, the partial unique index that serialises syncs,
 * the `.lt('last_seen_at', ...)` reconciliation filters and the numeric casts.
 *
 * Skipped unless a local Supabase is running, so `npm test` stays green without
 * Docker. To run it:
 *
 *   cd <scratch>/sbdev && supabase start
 *   # apply supabase/schema.sql then supabase/migrations/*.sql
 *   SUPABASE_TEST_URL=http://127.0.0.1:54321 \
 *   SUPABASE_TEST_SERVICE_KEY=<local service_role key> \
 *   npx vitest run src/__tests__/catalog-store.integration.test.ts
 *
 * It never points at production: the guard below refuses any non-local URL.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CatalogStore, ShopContext } from '../services/catalog/catalogStore.js';

const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_KEY = process.env.SUPABASE_TEST_SERVICE_KEY;

/** Hard stop: this suite writes data, so it may only ever talk to localhost. */
function isLocal(url: string): boolean {
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url.replace(/\/$/, ''));
}

const enabled = Boolean(TEST_URL && TEST_KEY && isLocal(TEST_URL));

let db: SupabaseClient;
let store: CatalogStore;
let runCatalogSync: typeof import('../services/catalog/catalogSync.js')['runCatalogSync'];
let createCatalogClient: typeof import('../lib/shopifyCatalog.js')['createCatalogClient'];
let makeDevStore: typeof import('./helpers/fakeShopify.js')['makeDevStore'];

let ctx: ShopContext;
let userId: string;

describe.skipIf(!enabled)('supabaseCatalogStore against a real Supabase', () => {
  beforeAll(async () => {
    db = createClient(TEST_URL!, TEST_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

    vi.doMock('../lib/supabase.js', () => ({ supabase: db }));
    vi.doMock('../config/env.js', () => ({
      env: { NODE_ENV: 'test', PRODUCT_MODE: 'social_gallery', SHOPIFY_APP_URL: 'https://example.test' },
    }));

    ({ supabaseCatalogStore: store } = await import('../services/catalog/supabaseCatalogStore.js') as
      { supabaseCatalogStore: CatalogStore });
    ({ runCatalogSync } = await import('../services/catalog/catalogSync.js'));
    ({ createCatalogClient } = await import('../lib/shopifyCatalog.js'));
    ({ makeDevStore } = await import('./helpers/fakeShopify.js'));

    // ── Seed one merchant and one connected shop ──────────────
    const email = `catalog-int-${Date.now()}@dev.local`;
    const { data: user, error: userError } = await db.auth.admin.createUser({
      email,
      password: 'dev-only-password',
      email_confirm: true,
    });
    if (userError) throw new Error(`seed user failed: ${userError.message}`);
    userId = user.user.id;

    const { data: account, error: accountError } = await db
      .from('accounts')
      .upsert({ user_id: userId, email }, { onConflict: 'user_id' })
      .select('id')
      .single();
    if (accountError) throw new Error(`seed account failed: ${accountError.message}`);

    const shopDomain = `int-${Date.now()}.myshopify.com`;
    const { data: connection, error: connectionError } = await db
      .from('shopify_connections')
      .insert({
        account_id: account.id,
        shop_domain: shopDomain,
        access_token: 'dev-only-token',
        scopes: 'read_products,read_inventory',
      })
      .select('id')
      .single();
    if (connectionError) throw new Error(`seed connection failed: ${connectionError.message}`);

    ctx = { accountId: account.id, connectionId: connection.id, shopDomain };
  }, 60_000);

  afterAll(async () => {
    if (!enabled || !userId) return;
    // Cascades remove the connection and the whole catalogue.
    await db.auth.admin.deleteUser(userId);
  });

  function syncDeps(shop: ReturnType<typeof makeDevStore>, now?: () => Date) {
    return {
      store,
      now,
      createClient: (domain: string, token: string) =>
        createCatalogClient(domain, token, { transport: shop.transport, sleep: async () => {} }),
    };
  }

  it('imports a 137-product store into real tables', async () => {
    const shop = makeDevStore(137);

    const outcome = await runCatalogSync(ctx, 'dev-token', 'install', syncDeps(shop));

    expect(outcome.status).toBe('completed');
    expect(await store.countProducts(ctx.connectionId)).toBe(137);

    const { count: variantCount } = await db
      .from('catalog_variants')
      .select('id', { count: 'exact', head: true })
      .eq('connection_id', ctx.connectionId)
      .is('deleted_at', null);
    expect(variantCount).toBe(274);

    const { count: imageCount } = await db
      .from('catalog_product_images')
      .select('id', { count: 'exact', head: true })
      .eq('connection_id', ctx.connectionId)
      .is('deleted_at', null);
    expect(imageCount).toBe(274);
  }, 120_000);

  it('stores prices as numerics, not strings', async () => {
    const { data } = await db
      .from('catalog_variants')
      .select('price, inventory_quantity, selected_options')
      .eq('connection_id', ctx.connectionId)
      .limit(1)
      .single();

    expect(Number(data!.price)).toBeGreaterThan(0);
    expect(typeof data!.inventory_quantity).toBe('number');
    expect(Array.isArray(data!.selected_options)).toBe(true);
  });

  it('re-syncing is idempotent through PostgREST upserts', async () => {
    const shop = makeDevStore(137);
    const clock = () => new Date(Date.now() + 60_000);

    const outcome = await runCatalogSync(ctx, 'dev-token', 'reconciliation', syncDeps(shop, clock));

    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') expect(outcome.counts.productsDeleted).toBe(0);
    expect(await store.countProducts(ctx.connectionId)).toBe(137);
  }, 120_000);

  it('reconciliation soft-deletes what disappeared upstream', async () => {
    const shop = makeDevStore(137);
    const removed = [...shop.products.keys()][0];
    shop.removeProduct(removed);

    const outcome = await runCatalogSync(ctx, 'dev-token', 'reconciliation', syncDeps(shop, () => new Date(Date.now() + 120_000)));

    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') expect(outcome.counts.productsDeleted).toBe(1);
    expect(await store.countProducts(ctx.connectionId)).toBe(136);

    const { data } = await db
      .from('catalog_products')
      .select('deleted_at')
      .eq('connection_id', ctx.connectionId)
      .eq('shopify_id', removed)
      .single();
    expect(data!.deleted_at).not.toBeNull();
  }, 120_000);

  it('the partial unique index really serialises syncs', async () => {
    const first = await store.startSyncRun(ctx, 'manual');
    expect(first).not.toBeNull();

    const second = await store.startSyncRun(ctx, 'manual');
    expect(second).toBeNull(); // the DB constraint, not application logic

    await store.finishSyncRun(first!.id, {
      productsSeen: 0, productsUpserted: 0, productsDeleted: 0, variantsUpserted: 0,
      imagesUpserted: 0, collectionsSeen: 0, collectionsUpserted: 0, collectionsDeleted: 0,
      collectionLinksUpserted: 0,
    });

    const third = await store.startSyncRun(ctx, 'manual');
    expect(third).not.toBeNull();
    await store.finishSyncRun(third!.id, {
      productsSeen: 0, productsUpserted: 0, productsDeleted: 0, variantsUpserted: 0,
      imagesUpserted: 0, collectionsSeen: 0, collectionsUpserted: 0, collectionsDeleted: 0,
      collectionLinksUpserted: 0,
    });
  });

  it('resolves a variant from its inventory item and updates stock', async () => {
    const { data: variant } = await db
      .from('catalog_variants')
      .select('id, inventory_item_id')
      .eq('connection_id', ctx.connectionId)
      .not('inventory_item_id', 'is', null)
      .limit(1)
      .single();

    const found = await store.findVariantByInventoryItem(ctx.connectionId, variant!.inventory_item_id as string);
    expect(found?.variantId).toBe(variant!.id);

    await store.updateVariantInventory(found!.variantId, 0, false);
    const { data: updated } = await db
      .from('catalog_variants')
      .select('inventory_quantity, available_for_sale')
      .eq('id', found!.variantId)
      .single();
    expect(updated!.inventory_quantity).toBe(0);
    expect(updated!.available_for_sale).toBe(false);
  });

  it('never leaks another shop\'s rows', async () => {
    const otherConnection = '00000000-0000-0000-0000-0000000000ff';
    expect(await store.countProducts(otherConnection)).toBe(0);
    expect(await store.listCollections(otherConnection)).toEqual([]);
    expect(await store.findVariantByInventoryItem(otherConnection, 'gid://shopify/InventoryItem/000001-0')).toBeNull();
  });

  /**
   * Sprint 6, F3 — shop/redact must leave nothing behind.
   *
   * This is the one obligation Shopify audits and the one it is easiest to get
   * silently wrong, so it is verified against a real database rather than
   * reasoned about: seed every table the new product writes, delete the
   * connection the way the redact handler does, and count what survives.
   */
  it('deleting the connection removes every trace of the shop', async () => {
    // The 137-product fixture has no collections, so seed one plus a membership
    // row: the point of this test is that *every* table is reached.
    const { data: seededCollection } = await db
      .from('catalog_collections')
      .insert({
        account_id: ctx.accountId,
        connection_id: ctx.connectionId,
        shopify_id: 'gid://shopify/Collection/redact-1',
        handle: 'redact-test',
        title: 'Redact test',
      })
      .select('id')
      .single();

    const { data: anyProduct } = await db
      .from('catalog_products')
      .select('id')
      .eq('connection_id', ctx.connectionId)
      .limit(1)
      .single();

    await db.from('catalog_collection_products').insert({
      collection_id: seededCollection!.id,
      product_id: anyProduct!.id,
      connection_id: ctx.connectionId,
      position: 0,
    });

    const gallery = await db
      .from('gallery_configs')
      .insert({ account_id: ctx.accountId, connection_id: ctx.connectionId, style: 'warm', status: 'published' })
      .select('id')
      .single();
    expect(gallery.error).toBeNull();

    await db.from('gallery_config_versions').insert({
      gallery_config_id: gallery.data!.id,
      connection_id: ctx.connectionId,
      version: 1,
      snapshot: { style: 'warm' },
    });
    await db.from('gallery_events').insert({
      connection_id: ctx.connectionId,
      session_id: 'sess-redact-test-1234',
      event_type: 'gallery_view',
      occurred_at: new Date().toISOString(),
      dedupe_key: 'redact-1',
    });
    await db.from('gallery_attribution').insert({
      connection_id: ctx.connectionId,
      order_shopify_id: 999001,
      match: 'variant',
      amount: 10,
      currency: 'EUR',
      occurred_at: new Date().toISOString(),
    });
    await db.from('saved_products').insert({
      connection_id: ctx.connectionId,
      session_id: 'sess-redact-test-1234',
      product_shopify_id: 123,
    });
    await db.from('preview_projects').insert({
      shop_domain: ctx.shopDomain,
      source_url: `https://${ctx.shopDomain}`,
      public_token: `redact-${Date.now()}`,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });

    const scoped = [
      'catalog_products', 'catalog_variants', 'catalog_product_images',
      'catalog_collections', 'catalog_collection_products', 'catalog_sync_runs',
      'gallery_configs', 'gallery_config_versions', 'gallery_events',
      'gallery_attribution', 'saved_products',
    ] as const;

    const before = await Promise.all(
      scoped.map((table) =>
        db.from(table).select('*', { count: 'exact', head: true }).eq('connection_id', ctx.connectionId),
      ),
    );
    for (const [i, result] of before.entries()) {
      expect(result.count, `${scoped[i]} should have rows before the redact`).toBeGreaterThan(0);
    }

    // Exactly what handleShopRedact does: previews by shop domain, then the
    // connection, which cascades everything else.
    await db.from('preview_projects').delete().eq('shop_domain', ctx.shopDomain);
    await db.from('shopify_connections').delete().eq('id', ctx.connectionId);

    const after = await Promise.all(
      scoped.map((table) =>
        db.from(table).select('*', { count: 'exact', head: true }).eq('connection_id', ctx.connectionId),
      ),
    );
    for (const [i, result] of after.entries()) {
      expect(result.count, `${scoped[i]} should be empty after the redact`).toBe(0);
    }

    const { count: previews } = await db
      .from('preview_projects')
      .select('*', { count: 'exact', head: true })
      .eq('shop_domain', ctx.shopDomain);
    expect(previews, 'previews are not cascaded, so they must be deleted explicitly').toBe(0);
  }, 60_000);
});
