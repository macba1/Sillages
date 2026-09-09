import { resolveShopByDomain } from '../catalog/catalogContext.js';
import { supabaseGalleryStore, type GalleryStore } from '../gallery/galleryStore.js';
import { supabaseEventStore, type EventStore, type StoredEvent } from './eventStore.js';
import { attributePurchase, type AttributionOutcome } from './attribution.js';
import {
  CLIENT_REPORTABLE_TYPES,
  containsForbiddenField,
  eventBatchSchema,
  purchaseReportSchema,
  type ClientEvent,
} from './eventTypes.js';
import { verifyIngestToken } from './ingestToken.js';

const LOG = '[events]';

/** Reject anything claiming to have happened more than a day either side of now. */
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

export interface IngestDeps {
  store?: EventStore;
  galleryStore?: GalleryStore;
  resolveShop?: typeof resolveShopByDomain;
  now?: () => number;
}

export type IngestResult =
  | { ok: true; accepted: number; stored: number }
  | { ok: false; status: 400 | 401 | 404; reason: string };

/**
 * Accepts one batch of storefront events.
 *
 * Three things are refused rather than sanitised, because silently accepting
 * them would hide a bug or a privacy problem:
 *   - a payload with an unexpected field (the schema is strict);
 *   - a payload carrying anything person-shaped;
 *   - an event type only the server may write, such as `purchase`.
 */
export async function ingestEventBatch(body: unknown, deps: IngestDeps = {}): Promise<IngestResult> {
  const store = deps.store ?? supabaseEventStore;
  const galleryStore = deps.galleryStore ?? supabaseGalleryStore;
  const resolveShop = deps.resolveShop ?? resolveShopByDomain;
  const now = deps.now ?? Date.now;

  const forbidden = containsForbiddenField(body);
  if (forbidden) {
    console.warn(`${LOG} rejected a batch carrying "${forbidden}"`);
    return { ok: false, status: 400, reason: 'personal_data_not_accepted' };
  }

  const parsed = eventBatchSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, reason: 'malformed_batch' };
  }

  const { token, sessionId, events } = parsed.data;

  const verified = verifyIngestToken(token, now);
  if (!verified) return { ok: false, status: 401, reason: 'invalid_or_expired_token' };

  // The shop comes from the signature, never from a client-supplied field.
  const shop = await resolveShop(verified.shopDomain);
  if (!shop) return { ok: false, status: 404, reason: 'unknown_shop' };

  const config = await galleryStore.getByConnection(shop.connectionId);
  const nowMs = now();

  const usable: ClientEvent[] = [];
  for (const event of events) {
    if (!CLIENT_REPORTABLE_TYPES.includes(event.type)) continue; // e.g. `purchase`
    const occurred = Date.parse(event.occurredAt);
    if (!Number.isFinite(occurred) || Math.abs(nowMs - occurred) > MAX_CLOCK_SKEW_MS) continue;
    usable.push(event);
  }

  if (usable.length === 0) return { ok: true, accepted: 0, stored: 0 };

  const PIXEL_ONLY_TYPES: readonly string[] = ['checkout_started'];

  const rows: StoredEvent[] = usable.map((event) => ({
    connectionId: shop.connectionId,
    galleryConfigId: config?.id ?? null,
    sessionId,
    type: event.type,
    // `checkout_started` can only come from the Web Pixel — the gallery script
    // never sees checkout. Recording it as 'gallery' made the Performance
    // screen tell merchants the pixel was "not switched on for your store"
    // while it was demonstrably reporting.
    source: PIXEL_ONLY_TYPES.includes(event.type) ? 'web_pixel' : 'gallery',
    productId: event.productId ?? null,
    variantId: event.variantId ?? null,
    orderId: null,
    amount: null,
    currency: null,
    meta: event.meta ?? {},
    occurredAt: new Date(occurredMs(event.occurredAt)).toISOString(),
    // Scoped by session so two shoppers cannot collide on a client id.
    dedupeKey: `${sessionId}:${event.id}`,
  }));

  const stored = await store.insertEvents(rows);

  // Saves are also kept as state, not only as a fact that happened, because
  // sharing and "ask your friends" are built on them later.
  for (const event of usable) {
    if (event.type === 'save' && event.productId) {
      await store.recordSave(shop.connectionId, sessionId, event.productId, event.variantId ?? null);
    }
    if (event.type === 'unsave' && event.productId) {
      await store.removeSave(shop.connectionId, sessionId, event.productId);
    }
  }

  return { ok: true, accepted: usable.length, stored };
}

function occurredMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}


export type PurchaseResult =
  | { ok: true; outcome: AttributionOutcome }
  | { ok: false; status: 400 | 401 | 404; reason: string };

/**
 * Accepts a purchase reported by the Web Pixel and decides whether the gallery
 * is credited with it.
 */
export async function ingestPurchase(body: unknown, deps: IngestDeps = {}): Promise<PurchaseResult> {
  const galleryStore = deps.galleryStore ?? supabaseGalleryStore;
  const resolveShop = deps.resolveShop ?? resolveShopByDomain;
  const now = deps.now ?? Date.now;

  const forbidden = containsForbiddenField(body);
  if (forbidden) return { ok: false, status: 400, reason: 'personal_data_not_accepted' };

  const parsed = purchaseReportSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, reason: 'malformed_purchase' };

  // The same clock-skew bound the event path applies. Without it a forged
  // purchase dated in the future satisfies every reporting window forever.
  const occurred = Date.parse(parsed.data.occurredAt);
  if (!Number.isFinite(occurred) || Math.abs(now() - occurred) > MAX_CLOCK_SKEW_MS) {
    return { ok: false, status: 400, reason: 'implausible_timestamp' };
  }

  const verified = verifyIngestToken(parsed.data.token, now);
  if (!verified) return { ok: false, status: 401, reason: 'invalid_or_expired_token' };

  const shop = await resolveShop(verified.shopDomain);
  if (!shop) return { ok: false, status: 404, reason: 'unknown_shop' };

  const config = await galleryStore.getByConnection(shop.connectionId);

  const outcome = await attributePurchase(
    {
      connectionId: shop.connectionId,
      galleryConfigId: config?.id ?? null,
      orderId: parsed.data.orderId,
      sessionId: parsed.data.sessionId ?? null,
      amount: parsed.data.amount ?? null,
      currency: parsed.data.currency ?? null,
      purchasedVariantIds: parsed.data.variantIds,
      occurredAt: parsed.data.occurredAt,
    },
    { store: deps.store, now },
  );

  return { ok: true, outcome };
}
