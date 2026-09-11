import { attributePurchase, type AttributionDeps, type AttributionOutcome } from './attribution.js';
import { supabaseGalleryStore } from '../gallery/galleryStore.js';
import { resolveShopByDomain, type ResolvedShop } from '../catalog/catalogContext.js';

const LOG = '[orderWebhook]';

/**
 * Attribution from Shopify's own ledger.
 *
 * Revenue used to arrive from the storefront, on a public endpoint whose only
 * credential — the gallery ingest token — is handed to every visitor of a
 * published gallery. Anyone could post an order id and a total, and because the
 * order id is unique per shop, a forged one permanently blocked the shop's real
 * order from ever being credited.
 *
 * `orders/create` is signed by Shopify with the app secret. It is the only
 * thing allowed to say that money changed hands. The Web Pixel still reports
 * what a shopper did (views, opens, cart, checkout started); it no longer
 * reports what they paid.
 *
 * What is read from the payload, and nothing else:
 *
 *   id                  the order, to credit it at most once
 *   total_price         the amount
 *   currency            the amount's unit
 *   created_at          when
 *   line_items[].variant_id   what, so a purchase can be matched to a variant
 *   note_attributes[_sillages_sid]   the gallery session the cart carried
 *
 * Deliberately NOT read: email, phone, customer, billing_address,
 * shipping_address, name, note, client_details, browser_ip. A merchant's
 * shoppers are not ours to store, and `read_orders` returning them is not a
 * reason to keep them.
 */

/** The cart attribute the gallery writes, carried into the order by Shopify. */
export const GALLERY_SESSION_ATTRIBUTE = '_sillages_sid';

export interface OrderWebhookDeps extends AttributionDeps {
  resolveShop?: (shopDomain: string) => Promise<ResolvedShop | null>;
  galleryStore?: { getByConnection: typeof supabaseGalleryStore.getByConnection };
}

export type OrderWebhookOutcome =
  | { handled: true; outcome: AttributionOutcome }
  | { handled: false; reason: 'unknown_shop' | 'malformed' };

function numericId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/** Shopify sends money as a decimal string. Anything else is not money. */
function money(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sessionFromNoteAttributes(payload: Record<string, unknown>): string | null {
  const attributes = payload.note_attributes;
  if (!Array.isArray(attributes)) return null;

  for (const entry of attributes) {
    if (!entry || typeof entry !== 'object') continue;
    const { name, value } = entry as { name?: unknown; value?: unknown };
    if (name !== GALLERY_SESSION_ATTRIBUTE) continue;
    // Same shape the gallery generates. A cart attribute is merchant-editable,
    // so it is validated rather than trusted.
    if (typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value)) return value;
  }
  return null;
}

function variantIds(payload: Record<string, unknown>): number[] {
  const lines = payload.line_items;
  if (!Array.isArray(lines)) return [];

  const ids: number[] = [];
  for (const line of lines) {
    if (!line || typeof line !== 'object') continue;
    const id = numericId((line as { variant_id?: unknown }).variant_id);
    if (id !== null && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export async function handleOrderCreated(
  shopDomain: string,
  payload: Record<string, unknown>,
  deps: OrderWebhookDeps = {},
): Promise<OrderWebhookOutcome> {
  const resolveShop = deps.resolveShop ?? resolveShopByDomain;
  const galleryStore = deps.galleryStore ?? supabaseGalleryStore;

  const orderId = numericId(payload.id);
  if (orderId === null) return { handled: false, reason: 'malformed' };

  const shop = await resolveShop(shopDomain);
  if (!shop) return { handled: false, reason: 'unknown_shop' };

  const config = await galleryStore.getByConnection(shop.connectionId);

  // `created_at` is Shopify's, not ours, and not trusted to be present.
  const createdAt = typeof payload.created_at === 'string' ? payload.created_at : null;
  const occurredAt = createdAt && Number.isFinite(Date.parse(createdAt))
    ? new Date(createdAt).toISOString()
    : new Date().toISOString();

  const outcome = await attributePurchase(
    {
      connectionId: shop.connectionId,
      galleryConfigId: config?.id ?? null,
      orderId,
      sessionId: sessionFromNoteAttributes(payload),
      amount: money(payload.total_price ?? payload.current_total_price),
      currency: typeof payload.currency === 'string' ? payload.currency : null,
      purchasedVariantIds: variantIds(payload),
      occurredAt,
    },
    { store: deps.store, now: deps.now },
  );

  if (outcome.attributed) {
    console.log(`${LOG} ${shopDomain}: order ${orderId} credited (${outcome.match})`);
  } else {
    console.log(`${LOG} ${shopDomain}: order ${orderId} not credited (${outcome.reason})`);
  }

  return { handled: true, outcome };
}
