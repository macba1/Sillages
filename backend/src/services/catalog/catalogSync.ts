import { createCatalogClient, type CatalogClient } from '../../lib/shopifyCatalog.js';
import { fetchCollectionProductIds, iterateCollections, iterateProducts } from './catalogFetch.js';
import type { CatalogStore, ShopContext } from './catalogStore.js';
import { emptyCounts, type SyncCounts, type SyncTrigger } from './catalogTypes.js';

const LOG = '[catalogSync]';

/** Emit a heartbeat every N products so a stalled run is detectable. */
const HEARTBEAT_EVERY = 25;

export interface SyncDeps {
  store: CatalogStore;
  createClient?: (shop: string, accessToken: string) => CatalogClient;
  now?: () => Date;
}

export type SyncOutcome =
  | { status: 'completed'; runId: string; counts: SyncCounts }
  | { status: 'failed'; runId: string; counts: SyncCounts; error: string }
  | { status: 'skipped'; reason: 'already_running' };

/**
 * Full catalogue synchronisation for one shop.
 *
 * Reads every product, variant, image and collection through the GraphQL Admin
 * API, draining every page, and reconciles the result against what we already
 * store.
 *
 * Reconciliation (the safety net for a webhook we never received) only runs
 * after a complete, successful pass. If the read fails half-way, nothing is
 * soft-deleted — otherwise a network blip would empty a merchant's catalogue.
 */
export async function runCatalogSync(
  ctx: ShopContext,
  accessToken: string,
  trigger: SyncTrigger,
  deps: SyncDeps,
): Promise<SyncOutcome> {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const createClient = deps.createClient ?? ((shop, token) => createCatalogClient(shop, token));

  const run = await store.startSyncRun(ctx, trigger);
  if (!run) {
    console.log(`${LOG} ${ctx.shopDomain}: a sync is already running — skipping ${trigger}`);
    return { status: 'skipped', reason: 'already_running' };
  }

  const seenAt = now().toISOString();
  const counts = emptyCounts();
  const client = createClient(ctx.shopDomain, accessToken);

  try {
    // ── Products, variants, images ──────────────────────────
    for await (const product of iterateProducts(client)) {
      counts.productsSeen += 1;
      const result = await store.upsertProduct(ctx, product, seenAt);
      counts.productsUpserted += 1;
      counts.variantsUpserted += result.variantsUpserted;
      counts.imagesUpserted += result.imagesUpserted;

      if (counts.productsSeen % HEARTBEAT_EVERY === 0) {
        await store.heartbeatSyncRun(run.id);
      }
    }

    // ── Collections and their membership ────────────────────
    for await (const collection of iterateCollections(client)) {
      counts.collectionsSeen += 1;
      const { collectionId } = await store.upsertCollection(ctx, collection, seenAt);
      counts.collectionsUpserted += 1;

      const productIds = await fetchCollectionProductIds(client, collection.shopifyId);
      counts.collectionLinksUpserted += await store.setCollectionProducts(ctx, collectionId, productIds, seenAt);

      await store.heartbeatSyncRun(run.id);
    }

    // ── Reconciliation ──────────────────────────────────────
    // Anything we did not see in this complete pass is gone upstream.
    counts.productsDeleted = await store.softDeleteProductsNotSeenSince(ctx.connectionId, seenAt);
    counts.collectionsDeleted = await store.softDeleteCollectionsNotSeenSince(ctx.connectionId, seenAt);

    await store.finishSyncRun(run.id, counts);
    console.log(
      `${LOG} ${ctx.shopDomain}: ${trigger} completed — ${counts.productsSeen} products, ` +
        `${counts.variantsUpserted} variants, ${counts.collectionsSeen} collections, ` +
        `${counts.productsDeleted} products removed`,
    );
    return { status: 'completed', runId: run.id, counts };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Deliberately no reconciliation here: a partial read must never delete.
    await store.finishSyncRun(run.id, counts, message);
    console.error(`${LOG} ${ctx.shopDomain}: ${trigger} failed — ${message}`);
    return { status: 'failed', runId: run.id, counts, error: message };
  }
}
