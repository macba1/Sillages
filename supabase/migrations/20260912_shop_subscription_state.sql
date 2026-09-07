-- ============================================================
-- Plan state per shop
--
-- Publishing a gallery is a paid feature, but nothing recorded whether a shop
-- had a live plan, and app_subscriptions/update was never registered — so a
-- cancellation, a failed payment or an expired trial changed nothing at all and
-- the gallery kept serving.
--
-- Shopify remains the source of truth. This is the local mirror the storefront
-- and the admin can consult without a round trip on every request.
-- ============================================================

create table if not exists public.shop_subscriptions (
  connection_id       uuid primary key references public.shopify_connections(id) on delete cascade,
  account_id          uuid not null references public.accounts(id) on delete cascade,

  -- Shopify's own subscription id and the plan it maps to.
  shopify_gid         text,
  plan_id             text check (plan_id in ('basic', 'growth', 'pro')),

  -- Mirrors Shopify's AppSubscriptionStatus.
  status              text not null default 'none'
                        check (status in (
                          'none', 'pending', 'active', 'declined',
                          'expired', 'frozen', 'cancelled'
                        )),
  -- A test charge is a real subscription to Shopify but must never unlock a
  -- paid feature in production.
  is_test             boolean not null default true,

  trial_ends_at       timestamptz,
  current_period_end  timestamptz,

  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

create index if not exists shop_subscriptions_account_idx
  on public.shop_subscriptions (account_id);
create index if not exists shop_subscriptions_status_idx
  on public.shop_subscriptions (status);

drop trigger if exists shop_subscriptions_updated_at on public.shop_subscriptions;
create trigger shop_subscriptions_updated_at
  before update on public.shop_subscriptions
  for each row execute function public.set_updated_at();

alter table public.shop_subscriptions enable row level security;

drop policy if exists "Merchants read their own subscription" on public.shop_subscriptions;
create policy "Merchants read their own subscription"
  on public.shop_subscriptions for select
  using (account_id in (select id from public.accounts where user_id = auth.uid()));
