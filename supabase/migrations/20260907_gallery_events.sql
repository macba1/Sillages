-- ============================================================
-- Sprint 4 — Interactions, measurement and attribution
--
-- Additive. No legacy table is altered.
--
-- Privacy: nothing here identifies a person. `session_id` is a random value the
-- browser generates for itself; there is no email, no customer id, no IP and no
-- user agent. A session row is meaningless outside its own shop.
-- ============================================================

-- ── Raw events ──────────────────────────────────────────────
create table if not exists public.gallery_events (
  id                  uuid primary key default uuid_generate_v4(),
  connection_id       uuid not null references public.shopify_connections(id) on delete cascade,
  gallery_config_id   uuid references public.gallery_configs(id) on delete set null,

  -- Anonymous, browser-generated. Not a customer, not an account.
  session_id          text not null,

  event_type          text not null
                        check (event_type in (
                          'gallery_view',
                          'post_view',
                          'post_open',
                          'variant_select',
                          'save',
                          'unsave',
                          'share',
                          'add_to_cart',
                          'checkout_started',
                          'purchase'
                        )),
  source              text not null default 'gallery'
                        check (source in ('gallery', 'web_pixel')),

  product_shopify_id  bigint,
  variant_shopify_id  bigint,
  order_shopify_id    bigint,

  value_amount        numeric(12,2),
  currency            text,

  -- Small, allow-listed extras only (share channel, style, position).
  meta                jsonb not null default '{}'::jsonb,

  occurred_at         timestamptz not null,
  received_at         timestamptz not null default now(),

  -- Makes a retried batch a no-op.
  dedupe_key          text not null,

  constraint gallery_events_dedupe_key_unique unique (connection_id, dedupe_key)
);

create index if not exists gallery_events_connection_time_idx
  on public.gallery_events (connection_id, occurred_at desc);
create index if not exists gallery_events_session_idx
  on public.gallery_events (connection_id, session_id, occurred_at desc);
create index if not exists gallery_events_variant_idx
  on public.gallery_events (connection_id, variant_shopify_id, occurred_at desc);
create index if not exists gallery_events_type_idx
  on public.gallery_events (connection_id, event_type, occurred_at desc);

-- ── Attribution ─────────────────────────────────────────────
-- One row per order the gallery is credited with.
create table if not exists public.gallery_attribution (
  id                  uuid primary key default uuid_generate_v4(),
  connection_id       uuid not null references public.shopify_connections(id) on delete cascade,

  order_shopify_id    bigint not null,
  session_id          text,

  -- 'session' when the cart carried our session marker, 'variant' when we
  -- matched a purchased variant a shopper interacted with in the window.
  match               text not null check (match in ('session', 'variant')),

  amount              numeric(12,2),
  currency            text,
  matched_variant_ids bigint[] not null default '{}',

  occurred_at         timestamptz not null,
  created_at          timestamptz not null default now(),

  constraint gallery_attribution_order_unique unique (connection_id, order_shopify_id)
);

create index if not exists gallery_attribution_connection_time_idx
  on public.gallery_attribution (connection_id, occurred_at desc);

-- ── Saved products ──────────────────────────────────────────
-- The foundation for sharing and, later, "ask your friends". Still anonymous.
create table if not exists public.saved_products (
  id                  uuid primary key default uuid_generate_v4(),
  connection_id       uuid not null references public.shopify_connections(id) on delete cascade,
  session_id          text not null,

  product_shopify_id  bigint not null,
  variant_shopify_id  bigint,

  created_at          timestamptz not null default now(),

  constraint saved_products_unique unique (connection_id, session_id, product_shopify_id)
);

create index if not exists saved_products_session_idx
  on public.saved_products (connection_id, session_id);
create index if not exists saved_products_product_idx
  on public.saved_products (connection_id, product_shopify_id);

-- ── RLS ─────────────────────────────────────────────────────
-- The backend writes with the service role. A merchant may read their own
-- shop's rows; nobody may read another shop's.
alter table public.gallery_events      enable row level security;
alter table public.gallery_attribution enable row level security;
alter table public.saved_products      enable row level security;

drop policy if exists "Merchants read their own events" on public.gallery_events;
create policy "Merchants read their own events"
  on public.gallery_events for select
  using (
    connection_id in (
      select c.id from public.shopify_connections c
      where c.account_id in (select id from public.accounts where user_id = auth.uid())
    )
  );

drop policy if exists "Merchants read their own attribution" on public.gallery_attribution;
create policy "Merchants read their own attribution"
  on public.gallery_attribution for select
  using (
    connection_id in (
      select c.id from public.shopify_connections c
      where c.account_id in (select id from public.accounts where user_id = auth.uid())
    )
  );

drop policy if exists "Merchants read their own saves" on public.saved_products;
create policy "Merchants read their own saves"
  on public.saved_products for select
  using (
    connection_id in (
      select c.id from public.shopify_connections c
      where c.account_id in (select id from public.accounts where user_id = auth.uid())
    )
  );
