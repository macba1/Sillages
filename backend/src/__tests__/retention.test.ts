/**
 * Retention for measurement data.
 *
 * gallery_events has no natural ceiling: a busy storefront emits a post_view per
 * product per shopper. Unbounded growth is an operational risk this project has
 * already been bitten by, and keeping raw per-shopper rows forever contradicts a
 * privacy policy that says measurement is aggregate.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/env.js', () => ({
  env: { NODE_ENV: 'test', PRODUCT_MODE: 'social_gallery', SHOPIFY_APP_URL: 'https://example.test' },
}));
vi.mock('../lib/supabase.js', () => ({ supabase: { rpc: () => { throw new Error('no db in tests'); } } }));

import {
  ATTRIBUTION_RETENTION_DAYS,
  EVENT_RETENTION_DAYS,
  WEBHOOK_RETENTION_DAYS,
  applyRetention,
} from '../services/events/retention.js';

function purger(batches: { events: number; attribution: number }[]) {
  const calls: { eventDays: number; attributionDays: number; limit: number }[] = [];
  let i = 0;
  return {
    calls,
    fn: async (eventDays: number, attributionDays: number, limit: number) => {
      calls.push({ eventDays, attributionDays, limit });
      return batches[i++] ?? { events: 0, attribution: 0 };
    },
  };
}

describe('retention deletes expired measurement', () => {
  it('keeps events for 90 days, attribution for 400 and webhook keys for 30', () => {
    // 90 covers the longest window the panel offers; 400 covers a year of
    // revenue; 30 is well past any Shopify retry.
    expect(EVENT_RETENTION_DAYS).toBe(90);
    expect(ATTRIBUTION_RETENTION_DAYS).toBe(400);
    expect(WEBHOOK_RETENTION_DAYS).toBe(30);
  });

  it('passes the retention windows through to the database', async () => {
    const purge = purger([{ events: 0, attribution: 0 }]);
    await applyRetention({ purgeEvents: purge.fn, purgeWebhooks: async () => 0 });

    expect(purge.calls[0]).toEqual({
      eventDays: EVENT_RETENTION_DAYS,
      attributionDays: ATTRIBUTION_RETENTION_DAYS,
      limit: 50000,
    });
  });

  it('deletes in batches until a batch removes nothing', async () => {
    const purge = purger([
      { events: 50000, attribution: 0 },
      { events: 50000, attribution: 12 },
      { events: 137, attribution: 0 },
      { events: 0, attribution: 0 },
    ]);

    const result = await applyRetention({ purgeEvents: purge.fn, purgeWebhooks: async () => 7 });

    expect(result.eventsDeleted).toBe(100137);
    expect(result.attributionDeleted).toBe(12);
    expect(result.webhookEventsDeleted).toBe(7);
    expect(result.batches).toBe(4);
    expect(result.incomplete).toBe(false);
  });

  it('stops at a cap rather than holding a lock indefinitely', async () => {
    // A database with years of backlog must not be purged in one run: the
    // scheduler picks it up again tomorrow.
    const endless = async () => ({ events: 50000, attribution: 0 });

    const result = await applyRetention({ purgeEvents: endless, purgeWebhooks: async () => 0 });

    expect(result.batches).toBe(20);
    expect(result.incomplete).toBe(true);
    expect(result.eventsDeleted).toBe(1000000);
  });

  it('does nothing when there is nothing expired', async () => {
    const purge = purger([{ events: 0, attribution: 0 }]);

    const result = await applyRetention({ purgeEvents: purge.fn, purgeWebhooks: async () => 0 });

    expect(result).toMatchObject({ eventsDeleted: 0, attributionDeleted: 0, batches: 1, incomplete: false });
  });

  it('lets a failure surface rather than reporting a clean run', async () => {
    await expect(
      applyRetention({
        purgeEvents: async () => { throw new Error('deadlock detected'); },
        purgeWebhooks: async () => 0,
      }),
    ).rejects.toThrow(/deadlock/);
  });

  it('purges webhook keys even when there were no events to remove', async () => {
    const purge = purger([{ events: 0, attribution: 0 }]);
    let askedDays = 0;

    const result = await applyRetention({
      purgeEvents: purge.fn,
      purgeWebhooks: async (days: number) => { askedDays = days; return 42; },
    });

    expect(askedDays).toBe(WEBHOOK_RETENTION_DAYS);
    expect(result.webhookEventsDeleted).toBe(42);
  });
});
