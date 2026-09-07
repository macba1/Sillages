import cron from 'node-cron';
import { isSocialGalleryMode } from '../../config/productMode.js';
import { listActiveShops } from './catalogContext.js';
import { runCatalogSync } from './catalogSync.js';
import { supabaseCatalogStore } from './supabaseCatalogStore.js';
import { supabasePreviewStore } from '../preview/previewStore.js';

const LOG = '[catalogScheduler]';

/**
 * The only periodic job of the new product.
 *
 * Nightly reconciliation: a full re-read of every shop's catalogue, which
 * repairs anything a missed or failed webhook left behind. It never runs in
 * `legacy` mode, and the legacy scheduler never runs in `social_gallery`.
 */
const RECONCILIATION_CRON = '20 4 * * *'; // 04:20 server time, off-peak

/** Unclaimed before/after demos are temporary and clean themselves up. */
const PREVIEW_CLEANUP_CRON = '50 3 * * *';

/** Space out shops so a nightly run does not hit Shopify in one burst. */
const SHOP_DELAY_MS = 2_000;

export function startCatalogScheduler(): void {
  if (!isSocialGalleryMode()) {
    console.log(`${LOG} Skipped: PRODUCT_MODE is not social_gallery`);
    return;
  }

  cron.schedule(RECONCILIATION_CRON, () => {
    runNightlyReconciliation().catch((err) => {
      console.error(`${LOG} Nightly reconciliation error:`, err);
    });
  });

  cron.schedule(PREVIEW_CLEANUP_CRON, () => {
    removeExpiredPreviews().catch((err) => {
      console.error(`${LOG} Expired preview cleanup error:`, err);
    });
  });

  console.log(`${LOG} Started — preview cleanup at 03:50, catalogue reconciliation at 04:20`);
}

export async function runNightlyReconciliation(
  deps: {
    listShops?: typeof listActiveShops;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<{ shops: number; completed: number; failed: number; skipped: number }> {
  const listShops = deps.listShops ?? listActiveShops;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const shops = await listShops();
  console.log(`${LOG} Reconciling ${shops.length} shop(s)`);

  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (const shop of shops) {
    try {
      const outcome = await runCatalogSync(shop, shop.accessToken, 'reconciliation', {
        store: supabaseCatalogStore,
      });
      if (outcome.status === 'completed') completed += 1;
      else if (outcome.status === 'skipped') skipped += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      console.error(`${LOG} ${shop.shopDomain} reconciliation threw:`, err);
    }
    await sleep(SHOP_DELAY_MS);
  }

  console.log(`${LOG} Done — completed=${completed} failed=${failed} skipped=${skipped}`);
  return { shops: shops.length, completed, failed, skipped };
}


/**
 * Deletes demos nobody claimed once they expire. A claimed preview is kept: it
 * is the record of what a merchant actually chose.
 */
export async function removeExpiredPreviews(
  deps: { store?: typeof supabasePreviewStore; now?: () => Date } = {},
): Promise<number> {
  const store = deps.store ?? supabasePreviewStore;
  const now = deps.now ?? (() => new Date());

  const removed = await store.deleteExpired(now().toISOString());
  console.log(`${LOG} Removed ${removed} expired preview(s)`);
  return removed;
}
