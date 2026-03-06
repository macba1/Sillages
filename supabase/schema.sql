-- ============================================================
-- Sillages — Supabase PostgreSQL Schema
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- 1. ACCOUNTS
-- One row per store owner, linked to Supabase auth.users
-- ============================================================
create table public.accounts (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  email          text not null,
  full_name      text,
  avatar_url     text,

  -- Stripe
  stripe_customer_id      text unique,
  stripe_subscription_id  text unique,
  subscription_status     text not null default 'trialing'
                            check (subscription_status in (
                              'trialing', 'active', 'past_due', 'canceled', 'unpaid'
                            )),
  trial_ends_at           timestamptz,
  subscription_ends_at    timestamptz,
  language       text not null default 'en' check (language in ('en', 'es')),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint accounts_user_id_key unique (user_id)
);

-- RLS
alter table public.accounts enable row level security;

create policy "Users can view their own account"
  on public.accounts for select
  using (auth.uid() = user_id);

create policy "Users can update their own account"
  on public.accounts for update
  using (auth.uid() = user_id);

-- Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger accounts_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

-- ============================================================
-- 2. USER INTELLIGENCE CONFIG
-- Brief preferences: send time, timezone, focus areas, tone
-- ============================================================
create table public.user_intelligence_config (
  id             uuid primary key default uuid_generate_v4(),
  account_id     uuid not null references public.accounts(id) on delete cascade,

  -- Delivery
  timezone       text not null default 'America/New_York',
  send_hour      smallint not null default 7          -- 0-23 in user's local timezone
                  check (send_hour >= 0 and send_hour <= 23),
  send_enabled   boolean not null default true,

  -- Brief customisation
  focus_areas    text[] not null default '{revenue,conversion,aov}'::text[],
  brief_tone     text not null default 'direct'
                  check (brief_tone in ('direct', 'analytical', 'motivational')),
  store_context  text,
  competitor_context text,

  -- Market context toggle
  include_market_signal boolean not null default true,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint uic_account_id_key unique (account_id)
);

alter table public.user_intelligence_config enable row level security;

create policy "Users can manage their own config"
  on public.user_intelligence_config for all
  using (
    account_id in (
      select id from public.accounts where user_id = auth.uid()
    )
  );

create trigger uic_updated_at
  before update on public.user_intelligence_config
  for each row execute function public.set_updated_at();

-- ============================================================
-- 3. SHOPIFY OAUTH STATES
-- Temporary nonces for the Shopify OAuth flow.
-- Replaces the in-memory Map so state survives server restarts.
-- Accessed only by the backend service role — no RLS needed.
-- ============================================================
create table public.shopify_oauth_states (
  state       text primary key,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  expires_at  timestamptz not null
);

-- ============================================================
-- 4. SHOPIFY CONNECTIONS
-- OAuth tokens and shop metadata per account
-- ============================================================
create table public.shopify_connections (
  id             uuid primary key default uuid_generate_v4(),
  account_id     uuid not null references public.accounts(id) on delete cascade,

  -- Shop identity
  shop_domain    text not null,
  shop_name      text,
  shop_email     text,
  shop_currency  text not null default 'USD',
  shop_timezone  text,

  -- OAuth
  access_token   text not null,
  scopes         text not null,
  token_expires_at timestamptz,

  -- Sync state
  last_synced_at timestamptz,
  sync_status    text not null default 'pending'
                  check (sync_status in ('pending', 'active', 'error', 'disconnected')),
  sync_error     text,

  -- Shopify webhooks
  webhook_id     text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint shopify_connections_account_id_key unique (account_id),
  constraint shopify_connections_shop_domain_key unique (shop_domain)
);

alter table public.shopify_connections enable row level security;

create policy "Users can manage their own Shopify connection"
  on public.shopify_connections for all
  using (
    account_id in (
      select id from public.accounts where user_id = auth.uid()
    )
  );

create trigger shopify_connections_updated_at
  before update on public.shopify_connections
  for each row execute function public.set_updated_at();

-- ============================================================
-- 5. SHOPIFY DAILY SNAPSHOTS
-- Raw daily metrics pulled each morning before brief generation
-- ============================================================
create table public.shopify_daily_snapshots (
  id             uuid primary key default uuid_generate_v4(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  snapshot_date  date not null,

  -- Revenue
  total_revenue          numeric(12, 2) not null default 0,
  net_revenue            numeric(12, 2) not null default 0,
  total_orders           integer not null default 0,
  average_order_value    numeric(10, 2) not null default 0,

  -- Traffic & conversion
  sessions               integer not null default 0,
  conversion_rate        numeric(6, 4) not null default 0,
  returning_customer_rate numeric(6, 4) not null default 0,

  -- Customers
  new_customers          integer not null default 0,
  returning_customers    integer not null default 0,
  total_customers        integer not null default 0,

  -- Products
  top_products           jsonb not null default '[]'::jsonb,

  -- Refunds / cancellations
  total_refunds          numeric(10, 2) not null default 0,
  cancelled_orders       integer not null default 0,

  -- Ads (future)
  ad_spend               numeric(10, 2),
  roas                   numeric(8, 4),

  raw_shopify_payload    jsonb,

  created_at     timestamptz not null default now(),

  constraint shopify_daily_snapshots_account_date_key unique (account_id, snapshot_date)
);

alter table public.shopify_daily_snapshots enable row level security;

create policy "Users can view their own snapshots"
  on public.shopify_daily_snapshots for select
  using (
    account_id in (
      select id from public.accounts where user_id = auth.uid()
    )
  );

create index shopify_daily_snapshots_account_date_idx
  on public.shopify_daily_snapshots (account_id, snapshot_date desc);

-- ============================================================
-- 6. INTELLIGENCE BRIEFS
-- Generated brief per day — 6 sections stored as JSONB
-- ============================================================
create table public.intelligence_briefs (
  id             uuid primary key default uuid_generate_v4(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  snapshot_id    uuid references public.shopify_daily_snapshots(id) on delete set null,
  brief_date     date not null,

  -- Generation status
  status         text not null default 'pending'
                  check (status in ('pending', 'generating', 'ready', 'failed', 'sent')),
  generated_at   timestamptz,
  sent_at        timestamptz,
  generation_error text,

  -- The 6 sections (all JSONB)
  section_yesterday         jsonb,
  -- { revenue, orders, aov, sessions, conversion_rate, new_customers, top_product, summary }

  section_whats_working     jsonb,
  -- { items: [{ title, metric, insight }] }

  section_whats_not_working jsonb,
  -- { items: [{ title, metric, insight }] }

  section_signal            jsonb,
  -- { headline, market_context, store_implication }

  section_gap               jsonb,
  -- { gap, opportunity, estimated_upside }

  section_activation        jsonb,
  -- { what, why, how: string[], expected_impact }

  -- Model metadata
  model_used        text not null default 'gpt-4o',
  prompt_tokens     integer,
  completion_tokens integer,
  total_tokens      integer,

  -- Email delivery
  email_message_id  text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint intelligence_briefs_account_date_key unique (account_id, brief_date)
);

alter table public.intelligence_briefs enable row level security;

create policy "Users can view their own briefs"
  on public.intelligence_briefs for select
  using (
    account_id in (
      select id from public.accounts where user_id = auth.uid()
    )
  );

create trigger intelligence_briefs_updated_at
  before update on public.intelligence_briefs
  for each row execute function public.set_updated_at();

create index intelligence_briefs_account_date_idx
  on public.intelligence_briefs (account_id, brief_date desc);

-- ============================================================
-- FUNCTION: auto-create account + config on user signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.accounts (user_id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );

  insert into public.user_intelligence_config (account_id)
  select id from public.accounts where user_id = new.id;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
