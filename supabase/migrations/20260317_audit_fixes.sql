-- Migration: audit fixes (2026-03-17)
-- 1. scheduler_locks table for distributed lock
-- 2. recipient_email column on email_log for anti-spam tracking
-- 3. recovery_attribution column on abandoned_carts for honest attribution

-- ── 1. Scheduler locks ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduler_locks (
  lock_name   text PRIMARY KEY,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

-- ── 2. Add recipient_email to email_log ─────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE email_log ADD COLUMN recipient_email text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_log_recipient
  ON email_log (account_id, recipient_email, sent_at DESC);

-- ── 3. Add recovery_attribution to abandoned_carts ──────────────────────────
DO $$ BEGIN
  ALTER TABLE abandoned_carts ADD COLUMN recovery_attribution text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Mark all existing recovered carts as 'organic' (honest default)
UPDATE abandoned_carts
SET recovery_attribution = 'organic'
WHERE recovered = true AND recovery_attribution IS NULL;
