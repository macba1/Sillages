import { supabase } from '../../lib/supabase.js';
import { handleCatalogWebhook, isCatalogWebhookTopic, type CatalogWebhookDeps } from './catalogWebhooks.js';

const LOG = '[catalogWebhook]';

/**
 * Webhook dispatcher for `PRODUCT_MODE=social_gallery`.
 *
 * Catalogue topics go to the catalogue handlers. `app/uninstalled` keeps using
 * the legacy handler on purpose — uninstall must behave identically in both
 * modes. Every other legacy topic is ignored, not processed.
 */

export interface DispatchDeps extends CatalogWebhookDeps {
  /** Injected in tests. Defaults to the shared idempotency table. */
  markProcessed?: (webhookId: string, topic: string, shopDomain: string) => Promise<boolean>;
  handleAppUninstalled?: (shopDomain: string) => Promise<void>;
}

export type DispatchResult =
  | { status: 'processed'; topic: string }
  | { status: 'duplicate'; topic: string }
  | { status: 'ignored'; topic: string; reason: string };

/**
 * Records a webhook id. Returns true when this id was already seen, which makes
 * every redelivery a no-op.
 */
export async function markWebhookProcessed(
  webhookId: string,
  topic: string,
  shopDomain: string,
): Promise<boolean> {
  const { error } = await supabase.from('shopify_webhook_events').insert({
    webhook_id: webhookId,
    topic,
    shop_domain: shopDomain,
    processed_at: new Date().toISOString(),
  });

  if (error) {
    if (error.code === '23505') return true; // already processed
    console.warn(`${LOG} idempotency insert failed (proceeding): ${error.message}`);
    return false;
  }
  return false;
}

export async function dispatchSocialGalleryWebhook(
  topic: string,
  shopDomain: string,
  webhookId: string,
  payload: Record<string, unknown>,
  deps: DispatchDeps = {},
): Promise<DispatchResult> {
  const markProcessed = deps.markProcessed ?? markWebhookProcessed;

  if (await markProcessed(webhookId, topic, shopDomain)) {
    console.log(`${LOG} ${topic} ${webhookId} already processed — skipping`);
    return { status: 'duplicate', topic };
  }

  if (isCatalogWebhookTopic(topic)) {
    const outcome = await handleCatalogWebhook(topic, shopDomain, payload, deps);
    if (!outcome.handled) {
      console.warn(`${LOG} ${topic} from ${shopDomain} not applied: ${outcome.reason}`);
      return { status: 'ignored', topic, reason: outcome.reason };
    }
    console.log(`${LOG} ${topic} from ${shopDomain} -> ${outcome.action}${outcome.detail ? ` (${outcome.detail})` : ''}`);
    return { status: 'processed', topic };
  }

  if (topic === 'app/uninstalled') {
    const handler =
      deps.handleAppUninstalled ??
      (async (shop: string) => {
        // Imported lazily so the legacy module is only loaded when actually needed.
        const { processShopifyWebhook } = await import('../shopifyWebhooks.js');
        // The legacy dispatcher runs its own idempotency check against the same
        // table; this id is already recorded, so pass a distinct suffix to let
        // the uninstall handler run exactly once.
        await processShopifyWebhook('app/uninstalled', shop, `${webhookId}:uninstall`, payload);
      });
    await handler(shopDomain);
    return { status: 'processed', topic };
  }

  console.log(`${LOG} ${topic} ignored in social_gallery mode`);
  return { status: 'ignored', topic, reason: 'legacy_topic' };
}
