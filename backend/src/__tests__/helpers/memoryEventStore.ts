import type {
  AttributionRow,
  EventStore,
  PerformanceTotals,
  StoredEvent,
  TopProduct,
} from '../../services/events/eventStore.js';
import type { GalleryEventType } from '../../services/events/eventTypes.js';

/**
 * In-memory `EventStore` mirroring the SQL semantics: dedupe on
 * (connection_id, dedupe_key), one attribution row per order, and every read
 * filtered by connection.
 */
export class MemoryEventStore implements EventStore {
  events: StoredEvent[] = [];
  attribution: AttributionRow[] = [];
  saves: { connectionId: string; sessionId: string; productId: number; variantId: number | null }[] = [];

  private touched: { connectionId: string; sessionId: string; variantId: number; at: number }[] = [];

  /** Lets a test place an interaction at an arbitrary point in the past. */
  seedTouched(connectionId: string, sessionId: string, variantId: number, at: number): void {
    this.touched.push({ connectionId, sessionId, variantId, at });
  }

  async insertEvents(events: StoredEvent[]): Promise<number> {
    let stored = 0;
    for (const event of events) {
      const duplicate = this.events.some(
        (e) => e.connectionId === event.connectionId && e.dedupeKey === event.dedupeKey,
      );
      if (duplicate) continue;
      this.events.push(event);
      stored += 1;
      if (event.variantId) {
        this.touched.push({
          connectionId: event.connectionId,
          sessionId: event.sessionId,
          variantId: event.variantId,
          at: Date.parse(event.occurredAt),
        });
      }
    }
    return stored;
  }

  async recordSave(connectionId: string, sessionId: string, productId: number, variantId: number | null) {
    const exists = this.saves.some(
      (s) => s.connectionId === connectionId && s.sessionId === sessionId && s.productId === productId,
    );
    if (!exists) this.saves.push({ connectionId, sessionId, productId, variantId });
  }

  async removeSave(connectionId: string, sessionId: string, productId: number) {
    this.saves = this.saves.filter(
      (s) => !(s.connectionId === connectionId && s.sessionId === sessionId && s.productId === productId),
    );
  }

  async variantsTouchedSince(connectionId: string, since: string) {
    const cutoff = Date.parse(since);
    return this.touched
      .filter((t) => t.connectionId === connectionId && t.at >= cutoff)
      .map((t) => ({ sessionId: t.sessionId, variantId: t.variantId }));
  }

  async upsertAttribution(row: AttributionRow): Promise<boolean> {
    const exists = this.attribution.some(
      (a) => a.connectionId === row.connectionId && a.orderId === row.orderId,
    );
    if (exists) return false;
    this.attribution.push(row);
    return true;
  }

  async totals(connectionId: string, since: string): Promise<PerformanceTotals> {
    const cutoff = Date.parse(since);
    const events = this.events.filter(
      (e) => e.connectionId === connectionId && Date.parse(e.occurredAt) >= cutoff,
    );
    const count = (type: GalleryEventType) => events.filter((e) => e.type === type).length;

    const attribution = this.attribution.filter(
      (a) => a.connectionId === connectionId && Date.parse(a.occurredAt) >= cutoff,
    );

    return {
      galleryViews: count('gallery_view'),
      postOpens: count('post_open'),
      variantSelects: count('variant_select'),
      saves: count('save'),
      shares: count('share'),
      addToCarts: count('add_to_cart'),
      purchases: count('purchase'),
      attributedOrders: attribution.length,
      attributedRevenue: Number(attribution.reduce((sum, a) => sum + Number(a.amount ?? 0), 0).toFixed(2)),
      currency: attribution[0]?.currency ?? null,
      sessions: new Set(events.map((e) => e.sessionId)).size,
    };
  }

  async topProducts(connectionId: string, since: string, limit: number): Promise<TopProduct[]> {
    const cutoff = Date.parse(since);
    const byProduct = new Map<number, TopProduct>();
    for (const event of this.events) {
      if (event.connectionId !== connectionId) continue;
      if (Date.parse(event.occurredAt) < cutoff) continue;
      if (!event.productId) continue;
      if (event.type !== 'post_open' && event.type !== 'add_to_cart') continue;

      const entry = byProduct.get(event.productId) ?? { productId: event.productId, opens: 0, addToCarts: 0 };
      if (event.type === 'post_open') entry.opens += 1;
      else entry.addToCarts += 1;
      byProduct.set(event.productId, entry);
    }
    return [...byProduct.values()]
      .sort((a, b) => b.addToCarts - a.addToCarts || b.opens - a.opens)
      .slice(0, limit);
  }

  async lastGalleryViewSince(connectionId: string, since: string): Promise<string | null> {
    const cutoff = Date.parse(since);
    const views = this.events
      .filter(
        (e) =>
          e.connectionId === connectionId &&
          e.type === 'gallery_view' &&
          Date.parse(e.occurredAt) >= cutoff,
      )
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return views[0]?.occurredAt ?? null;
  }

  async recentJourney(connectionId: string, limit: number) {
    const bySession = new Map<string, { type: GalleryEventType; occurredAt: string; productId: number | null }[]>();
    for (const event of this.events.filter((e) => e.connectionId === connectionId)) {
      const steps = bySession.get(event.sessionId) ?? [];
      steps.push({ type: event.type, occurredAt: event.occurredAt, productId: event.productId });
      bySession.set(event.sessionId, steps);
    }
    return [...bySession.entries()].slice(0, limit).map(([sessionId, steps]) => ({ sessionId, steps }));
  }
}
