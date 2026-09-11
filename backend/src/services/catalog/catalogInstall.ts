import { isSocialGalleryMode } from '../../config/productMode.js';
import { resolveShopByDomain } from './catalogContext.js';
import { registerCatalogWebhooks } from './catalogWebhookSetup.js';
import { runCatalogSync } from './catalogSync.js';
import { supabaseCatalogStore } from './supabaseCatalogStore.js';
import { claimPreview } from '../preview/previewService.js';
import { activateWebPixel } from '../events/webPixel.js';
import { webPixelAvailable } from '../../lib/shopify.js';
import { saveGallery } from '../gallery/galleryService.js';

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
export async function onShopifyConnected(
  shopDomain: string,
  accessToken: string,
  claimToken?: string,
): Promise<void> {
  if (!isSocialGalleryMode()) return;

  // Checkout measurement is not part of this launch. Creating a Web Pixel needs
  // `write_pixels`, which the public app has never been granted, and asking for
  // it would re-prompt every installed merchant for a permission the gallery
  // does not use. Skipped by capability rather than left to fail at runtime, so
  // the log says a decision was made instead of something went wrong.
  if (!webPixelAvailable()) {
    console.log(`${LOG} ${shopDomain}: checkout measurement not in this release — pixel not created`);
  } else {
    try {
      const activation = await activateWebPixel(shopDomain, accessToken);
      if (!activation.activated) {
        console.warn(`${LOG} ${shopDomain}: checkout measurement is off (${activation.reason})`);
      }
    } catch (err) {
      console.warn(`${LOG} ${shopDomain}: pixel activation failed: ${(err as Error).message}`);
    }
  }

  try {
    const result = await registerCatalogWebhooks(shopDomain, accessToken);
    if (result.failed.length > 0) {
      console.warn(`${LOG} ${shopDomain}: ${result.failed.length} webhook topic(s) failed to register`);
    }
  } catch (err) {
    console.warn(`${LOG} ${shopDomain}: webhook registration failed: ${(err as Error).message}`);
  }

  let shop;
  try {
    shop = await resolveShopByDomain(shopDomain);
    if (!shop) {
      console.warn(`${LOG} ${shopDomain}: no connection row found — skipping initial sync`);
      return;
    }
    const outcome = await runCatalogSync(shop, accessToken, 'install', { store: supabaseCatalogStore });
    console.log(`${LOG} ${shopDomain}: initial sync ${outcome.status}`);
  } catch (err) {
    console.warn(`${LOG} ${shopDomain}: initial sync failed: ${(err as Error).message}`);
    return;
  }

  // If this shop was shown a before/after demo, recover exactly the design they
  // were shown instead of dropping them into a blank setup.
  try {
    const claimed = await claimPreview(claimToken, shopDomain, shop.connectionId);
    if (!claimed) return;

    await saveGallery(shop, { style: claimed.proposal });
    // Deliberately not published: the merchant still previews and publishes.
    // Recovering the demo removes the setup, not the decision.
    console.log(`${LOG} ${shopDomain}: seeded the gallery with the "${claimed.proposal}" proposal`);
  } catch (err) {
    console.warn(`${LOG} ${shopDomain}: could not recover the preview: ${(err as Error).message}`);
  }
}

/**
 * True when the legacy order/checkout webhook topics should still be registered.
 * They are pointless in the new product, which never reads orders.
 */
export function shouldRegisterLegacyWebhookTopics(): boolean {
  return !isSocialGalleryMode();
}
