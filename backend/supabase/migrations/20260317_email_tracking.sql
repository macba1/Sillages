-- ═══════════════════════════════════════════════════════════════════════════
-- Email tracking: delivery status from Resend webhooks + cart recovery tracking
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Add delivery tracking columns to email_log
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS opened_at timestamptz;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS clicked_at timestamptz;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS bounced_at timestamptz;

-- Index for webhook lookups by message_id
CREATE INDEX IF NOT EXISTS idx_email_log_message_id ON email_log(message_id) WHERE message_id IS NOT NULL;

-- 2. Add cart recovery tracking to abandoned_carts
ALTER TABLE abandoned_carts ADD COLUMN IF NOT EXISTS recovered boolean DEFAULT false;
ALTER TABLE abandoned_carts ADD COLUMN IF NOT EXISTS recovered_at timestamptz;
ALTER TABLE abandoned_carts ADD COLUMN IF NOT EXISTS recovery_order_id text;
ALTER TABLE abandoned_carts ADD COLUMN IF NOT EXISTS recovery_revenue numeric(10,2);
ALTER TABLE abandoned_carts ADD COLUMN IF NOT EXISTS recovery_action_id uuid;

-- Index for recovery stats
CREATE INDEX IF NOT EXISTS idx_abandoned_carts_recovered ON abandoned_carts(account_id, recovered) WHERE recovered = true;
