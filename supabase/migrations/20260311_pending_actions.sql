-- Pending actions table for the agent-based growth pipeline
CREATE TABLE IF NOT EXISTS pending_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  brief_id        uuid REFERENCES intelligence_briefs(id) ON DELETE SET NULL,
  brief_date      date NOT NULL,

  -- Action metadata
  action_type     text NOT NULL,  -- instagram_post, discount_code, email_campaign, product_highlight, seo_fix, whatsapp_message
  title           text NOT NULL,
  description     text NOT NULL,
  priority        text NOT NULL DEFAULT 'medium',  -- high, medium, low
  time_estimate   text NOT NULL DEFAULT '5 min',
  plan_required   text NOT NULL DEFAULT 'growth',  -- growth, pro

  -- Action content (structured JSON with copy, discount details, email body, etc.)
  content         jsonb NOT NULL DEFAULT '{}',

  -- Status tracking
  status          text NOT NULL DEFAULT 'pending',  -- pending, done, skipped
  completed_at    timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_actions_account_status
  ON pending_actions (account_id, status, brief_date DESC);

CREATE INDEX IF NOT EXISTS idx_pending_actions_brief
  ON pending_actions (brief_id);
