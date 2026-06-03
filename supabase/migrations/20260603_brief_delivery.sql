-- ════════════════════════════════════════════════════════════════════════════
-- Brief delivery hardening — 2026-06-03
--
-- APPLY MANUALLY in the Supabase SQL editor (this repo has no auto-migration
-- runner; supabase/migrations is a record, not an applied source of truth).
--
-- Fixes three things:
--   1. email_log.channel CHECK constraint silently rejected 'daily_brief', so
--      daily brief sends never logged → delivery was invisible. Add the missing
--      channels.
--   2. Add accounts.is_test to exclude test stores from merchant emails, and
--      mark the known dev account (sillagesdev + sillages2 share one account_id).
--   3. ops_alerts table to dedupe admin fail-loud alerts (once per day per key).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. email_log channel constraint ────────────────────────────────────────
-- Drop whatever CHECK constraint currently constrains email_log.channel
-- (its name is unknown — created directly in the DB), then recreate with the
-- full allowed set including daily_brief / weekly_brief / admin_alert.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'email_log'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%channel%'
  LOOP
    EXECUTE format('ALTER TABLE email_log DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE email_log
  ADD CONSTRAINT email_log_channel_check
  CHECK (channel IN (
    'push',
    'email',
    'weekly_email',
    'daily_brief',
    'weekly_brief',
    'event_push',
    'daily_summary_push',
    'admin_alert'
  ));

-- ── 2. accounts.is_test + mark known test stores ───────────────────────────
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

UPDATE accounts
SET is_test = true
WHERE id IN (
  SELECT account_id
  FROM shopify_connections
  WHERE shop_domain IN (
    'sillagesdev.myshopify.com',
    'etw0qb-0c.myshopify.com'   -- "sillages2" / "Sillages"
  )
);

-- ── 3. ops_alerts (admin alert dedupe) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS ops_alerts (
  id         uuid primary key default gen_random_uuid(),
  alert_key  text not null unique,   -- e.g. 'daily_brief_missing:2026-06-03'
  detail     jsonb,
  created_at timestamptz not null default now()
);
