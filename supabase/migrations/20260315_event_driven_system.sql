-- Event-driven communication system: replaces daily briefs with real-time push notifications

-- Track detected events to prevent re-alerting
CREATE TABLE IF NOT EXISTS event_log (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_type  text NOT NULL,  -- 'new_first_buyer', 'abandoned_cart', 'overdue_customer'
  event_key   text NOT NULL,  -- dedup key: "order:{id}", "cart:{checkout_id}", "overdue:{email}"
  detected_at timestamptz NOT NULL DEFAULT now(),
  action_id   uuid,           -- the pending_action generated for this event
  push_sent   boolean NOT NULL DEFAULT false,
  UNIQUE(account_id, event_type, event_key)
);

CREATE INDEX idx_event_log_account ON event_log(account_id);
CREATE INDEX idx_event_log_detected ON event_log(detected_at);

-- Make brief_id nullable on pending_actions (events don't have briefs)
ALTER TABLE pending_actions ALTER COLUMN brief_id DROP NOT NULL;
