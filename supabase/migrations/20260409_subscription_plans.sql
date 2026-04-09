-- ═══════════════════════════════════════════════════════════════════════════
-- Subscription plans + account subscriptions
-- Feature gating for multi-platform Sillages
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS subscription_plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  price_usd numeric NOT NULL,
  billing_period text NOT NULL DEFAULT 'monthly',
  features jsonb NOT NULL,
  limits jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_subscriptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) UNIQUE,
  plan_id text NOT NULL REFERENCES subscription_plans(id),
  status text NOT NULL DEFAULT 'active',
  started_at timestamptz DEFAULT now(),
  ends_at timestamptz,
  is_beta boolean DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ── Insert plans ──────────────────────────────────────────────────────────

INSERT INTO subscription_plans (id, name, price_usd, features, limits) VALUES
('starter', 'Starter', 0,
  '{"daily_brief": true, "dashboard": true, "manual_actions": true}',
  '{"emails_per_month": 0, "manual_actions_per_month": 1}'),
('growth', 'Growth', 29,
  '{"daily_brief": true, "dashboard": true, "weekly_brief": true, "cart_recovery": true, "welcome_emails": true, "brand_profile": true, "abandoned_cart_analysis": true, "push_notifications": true}',
  '{"emails_per_month": 100, "actions_per_day": 5}'),
('pro', 'Pro', 79,
  '{"daily_brief": true, "dashboard": true, "weekly_brief": true, "cart_recovery": true, "welcome_emails": true, "brand_profile": true, "abandoned_cart_analysis": true, "push_notifications": true, "reactivation": true, "auto_discounts": true, "auto_seo": true, "auto_merchandising": true, "commercial_calendar": true, "competitor_analysis_basic": true, "priority_support": true}',
  '{"emails_per_month": -1, "actions_per_day": -1}'),
('scale', 'Scale', 199,
  '{"daily_brief": true, "dashboard": true, "weekly_brief": true, "cart_recovery": true, "welcome_emails": true, "brand_profile": true, "abandoned_cart_analysis": true, "push_notifications": true, "reactivation": true, "auto_discounts": true, "auto_seo": true, "auto_merchandising": true, "commercial_calendar": true, "competitor_analysis_basic": true, "priority_support": true, "instagram_posting": true, "whatsapp_business": true, "multi_store": true, "ab_testing": true, "competitor_analysis_advanced": true, "api_access": true, "success_manager": true, "onboarding_1on1": true}',
  '{"emails_per_month": -1, "actions_per_day": -1, "max_stores": 3}'),
('payg', 'Pay as you go', 0,
  '{"daily_brief": true, "dashboard": true, "cart_recovery": true, "welcome_emails": true, "brand_profile": true}',
  '{"emails_per_month": -1, "actions_per_day": -1, "pricing_model": "usage", "price_per_email": 0.15, "price_per_discount": 0.50, "price_per_recovery": 2.00}')
ON CONFLICT (id) DO NOTHING;

-- ── Assign Andrea (NICOLINA) to Scale as beta ────────────────────────────

INSERT INTO account_subscriptions (account_id, plan_id, is_beta, notes)
VALUES ('e77572ee-83df-43e8-8f69-f143a227fe56', 'scale', true, 'Beta user, primer cliente real, NICOLINA Madrid')
ON CONFLICT (account_id) DO UPDATE SET plan_id = 'scale', is_beta = true;
