-- ═══════════════════════════════════════════════════════════════════════════
-- WooCommerce MVP: plans + platform connections
-- ═══════════════════════════════════════════════════════════════════════════

-- WooCommerce plans (IDs prefixed with wc_ to avoid conflict with Shopify plans)
INSERT INTO subscription_plans (id, name, price_usd, features, limits) VALUES
('wc_free', 'Free', 0,
  '{"dashboard": true, "daily_brief": true, "cart_recovery": true, "welcome_emails": false}',
  '{"cart_recoveries_per_month": 10, "welcome_emails_per_month": 0}'),
('wc_pro', 'Pro', 29,
  '{"dashboard": true, "daily_brief": true, "cart_recovery": true, "welcome_emails": true, "weekly_brief": true}',
  '{"cart_recoveries_per_month": -1, "welcome_emails_per_month": -1}')
ON CONFLICT (id) DO NOTHING;

-- Separate connection table for WooCommerce (shopify_connections stays untouched)
CREATE TABLE IF NOT EXISTS platform_connections_v2 (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  platform text NOT NULL,
  store_url text NOT NULL,
  consumer_key text,
  consumer_secret text,
  shop_name text,
  shop_currency text DEFAULT 'EUR',
  status text DEFAULT 'active',
  connected_at timestamptz DEFAULT now(),
  last_sync_at timestamptz,
  UNIQUE(account_id, platform)
);

-- WooCommerce daily snapshots (same structure as Shopify, separate table)
CREATE TABLE IF NOT EXISTS wc_daily_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  snapshot_date date NOT NULL,
  total_revenue numeric DEFAULT 0,
  total_orders integer DEFAULT 0,
  new_customers integer DEFAULT 0,
  abandoned_carts integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(account_id, snapshot_date)
);

-- WooCommerce abandoned carts
CREATE TABLE IF NOT EXISTS wc_abandoned_carts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  cart_id text NOT NULL,
  customer_email text,
  customer_name text,
  total_price numeric DEFAULT 0,
  currency text DEFAULT 'EUR',
  products jsonb DEFAULT '[]',
  checkout_url text,
  abandoned_at timestamptz,
  recovered boolean DEFAULT false,
  recovered_at timestamptz,
  recovery_revenue numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(account_id, cart_id)
);

-- WooCommerce pending actions
CREATE TABLE IF NOT EXISTS wc_pending_actions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  type text NOT NULL,
  title text,
  description text,
  content jsonb DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  executed_at timestamptz,
  result jsonb
);

-- WooCommerce brand profiles (simple version)
CREATE TABLE IF NOT EXISTS wc_brand_profiles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) UNIQUE,
  shop_name text NOT NULL,
  tone text NOT NULL DEFAULT 'warm',
  target_audience text,
  star_product text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
