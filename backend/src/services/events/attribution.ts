import { supabaseEventStore, type EventStore, type StoredEvent } from './eventStore.js';

const LOG = '[attribution]';

/** How long after an interaction a purchase is still credited to the gallery. */
export const ATTRIBUTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface PurchaseInput {
  connectionId: string;
  galleryConfigId: string | null;
  orderId: number;
  /** Present when the cart carried our marker. The strongest signal we have. */
  sessionId: string | null;
  amount: number | null;
  currency: string | null;
  purchasedVariantIds: number[];
  occurredAt: string;
}

export interface AttributionDeps {
  store?: EventStore;
  now?: () => number;
}

export type AttributionOutcome =
  | { attributed: true; match: 'session' | 'variant'; variantIds: number[] }
  | { attributed: false; reason: 'no_match' | 'already_attributed' };

/**
 * Decides whether an order belongs to the gallery.
 *
 * Two signals, in order of confidence:
 *  1. `session` — the cart carried the session that browsed the gallery. Exact.
 *  2. `variant` — a purchased variant is one this shop's gallery was used to
 *     open, configure or add to cart inside the window. Inferred, and labelled
 *     as such so a merchant is never shown a guess dressed up as a fact.
 *
 * An order is credited at most once: the unique index on
 * (connection_id, order_shopify_id) is what enforces it, not this function.
 */
export async function attributePurchase(
  input: PurchaseInput,
  deps: AttributionDeps = {},
): Promise<AttributionOutcome> {
  const store = deps.store ?? supabaseEventStore;
  const now = deps.now ?? Date.now;

  const since = new Date(now() - ATTRIBUTION_WINDOW_MS).toISOString();
  const touched = await store.variantsTouchedSince(input.connectionId, since);

  let match: 'session' | 'variant' | null = null;
  let matchedVariantIds: number[] = [];

  if (input.sessionId && touched.some((row) => row.sessionId === input.sessionId)) {
    match = 'session';
    matchedVariantIds = touched
      .filter((row) => row.sessionId === input.sessionId)
      .map((row) => row.variantId)
      .filter((id) => input.purchasedVariantIds.includes(id));
    // The session browsed the gallery; credit it even if the exact variant
    // changed between the gallery and the checkout.
    if (matchedVariantIds.length === 0) matchedVariantIds = input.purchasedVariantIds;
  } else {
    const touchedVariants = new Set(touched.map((row) => row.variantId));
    matchedVariantIds = input.purchasedVariantIds.filter((id) => touchedVariants.has(id));
    if (matchedVariantIds.length > 0) match = 'variant';
  }

  if (!match) return { attributed: false, reason: 'no_match' };

  const inserted = await store.upsertAttribution({
    connectionId: input.connectionId,
    orderId: input.orderId,
    sessionId: input.sessionId,
    match,
    amount: input.amount,
    currency: input.currency,
    matchedVariantIds,
    occurredAt: input.occurredAt,
  });

  if (!inserted) return { attributed: false, reason: 'already_attributed' };

  // The purchase itself is also an event, so the funnel is one timeline.
  const purchaseEvent: StoredEvent = {
    connectionId: input.connectionId,
    galleryConfigId: input.galleryConfigId,
    sessionId: input.sessionId ?? `order-${input.orderId}`,
    type: 'purchase',
    source: 'web_pixel',
    productId: null,
    variantId: matchedVariantIds[0] ?? null,
    orderId: input.orderId,
    amount: input.amount,
    currency: input.currency,
    meta: {},
    occurredAt: input.occurredAt,
    dedupeKey: `purchase:${input.orderId}`,
  };
  await store.insertEvents([purchaseEvent]);

  console.log(`${LOG} order ${input.orderId} credited to the gallery (${match})`);
  return { attributed: true, match, variantIds: matchedVariantIds };
}
