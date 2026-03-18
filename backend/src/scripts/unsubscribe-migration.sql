-- Email unsubscribes table (GDPR compliance)
CREATE TABLE IF NOT EXISTS email_unsubscribes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  email text NOT NULL,
  unsubscribed_at timestamptz DEFAULT now(),
  UNIQUE(account_id, email)
);
CREATE INDEX IF NOT EXISTS idx_email_unsubscribes_lookup ON email_unsubscribes(account_id, email);
