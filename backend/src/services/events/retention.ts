import { supabase } from '../../lib/supabase.js';

const LOG = '[retention]';

/**
 * How long measurement is kept.
 *
 * Raw events: 90 days, which covers the longest window the panel offers.
 * Attribution: 400 days, because revenue is what a merchant looks back at
 * across a year. Webhook idempotency keys: 30 days, well past any Shopify retry.
 *
 * Keeping raw per-shopper events forever is neither defensible under a privacy
 * policy that says measurement is aggregate, nor survivable on a small database.
 */
export const EVENT_RETENTION_DAYS = 90;
export const ATTRIBUTION_RETENTION_DAYS = 400;
export const WEBHOOK_RETENTION_DAYS = 30;

/** Rows removed per statement, so one run cannot hold a lock for minutes. */
const BATCH = 50_000;
/** Safety valve: a run stops after this many batches even if more remain. */
const MAX_BATCHES = 20;

export interface RetentionResult {
  eventsDeleted: number;
  attributionDeleted: number;
  webhookEventsDeleted: number;
  batches: number;
  /** True when the cap was hit and more rows are still expired. */
  incomplete: boolean;
}

export interface RetentionDeps {
  purgeEvents?: (eventDays: number, attributionDays: number, limit: number) => Promise<{ events: number; attribution: number }>;
  purgeWebhooks?: (days: number) => Promise<number>;
}

const defaultPurgeEvents = async (eventDays: number, attributionDays: number, limit: number) => {
  const { data, error } = await supabase
    .rpc('purge_gallery_events', {
      p_event_days: eventDays,
      p_attribution_days: attributionDays,
      p_limit: limit,
    })
    .single();

  if (error) throw new Error(`purging measurement failed: ${error.message}`);
  const row = (data ?? {}) as { events_deleted?: number; attribution_deleted?: number };
  return { events: Number(row.events_deleted ?? 0), attribution: Number(row.attribution_deleted ?? 0) };
};

const defaultPurgeWebhooks = async (days: number) => {
  const { data, error } = await supabase.rpc('purge_webhook_events', { p_days: days });
  if (error) throw new Error(`purging webhook keys failed: ${error.message}`);
  return Number(data ?? 0);
};

/**
 * Deletes expired measurement, in bounded batches, until a batch removes
 * nothing or the cap is reached.
 */
export async function applyRetention(deps: RetentionDeps = {}): Promise<RetentionResult> {
  const purgeEvents = deps.purgeEvents ?? defaultPurgeEvents;
  const purgeWebhooks = deps.purgeWebhooks ?? defaultPurgeWebhooks;

  let eventsDeleted = 0;
  let attributionDeleted = 0;
  let batches = 0;
  let incomplete = false;

  for (;;) {
    if (batches >= MAX_BATCHES) {
      incomplete = true;
      break;
    }

    const { events, attribution } = await purgeEvents(
      EVENT_RETENTION_DAYS,
      ATTRIBUTION_RETENTION_DAYS,
      BATCH,
    );
    batches += 1;
    eventsDeleted += events;
    attributionDeleted += attribution;

    if (events === 0 && attribution === 0) break;
  }

  const webhookEventsDeleted = await purgeWebhooks(WEBHOOK_RETENTION_DAYS);

  console.log(
    `${LOG} removed ${eventsDeleted} event(s), ${attributionDeleted} attribution row(s), ` +
      `${webhookEventsDeleted} webhook key(s) in ${batches} batch(es)` +
      (incomplete ? ' — more remain, next run will continue' : ''),
  );

  return { eventsDeleted, attributionDeleted, webhookEventsDeleted, batches, incomplete };
}
