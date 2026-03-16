-- Pending communications table for admin approval gate
CREATE TABLE IF NOT EXISTS pending_comms (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  type text NOT NULL,          -- 'push', 'weekly_email', 'brief_email'
  channel text NOT NULL,       -- 'push', 'event_push', 'daily_summary_push', 'weekly_email'
  content jsonb NOT NULL,      -- payload (push body, email IDs, etc.)
  status text DEFAULT 'pending',  -- 'pending', 'approved', 'rejected'
  created_at timestamptz DEFAULT now(),
  approved_at timestamptz,
  approved_by text
);

-- Index for quick admin queries
CREATE INDEX IF NOT EXISTS idx_pending_comms_status ON pending_comms(status);
CREATE INDEX IF NOT EXISTS idx_pending_comms_account ON pending_comms(account_id);
