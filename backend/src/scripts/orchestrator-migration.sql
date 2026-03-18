-- Orchestrator checks table
CREATE TABLE IF NOT EXISTS orchestrator_checks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  check_type text NOT NULL,
  check_name text NOT NULL,
  status text NOT NULL,
  details jsonb,
  auto_fixed boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orchestrator_checks_created ON orchestrator_checks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orchestrator_checks_name_status ON orchestrator_checks(check_name, status);

-- Email blacklist table (bounced emails)
CREATE TABLE IF NOT EXISTS email_blacklist (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id),
  reason text NOT NULL DEFAULT 'bounce',
  bounced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(email, account_id)
);
CREATE INDEX IF NOT EXISTS idx_email_blacklist_email ON email_blacklist(email);

-- Auto-cleanup: delete orchestrator_checks older than 7 days (run periodically)
-- DELETE FROM orchestrator_checks WHERE created_at < now() - interval '7 days';
