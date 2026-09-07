import { isSocialGalleryMode } from '../../config/productMode.js';
import { resolveShopByDomain } from './catalogContext.js';
import { registerCatalogWebhooks } from './catalogWebhookSetup.js';
import { runCatalogSync } from './catalogSync.js';
import { supabaseCatalogStore } from './supabaseCatalogStore.js';

const LOG = '[catalogInstall]';

/**
 * Called right after a shop finishes Shopify OAuth.
 *
 * In `legacy` this is a no-op, so the old install flow is unchanged. In
 * `social_gallery` it registers the catalogue webhooks and kicks the first full
 * import.
 *
 * Never throws: a catalogue problem must not fail an otherwise good install.
 */
export async function onShopifyConnected(shopDomain: string, accessToken: string): Promise<void> {
  if (!isSocialGalleryMode()) return;

  try {
    const result = await registerCatalogWebhooks(shopDomain, accessToken);
    if (result.failed.length > 0) {
      console.warn(`${LOG} ${shopDomain}: ${result.failed.length} webhook topic(s) failed to register`);
    }
  } catch (err) {
    console.warn(`${LOG} ${shopDomain}: webhook registration failed: ${(err as Error).message}`);
  }

  try {
    const shop = await resolveShopByDomain(shopDomain);
    if (!shop) {
      console.warn(`${LOG} ${shopDomain}: no connection row found — skipping initial sync`);
      return;
    }
    const outcome = await runCatalogSync(shop, accessToken, 'install', { store: supabaseCatalogStore });
    console.log(`${LOG} ${shopDomain}: initial sync ${outcome.status}`);
  } catch (err) {
    console.warn(`${LOG} ${shopDomain}: initial sync failed: ${(err as Error).message}`);
  }
}

/**
 * True when the legacy order/checkout webhook topics should still be registered.
 * They are pointless in the new product, which never reads orders.
 */
export function shouldRegisterLegacyWebhookTopics(): boolean {
  return !isSocialGalleryMode();
}
