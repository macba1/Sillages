import { supabase } from '../../lib/supabase.js';
import type { GalleryEventType } from './eventTypes.js';

/**
 * Persistence for measurement. Every read and write is scoped by
 * `connection_id`, so one shop's numbers can never include another's.
 */

export interface StoredEvent {
  connectionId: string;
  galleryConfigId: string | null;
  sessionId: string;
  type: GalleryEventType;
  source: 'gallery' | 'web_pixel';
  productId: number | null;
  variantId: number | null;
  orderId: number | null;
  amount: number | null;
  currency: string | null;
  meta: Record<string, unknown>;
  occurredAt: string;
  dedupeKey: string;
}

export interface AttributionRow {
  connectionId: string;
  orderId: number;
  sessionId: string | null;
  match: 'session' | 'variant';
  amount: number | null;
  currency: string | null;
  matchedVariantIds: number[];
  occurredAt: string;
}

export interface PerformanceTotals {
  galleryViews: number;
  postOpens: number;
  variantSelects: number;
  saves: number;
  shares: number;
  addToCarts: number;
  purchases: number;
  attributedOrders: number;
  attributedRevenue: number;
  currency: string | null;
  sessions: number;
  /** True when the aggregates were unavailable and these are bounded counts. */
  approximate?: boolean;
}

export interface TopProduct {
  productId: number;
  opens: number;
  addToCarts: number;
}

export interface EventStore {
  insertEvents(events: StoredEvent[]): Promise<number>;
  recordSave(connectionId: string, sessionId: string, productId: number, variantId: number | null): Promise<void>;
  removeSave(connectionId: string, sessionId: string, productId: number): Promise<void>;
  /** Variants a session interacted with in the window, for attribution. */
  variantsTouchedSince(connectionId: string, since: string): Promise<{ sessionId: string; variantId: number }[]>;
  upsertAttribution(row: AttributionRow): Promise<boolean>;
  totals(connectionId: string, since: string): Promise<PerformanceTotals>;
  topProducts(connectionId: string, since: string, limit: number): Promise<TopProduct[]>;
  /**
   * When the storefront last rendered the gallery, or null if it never has.
   * This is how "published" is told apart from "published and actually on the
   * storefront": publishing alone does nothing until the merchant adds the
   * block to their theme.
   */
  lastGalleryViewSince(connectionId: string, since: string): Promise<string | null>;
  recentJourney(connectionId: string, limit: number): Promise<
    { sessionId: string; steps: { type: GalleryEventType; occurredAt: string; productId: number | null }[] }[]
  >;
}

/** PostgREST's code for "that function does not exist". */
function isMissingFunction(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST202';
}

/**
 * The pre-aggregation behaviour, kept only as a fallback for a database that
 * has not had the migration applied. Bounded, and therefore approximate on a
 * busy shop — which is why it is not the default.
 */
async function approximateTotals(connectionId: string, since: string): Promise<PerformanceTotals> {
  const { data: events } = await supabase
    .from('gallery_events')
    .select('event_type, session_id')
    .eq('connection_id', connectionId)
    .gte('occurred_at', since)
    .limit(20000);

  const counts = new Map<string, number>();
  const sessions = new Set<string>();
  for (const row of events ?? []) {
    counts.set(row.event_type as string, (counts.get(row.event_type as string) ?? 0) + 1);
    sessions.add(row.session_id as string);
  }

  const { data: attribution } = await supabase
    .from('gallery_attribution')
    .select('amount, currency')
    .eq('connection_id', connectionId)
    .gte('occurred_at', since)
    .limit(5000);

  return {
    galleryViews: counts.get('gallery_view') ?? 0,
    postOpens: counts.get('post_open') ?? 0,
    variantSelects: counts.get('variant_select') ?? 0,
    saves: counts.get('save') ?? 0,
    shares: counts.get('share') ?? 0,
    addToCarts: counts.get('add_to_cart') ?? 0,
    purchases: counts.get('purchase') ?? 0,
    attributedOrders: attribution?.length ?? 0,
    attributedRevenue: Number((attribution ?? []).reduce((sum, r) => sum + Number(r.amount ?? 0), 0).toFixed(2)),
    currency: ((attribution ?? [])[0]?.currency as string | null) ?? null,
    sessions: sessions.size,
    approximate: true,
  };
}

export const supabaseEventStore: EventStore = {
  async insertEvents(events: StoredEvent[]): Promise<number> {
    if (events.length === 0) return 0;

    const { data, error } = await supabase
      .from('gallery_events')
      .upsert(
        events.map((event) => ({
          connection_id: event.connectionId,
          gallery_config_id: event.galleryConfigId,
          session_id: event.sessionId,
          event_type: event.type,
          source: event.source,
          product_shopify_id: event.productId,
          variant_shopify_id: event.variantId,
          order_shopify_id: event.orderId,
          value_amount: event.amount,
          currency: event.currency,
          meta: event.meta,
          occurred_at: event.occurredAt,
          dedupe_key: event.dedupeKey,
        })),
        { onConflict: 'connection_id,dedupe_key', ignoreDuplicates: true },
      )
      .select('id');

    if (error) throw new Error(`storing events failed: ${error.message}`);
    return data?.length ?? 0;
  },

  async recordSave(connectionId, sessionId, productId, variantId) {
    await supabase.from('saved_products').upsert(
      {
        connection_id: connectionId,
        session_id: sessionId,
        product_shopify_id: productId,
        variant_shopify_id: variantId,
      },
      { onConflict: 'connection_id,session_id,product_shopify_id', ignoreDuplicates: true },
    );
  },

  async removeSave(connectionId, sessionId, productId) {
    await supabase
      .from('saved_products')
      .delete()
      .eq('connection_id', connectionId)
      .eq('session_id', sessionId)
      .eq('product_shopify_id', productId);
  },

  async variantsTouchedSince(connectionId: string, since: string) {
    const { data } = await supabase
      .from('gallery_events')
      .select('session_id, variant_shopify_id')
      .eq('connection_id', connectionId)
      .in('event_type', ['add_to_cart', 'variant_select', 'post_open'])
      .not('variant_shopify_id', 'is', null)
      .gte('occurred_at', since)
      .limit(5000);

    return (data ?? []).map((row) => ({
      sessionId: row.session_id as string,
      variantId: Number(row.variant_shopify_id),
    }));
  },

  async upsertAttribution(row: AttributionRow): Promise<boolean> {
    const { data, error } = await supabase
      .from('gallery_attribution')
      .upsert(
        {
          connection_id: row.connectionId,
          order_shopify_id: row.orderId,
          session_id: row.sessionId,
          match: row.match,
          amount: row.amount,
          currency: row.currency,
          matched_variant_ids: row.matchedVariantIds,
          occurred_at: row.occurredAt,
        },
        { onConflict: 'connection_id,order_shopify_id', ignoreDuplicates: true },
      )
      .select('id');

    if (error) throw new Error(`storing attribution failed: ${error.message}`);
    return (data?.length ?? 0) > 0;
  },

  async totals(connectionId: string, since: string): Promise<PerformanceTotals> {
    // Aggregated in the database. Counting in application code meant pulling
    // tens of thousands of rows on every page load and silently under-counting
    // once a shop passed the row ceiling.
    const [events, attribution] = await Promise.all([
      supabase.rpc('gallery_event_totals', { p_connection_id: connectionId, p_since: since }).single(),
      supabase.rpc('gallery_attribution_totals', { p_connection_id: connectionId, p_since: since }).single(),
    ]);

    // PGRST202 means the aggregate functions are not in this database yet —
    // nothing in the repo applies migrations on deploy. Degrade to the bounded
    // application-side count and say the numbers are approximate, rather than
    // 500ing the whole screen or silently showing zeros.
    if (isMissingFunction(events.error) || isMissingFunction(attribution.error)) {
      console.warn('[metrics] aggregate functions missing — falling back to an approximate count');
      return approximateTotals(connectionId, since);
    }

    // Any other failure is real: a wrong number is worse than no number,
    // because it reads as a fact.
    if (events.error) throw new Error(`reading gallery totals failed: ${events.error.message}`);
    if (attribution.error) throw new Error(`reading attribution totals failed: ${attribution.error.message}`);

    const e = (events.data ?? {}) as Record<string, number | null>;
    const a = (attribution.data ?? {}) as Record<string, number | string | null>;

    return {
      galleryViews: Number(e.gallery_views ?? 0),
      postOpens: Number(e.post_opens ?? 0),
      variantSelects: Number(e.variant_selects ?? 0),
      saves: Number(e.saves ?? 0),
      shares: Number(e.shares ?? 0),
      addToCarts: Number(e.add_to_carts ?? 0),
      purchases: Number(e.purchases ?? 0),
      sessions: Number(e.sessions ?? 0),
      attributedOrders: Number(a.attributed_orders ?? 0),
      attributedRevenue: Number(Number(a.attributed_revenue ?? 0).toFixed(2)),
      currency: (a.currency as string | null) ?? null,
    };
  },

  async topProducts(connectionId: string, since: string, limit: number): Promise<TopProduct[]> {
    const { data, error } = await supabase.rpc('gallery_top_products', {
      p_connection_id: connectionId,
      p_since: since,
      p_limit: limit,
    });

    if (error) throw new Error(`reading top products failed: ${error.message}`);

    return (data ?? []).map((row: Record<string, unknown>) => ({
      productId: Number(row.product_id),
      opens: Number(row.opens),
      addToCarts: Number(row.add_to_carts),
    }));
  },

  async lastGalleryViewSince(connectionId: string, since: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('gallery_events')
      .select('occurred_at')
      .eq('connection_id', connectionId)
      .eq('event_type', 'gallery_view')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return data.occurred_at as string;
  },

  async recentJourney(connectionId: string, limit: number) {
    const { data } = await supabase
      .from('gallery_events')
      .select('session_id, event_type, occurred_at, product_shopify_id')
      .eq('connection_id', connectionId)
      .order('occurred_at', { ascending: false })
      .limit(500);

    const bySession = new Map<string, { type: GalleryEventType; occurredAt: string; productId: number | null }[]>();
    for (const row of data ?? []) {
      const sessionId = row.session_id as string;
      const steps = bySession.get(sessionId) ?? [];
      steps.push({
        type: row.event_type as GalleryEventType,
        occurredAt: row.occurred_at as string,
        productId: row.product_shopify_id === null ? null : Number(row.product_shopify_id),
      });
      bySession.set(sessionId, steps);
    }

    return [...bySession.entries()]
      .slice(0, limit)
      .map(([sessionId, steps]) => ({ sessionId, steps: steps.slice().reverse() }));
  },
};
