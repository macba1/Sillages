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
/** Needed to prove RLS from a merchant's point of view, not the backend's. */
const TEST_ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY;

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
  /**
   * The reclaim added after the review, verified against the real partial
   * unique index rather than against the in-memory mirror of it.
   */
  it('reclaims a run whose process died, against the real unique index', async () => {
    const abandoned = await store.startSyncRun(ctx, 'manual');
    expect(abandoned).not.toBeNull();

    // Exactly what a killed process leaves behind: still 'running', heartbeat
    // frozen in the past.
    await db
      .from('catalog_sync_runs')
      .update({ heartbeat_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() })
      .eq('id', abandoned!.id);

    // Before the fix this returned null forever and the shop was frozen.
    const fresh = await store.startSyncRun(ctx, 'reconciliation');
    expect(fresh).not.toBeNull();

    const { data: reclaimed } = await db
      .from('catalog_sync_runs')
      .select('status, error')
      .eq('id', abandoned!.id)
      .single();
    expect(reclaimed!.status).toBe('failed');
    expect(reclaimed!.error).toMatch(/stopped responding/i);

    await store.finishSyncRun(fresh!.id, {
      productsSeen: 0, productsUpserted: 0, productsDeleted: 0, variantsUpserted: 0,
      imagesUpserted: 0, collectionsSeen: 0, collectionsUpserted: 0, collectionsDeleted: 0,
      collectionLinksUpserted: 0,
    });
  }, 60_000);

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

/**
 * Cross-shop isolation, proved from a merchant's point of view.
 *
 * The service-role client the backend uses bypasses RLS, so the other suites
 * can only show that our *queries* are scoped. This one signs in as two real
 * merchants with the anon key and asserts the database itself refuses to hand
 * one shop the other's rows — which is the guarantee that survives a future
 * query written without a `.eq('connection_id', ...)`.
 */
describe.skipIf(!enabled || !TEST_ANON_KEY)('row level security keeps two shops apart', () => {
  let admin: SupabaseClient;
  const created: string[] = [];

  interface Merchant {
    userId: string;
    accountId: string;
    connectionId: string;
    email: string;
    password: string;
  }

  async function makeMerchant(label: string): Promise<Merchant> {
    const email = `rls-${label}-${Date.now()}@dev.local`;
    const password = 'dev-only-password';

    const { data: user, error: userError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (userError) throw new Error(`seed user failed: ${userError.message}`);
    created.push(user.user.id);

    const { data: account, error: accountError } = await admin
      .from('accounts').upsert({ user_id: user.user.id, email }, { onConflict: 'user_id' })
      .select('id').single();
    if (accountError) throw new Error(`seed account failed: ${accountError.message}`);

    const { data: connection, error: connectionError } = await admin
      .from('shopify_connections')
      .insert({
        account_id: account.id,
        shop_domain: `rls-${label}-${Date.now()}.myshopify.com`,
        access_token: 'dev-only-token',
        scopes: 'read_products',
      })
      .select('id').single();
    if (connectionError) throw new Error(`seed connection failed: ${connectionError.message}`);

    // One row in every table a merchant can read.
    await admin.from('catalog_products').insert({
      account_id: account.id, connection_id: connection.id,
      shopify_id: `gid://shopify/Product/${label}`, handle: `${label}-product`, title: `${label} product`,
    });
    await admin.from('catalog_collections').insert({
      account_id: account.id, connection_id: connection.id,
      shopify_id: `gid://shopify/Collection/${label}`, handle: `${label}-collection`, title: `${label} collection`,
    });
    await admin.from('gallery_configs').insert({
      account_id: account.id, connection_id: connection.id, style: 'warm',
    });
    await admin.from('gallery_events').insert({
      connection_id: connection.id, session_id: `sess-${label}-12345678`,
      event_type: 'gallery_view', occurred_at: new Date().toISOString(), dedupe_key: `rls-${label}`,
    });
    await admin.from('gallery_attribution').insert({
      connection_id: connection.id, order_shopify_id: Math.floor(Math.random() * 1e9),
      match: 'variant', amount: 10, currency: 'EUR', occurred_at: new Date().toISOString(),
    });
    await admin.from('saved_products').insert({
      connection_id: connection.id, session_id: `sess-${label}-12345678`, product_shopify_id: 1,
    });

    return { userId: user.user.id, accountId: account.id, connectionId: connection.id, email, password };
  }

  /** A client authenticated as that merchant, with the anon key, so RLS applies. */
  async function clientFor(merchant: Merchant): Promise<SupabaseClient> {
    const client = createClient(TEST_URL!, TEST_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithPassword({
      email: merchant.email, password: merchant.password,
    });
    if (error) throw new Error(`sign-in failed: ${error.message}`);
    return client;
  }

  let alpha: Merchant;
  let beta: Merchant;
  let asAlpha: SupabaseClient;

  beforeAll(async () => {
    admin = createClient(TEST_URL!, TEST_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    alpha = await makeMerchant('alpha');
    beta = await makeMerchant('beta');
    asAlpha = await clientFor(alpha);
  }, 60_000);

  afterAll(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id);
  });

  const TABLES = [
    'catalog_products',
    'catalog_collections',
    'gallery_configs',
    'gallery_events',
    'gallery_attribution',
    'saved_products',
  ] as const;

  it('the schema is actually present, so the assertions below mean something', async () => {
    for (const table of TABLES) {
      const { error } = await admin.from(table).select('*', { head: true, count: 'exact' }).limit(1);
      expect(error, `${table} is missing; run ./scripts/dev-supabase.sh start`).toBeNull();
    }
  });

  it('a merchant sees their own rows in every table', async () => {
    for (const table of TABLES) {
      const { data, error } = await asAlpha.from(table).select('*');
      expect(error, `${table} should be readable by its owner`).toBeNull();
      expect(data?.length ?? 0, `${table} should return the owner's row`).toBeGreaterThan(0);
    }
  });

  it('a merchant sees none of the other shop\'s rows, in any table', async () => {
    for (const table of TABLES) {
      const { data, error } = await asAlpha.from(table).select('*').eq('connection_id', beta.connectionId);
      // The error check is the point: without it a call that failed — because
      // the table does not exist, say — would return null, and `?? []` would
      // score a missing schema as proof of isolation.
      expect(error, `${table} query failed; this assertion proves nothing`).toBeNull();
      expect(data, `${table} leaked another shop's rows`).toEqual([]);
    }
  });

  it('a merchant cannot write at all, to their own rows or to anyone else', async () => {
    // Only the backend's service role writes. The policies grant select only,
    // so an anon-key client is read-only even on its own data.
    const own = await asAlpha.from('gallery_configs').update({ style: 'film' }).eq('account_id', alpha.accountId).select('id');
    expect(own.error, 'query failed; this assertion proves nothing').toBeNull();
    expect(own.data).toEqual([]);

    const other = await asAlpha.from('gallery_configs').update({ style: 'film' }).eq('account_id', beta.accountId).select('id');
    expect(other.error, 'query failed; this assertion proves nothing').toBeNull();
    expect(other.data).toEqual([]);

    const inserted = await asAlpha.from('gallery_events').insert({
      connection_id: beta.connectionId, session_id: 'sess-forged-12345678',
      event_type: 'purchase', occurred_at: new Date().toISOString(), dedupe_key: 'forged-1',
    });
    expect(inserted.error, 'an anon client must not be able to write events').not.toBeNull();
  });

  it('previews and claim tokens are not readable by anyone but the backend', async () => {
    await admin.from('preview_projects').insert({
      shop_domain: 'rls-preview.myshopify.com',
      source_url: 'https://rls-preview.myshopify.com',
      public_token: `rls-${Date.now()}`,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });

    // RLS is enabled with no select policy, so these are invisible to every
    // client except the service role.
    for (const table of ['preview_projects', 'preview_claim_tokens', 'shopify_webhook_events'] as const) {
      const { data, error } = await asAlpha.from(table).select('*');
      expect(error, `${table} query failed; this assertion proves nothing`).toBeNull();
      expect(data, `${table} must not be readable by a merchant`).toEqual([]);
    }

    await admin.from('preview_projects').delete().eq('shop_domain', 'rls-preview.myshopify.com');
  });

  it('an anonymous visitor sees nothing at all', async () => {
    const anonymous = createClient(TEST_URL!, TEST_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    for (const table of TABLES) {
      const { data, error } = await anonymous.from(table).select('*');
      expect(error, `${table} query failed; this assertion proves nothing`).toBeNull();
      expect(data, `${table} is readable without signing in`).toEqual([]);
    }
  });
});

/**
 * Review follow-up — the performance numbers, aggregated in the database.
 *
 * The point of this suite is accuracy at a volume the old application-side
 * counting could not reach, and that one shop's events never enter another's
 * totals. Both are asserted against a real Postgres.
 */
describe.skipIf(!enabled)('gallery totals are accurate and shop-scoped', () => {
  let admin: SupabaseClient;
  let eventStore: typeof import('../services/events/eventStore.js')['supabaseEventStore'];
  const users: string[] = [];
  let connA: string;
  let connB: string;
  let accountA: string;

  async function seedShop(label: string): Promise<{ accountId: string; connectionId: string }> {
    const email = `totals-${label}-${Date.now()}@dev.local`;
    const { data: user, error } = await admin.auth.admin.createUser({
      email, password: 'dev-only-password', email_confirm: true,
    });
    if (error) throw new Error(error.message);
    users.push(user.user.id);

    const { data: account } = await admin
      .from('accounts').upsert({ user_id: user.user.id, email }, { onConflict: 'user_id' })
      .select('id').single();
    const { data: connection } = await admin
      .from('shopify_connections')
      .insert({
        account_id: account!.id,
        shop_domain: `totals-${label}-${Date.now()}.myshopify.com`,
        access_token: 'dev-only-token',
        scopes: 'read_products',
      })
      .select('id').single();

    return { accountId: account!.id, connectionId: connection!.id };
  }

  beforeAll(async () => {
    admin = createClient(TEST_URL!, TEST_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    vi.doMock('../lib/supabase.js', () => ({ supabase: admin }));
    ({ supabaseEventStore: eventStore } = await import('../services/events/eventStore.js'));

    const a = await seedShop('a');
    const b = await seedShop('b');
    connA = a.connectionId;
    connB = b.connectionId;
    accountA = a.accountId;

    const now = Date.now();
    const rows: Record<string, unknown>[] = [];

    // Shop A: a known mix across three sessions.
    const plan: [string, number][] = [
      ['gallery_view', 30], ['post_view', 120], ['post_open', 25],
      ['variant_select', 12], ['save', 7], ['share', 3], ['add_to_cart', 9],
    ];
    let n = 0;
    for (const [type, count] of plan) {
      for (let i = 0; i < count; i += 1) {
        n += 1;
        rows.push({
          connection_id: connA,
          session_id: `sess-a-${(i % 3) + 1}0000000`,
          event_type: type,
          product_shopify_id: type === 'post_open' || type === 'add_to_cart' ? 500 + (i % 4) : null,
          occurred_at: new Date(now - 1000 * n).toISOString(),
          dedupe_key: `totals-a-${type}-${i}`,
        });
      }
    }

    // Shop B: noise that must never appear in shop A's numbers.
    for (let i = 0; i < 40; i += 1) {
      rows.push({
        connection_id: connB,
        session_id: `sess-b-${i}0000000`,
        event_type: 'gallery_view',
        occurred_at: new Date(now - 1000 * i).toISOString(),
        dedupe_key: `totals-b-${i}`,
      });
    }

    for (let i = 0; i < rows.length; i += 200) {
      const { error: insertError } = await admin.from('gallery_events').insert(rows.slice(i, i + 200));
      if (insertError) throw new Error(`seeding events failed: ${insertError.message}`);
    }

    await admin.from('gallery_attribution').insert([
      { connection_id: connA, order_shopify_id: 900001, match: 'session', amount: 42.5, currency: 'EUR', occurred_at: new Date(now).toISOString() },
      { connection_id: connA, order_shopify_id: 900002, match: 'variant', amount: 17.5, currency: 'EUR', occurred_at: new Date(now).toISOString() },
      { connection_id: connB, order_shopify_id: 900003, match: 'variant', amount: 999, currency: 'USD', occurred_at: new Date(now).toISOString() },
    ]);
  }, 120_000);

  afterAll(async () => {
    for (const id of users) await admin.auth.admin.deleteUser(id);
    vi.doUnmock('../lib/supabase.js');
  });

  const since = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  it('counts every event type exactly, with no ceiling', async () => {
    const totals = await eventStore.totals(connA, since());

    expect(totals.galleryViews).toBe(30);
    expect(totals.postOpens).toBe(25);
    expect(totals.variantSelects).toBe(12);
    expect(totals.saves).toBe(7);
    expect(totals.shares).toBe(3);
    expect(totals.addToCarts).toBe(9);
    // Distinct shoppers, not events — the reason this needs the database.
    expect(totals.sessions).toBe(3);
  });

  it('sums attributed revenue for this shop only', async () => {
    const totals = await eventStore.totals(connA, since());

    expect(totals.attributedOrders).toBe(2);
    expect(totals.attributedRevenue).toBe(60);
    expect(totals.currency).toBe('EUR');
  });

  it('never lets another shop’s events into these numbers', async () => {
    const a = await eventStore.totals(connA, since());
    const b = await eventStore.totals(connB, since());

    expect(a.galleryViews).toBe(30);
    expect(b.galleryViews).toBe(40);
    expect(b.attributedRevenue).toBe(999);
    expect(b.sessions).toBe(40);
  });

  it('respects the time window', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const empty = await eventStore.totals(connA, future);

    expect(empty.galleryViews).toBe(0);
    expect(empty.sessions).toBe(0);
    expect(empty.attributedRevenue).toBe(0);
  });

  it('ranks the products most added to cart, for this shop only', async () => {
    const top = await eventStore.topProducts(connA, since(), 10);

    expect(top.length).toBeGreaterThan(0);
    expect(top.every((p) => p.productId >= 500 && p.productId <= 503)).toBe(true);
    // Ordered by adds, then opens.
    for (let i = 1; i < top.length; i += 1) {
      expect(top[i - 1].addToCarts).toBeGreaterThanOrEqual(top[i].addToCarts);
    }
    expect(top.reduce((sum, p) => sum + p.addToCarts, 0)).toBe(9);
    expect(top.reduce((sum, p) => sum + p.opens, 0)).toBe(25);

    expect(await eventStore.topProducts(connB, since(), 10)).toEqual([]);
  });

  it('knows whether the storefront has actually loaded the gallery', async () => {
    expect(await eventStore.lastGalleryViewSince(connA, since())).not.toBeNull();
    // A shop that published but never had the block added has no view at all.
    expect(await eventStore.lastGalleryViewSince(connA, new Date(Date.now() + 60_000).toISOString())).toBeNull();
    void accountA;
  });
});

/**
 * Retention, against a real Postgres.
 *
 * The purge is a database function operating on real timestamps and real
 * batching; asserting it against a fake would prove nothing about either.
 */
describe.skipIf(!enabled)('retention removes expired measurement', () => {
  let admin: SupabaseClient;
  const users: string[] = [];
  let connectionId: string;

  beforeAll(async () => {
    admin = createClient(TEST_URL!, TEST_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

    const email = `retention-${Date.now()}@dev.local`;
    const { data: user, error } = await admin.auth.admin.createUser({
      email, password: 'dev-only-password', email_confirm: true,
    });
    if (error) throw new Error(error.message);
    users.push(user.user.id);

    const { data: account } = await admin
      .from('accounts').upsert({ user_id: user.user.id, email }, { onConflict: 'user_id' })
      .select('id').single();
    const { data: connection } = await admin
      .from('shopify_connections')
      .insert({
        account_id: account!.id,
        shop_domain: `retention-${Date.now()}.myshopify.com`,
        access_token: 'dev-only-token',
        scopes: 'read_products',
      })
      .select('id').single();
    connectionId = connection!.id;

    const day = 86400000;
    const rows = [
      // Old enough to go.
      ...Array.from({ length: 30 }, (_, i) => ({
        connection_id: connectionId, session_id: `sess-old-${i}0000000`, event_type: 'post_view',
        occurred_at: new Date(Date.now() - 200 * day).toISOString(), dedupe_key: `ret-old-${i}`,
      })),
      // Inside the window, must survive.
      ...Array.from({ length: 12 }, (_, i) => ({
        connection_id: connectionId, session_id: `sess-new-${i}0000000`, event_type: 'gallery_view',
        occurred_at: new Date(Date.now() - 10 * day).toISOString(), dedupe_key: `ret-new-${i}`,
      })),
      // Just inside 90 days: the boundary must not be eaten.
      {
        connection_id: connectionId, session_id: 'sess-edge-00000000', event_type: 'post_open',
        occurred_at: new Date(Date.now() - 89 * day).toISOString(), dedupe_key: 'ret-edge',
      },
    ];
    const { error: insertError } = await admin.from('gallery_events').insert(rows);
    if (insertError) throw new Error(`seeding events failed: ${insertError.message}`);

    await admin.from('gallery_attribution').insert([
      { connection_id: connectionId, order_shopify_id: 810001, match: 'variant', amount: 10, currency: 'EUR',
        occurred_at: new Date(Date.now() - 500 * day).toISOString() },
      { connection_id: connectionId, order_shopify_id: 810002, match: 'variant', amount: 20, currency: 'EUR',
        occurred_at: new Date(Date.now() - 100 * day).toISOString() },
    ]);

    await admin.from('shopify_webhook_events').insert([
      { webhook_id: `ret-old-${Date.now()}`, topic: 'products/update', shop_domain: 'x',
        processed_at: new Date(Date.now() - 60 * day).toISOString() },
      { webhook_id: `ret-new-${Date.now()}`, topic: 'products/update', shop_domain: 'x',
        processed_at: new Date().toISOString() },
    ]);
  }, 60_000);

  afterAll(async () => {
    for (const id of users) await admin.auth.admin.deleteUser(id);
  });

  async function countEvents(): Promise<number> {
    const { count } = await admin
      .from('gallery_events')
      .select('id', { count: 'exact', head: true })
      .eq('connection_id', connectionId);
    return count ?? 0;
  }

  it('deletes what expired and keeps what is inside the window', async () => {
    expect(await countEvents()).toBe(43);

    const { data, error } = await admin
      .rpc('purge_gallery_events', { p_event_days: 90, p_attribution_days: 400, p_limit: 50000 })
      .single();

    expect(error).toBeNull();
    const row = data as { events_deleted: number; attribution_deleted: number };
    expect(Number(row.events_deleted)).toBe(30);
    expect(Number(row.attribution_deleted)).toBe(1);

    // The 12 recent rows and the one at 89 days survive.
    expect(await countEvents()).toBe(13);

    const { count: attribution } = await admin
      .from('gallery_attribution')
      .select('id', { count: 'exact', head: true })
      .eq('connection_id', connectionId);
    expect(attribution).toBe(1);
  }, 60_000);

  it('respects its batch limit, so one run cannot lock the table', async () => {
    const day = 86400000;
    await admin.from('gallery_events').insert(
      Array.from({ length: 10 }, (_, i) => ({
        connection_id: connectionId, session_id: `sess-batch-${i}0000000`, event_type: 'post_view',
        occurred_at: new Date(Date.now() - 300 * day).toISOString(), dedupe_key: `ret-batch-${i}`,
      })),
    );

    const { data } = await admin
      .rpc('purge_gallery_events', { p_event_days: 90, p_attribution_days: 400, p_limit: 4 })
      .single();

    expect(Number((data as { events_deleted: number }).events_deleted)).toBe(4);
  }, 60_000);

  it('removes webhook keys past their retention', async () => {
    const { data, error } = await admin.rpc('purge_webhook_events', { p_days: 30 });
    expect(error).toBeNull();
    expect(Number(data)).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('is a no-op on a database with nothing expired', async () => {
    await admin.rpc('purge_gallery_events', { p_event_days: 90, p_attribution_days: 400, p_limit: 50000 });
    const { data } = await admin
      .rpc('purge_gallery_events', { p_event_days: 90, p_attribution_days: 400, p_limit: 50000 })
      .single();
    expect(Number((data as { events_deleted: number }).events_deleted)).toBe(0);
  }, 60_000);
});
