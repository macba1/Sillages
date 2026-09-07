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
    const { data: events } = await supabase
      .from('gallery_events')
      .select('event_type, session_id')
      .eq('connection_id', connectionId)
      .gte('occurred_at', since)
      .limit(50000);

    const counts = new Map<string, number>();
    const sessions = new Set<string>();
    for (const row of events ?? []) {
      const type = row.event_type as string;
      counts.set(type, (counts.get(type) ?? 0) + 1);
      sessions.add(row.session_id as string);
    }

    const { data: attribution } = await supabase
      .from('gallery_attribution')
      .select('amount, currency')
      .eq('connection_id', connectionId)
      .gte('occurred_at', since)
      .limit(10000);

    const attributedRevenue = (attribution ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

    return {
      galleryViews: counts.get('gallery_view') ?? 0,
      postOpens: counts.get('post_open') ?? 0,
      variantSelects: counts.get('variant_select') ?? 0,
      saves: counts.get('save') ?? 0,
      shares: counts.get('share') ?? 0,
      addToCarts: counts.get('add_to_cart') ?? 0,
      purchases: counts.get('purchase') ?? 0,
      attributedOrders: attribution?.length ?? 0,
      attributedRevenue: Number(attributedRevenue.toFixed(2)),
      currency: (attribution ?? [])[0]?.currency as string | null ?? null,
      sessions: sessions.size,
    };
  },

  async topProducts(connectionId: string, since: string, limit: number): Promise<TopProduct[]> {
    const { data } = await supabase
      .from('gallery_events')
      .select('product_shopify_id, event_type')
      .eq('connection_id', connectionId)
      .in('event_type', ['post_open', 'add_to_cart'])
      .not('product_shopify_id', 'is', null)
      .gte('occurred_at', since)
      .limit(20000);

    const byProduct = new Map<number, TopProduct>();
    for (const row of data ?? []) {
      const productId = Number(row.product_shopify_id);
      const entry = byProduct.get(productId) ?? { productId, opens: 0, addToCarts: 0 };
      if (row.event_type === 'post_open') entry.opens += 1;
      else entry.addToCarts += 1;
      byProduct.set(productId, entry);
    }

    return [...byProduct.values()]
      .sort((a, b) => b.addToCarts - a.addToCarts || b.opens - a.opens)
      .slice(0, limit);
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
