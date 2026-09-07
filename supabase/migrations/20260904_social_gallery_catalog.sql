-- ============================================================
-- Sprint 1 — Live Shopify catalogue for PRODUCT_MODE=social_gallery
--
-- Additive only. No legacy table is altered or dropped, so
-- PRODUCT_MODE=legacy keeps working exactly as before.
--
-- Deletions are soft (`deleted_at`): a product that disappears from Shopify is
-- marked, never destroyed, so a lost webhook or a bad sync is recoverable.
-- ============================================================

-- ── Sync runs ───────────────────────────────────────────────
-- One row per catalogue synchronisation, for diagnosis and for the
-- "is my catalogue up to date?" question in the UI.
create table if not exists public.catalog_sync_runs (
  id                  uuid primary key default uuid_generate_v4(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  connection_id       uuid not null references public.shopify_connections(id) on delete cascade,

  trigger             text not null
                        check (trigger in ('install', 'manual', 'reconciliation', 'webhook')),
  status              text not null default 'running'
                        check (status in ('running', 'completed', 'failed')),

  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  heartbeat_at        timestamptz not null default now(),

  products_seen             integer not null default 0,
  products_upserted         integer not null default 0,
  products_deleted          integer not null default 0,
  variants_upserted         integer not null default 0,
  images_upserted           integer not null default 0,
  collections_seen          integer not null default 0,
  collections_upserted      integer not null default 0,
  collections_deleted       integer not null default 0,
  collection_links_upserted integer not null default 0,

  error               text,
  created_at          timestamptz not null default now()
);

create index if not exists catalog_sync_runs_connection_idx
  on public.catalog_sync_runs (connection_id, started_at desc);
-- At most one run in flight per shop; the partial index is the lock.
create unique index if not exists catalog_sync_runs_one_active_idx
  on public.catalog_sync_runs (connection_id)
  where status = 'running';

-- ── Products ────────────────────────────────────────────────
create table if not exists public.catalog_products (
  id                  uuid primary key default uuid_generate_v4(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  connection_id       uuid not null references public.shopify_connections(id) on delete cascade,

  shopify_id          text not null,
  handle              text not null,
  title               text not null,
  status              text,
  product_type        text,
  vendor              text,
  tags                text[] not null default '{}',
  description         text,
  online_store_url    text,
  featured_image_url  text,
  total_inventory     integer,

  shopify_updated_at  timestamptz,
  last_seen_at        timestamptz not null default now(),
  deleted_at          timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint catalog_products_connection_shopify_key unique (connection_id, shopify_id)
);

create index if not exists catalog_products_connection_idx
  on public.catalog_products (connection_id) where deleted_at is null;
create index if not exists catalog_products_handle_idx
  on public.catalog_products (connection_id, handle);

-- ── Variants ────────────────────────────────────────────────
create table if not exists public.catalog_variants (
  id                  uuid primary key default uuid_generate_v4(),
  product_id          uuid not null references public.catalog_products(id) on delete cascade,
  connection_id       uuid not null references public.shopify_connections(id) on delete cascade,

  shopify_id          text not null,
  -- Maps `inventory_levels/update` webhooks (which carry an inventory item id)
  -- back to the variant they belong to.
  inventory_item_id   text,

  title               text,
  sku                 text,
  price               numeric(12,2),
  compare_at_price    numeric(12,2),
  available_for_sale  boolean not null default true,
  inventory_quantity  integer,
  inventory_policy    text,
  position            integer not null default 0,
  selected_options    jsonb not null default '[]'::jsonb,
  image_shopify_id    text,

  last_seen_at        timestamptz not null default now(),
  deleted_at          timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint catalog_variants_connection_shopify_key unique (connection_id, shopify_id)
);

create index if not exists catalog_variants_product_idx
  on public.catalog_variants (product_id) where deleted_at is null;
create index if not exists catalog_variants_inventory_item_idx
  on public.catalog_variants (connection_id, inventory_item_id);

-- ── Product images ──────────────────────────────────────────
create table if not exists public.catalog_product_images (
  id                  uuid primary key default uuid_generate_v4(),
  product_id          uuid not null references public.catalog_products(id) on delete cascade,
  connection_id       uuid not null references public.shopify_connections(id) on delete cascade,

  shopify_id          text not null,
  url                 text not null,
  alt_text            text,
  width               integer,
  height              integer,
  position            integer not null default 0,

  last_seen_at        timestamptz not null default now(),
  deleted_at          timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint catalog_product_images_connection_shopify_key unique (connection_id, shopify_id)
);

create index if not exists catalog_product_images_product_idx
  on public.catalog_product_images (product_id) where deleted_at is null;

-- ── Collections ─────────────────────────────────────────────
create table if not exists public.catalog_collections (
  id                  uuid primary key default uuid_generate_v4(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  connection_id       uuid not null references public.shopify_connections(id) on delete cascade,

  shopify_id          text not null,
  handle              text not null,
  title               text not null,
  description         text,
  image_url           text,
  sort_order          text,
  products_count      integer,

  shopify_updated_at  timestamptz,
  last_seen_at        timestamptz not null default now(),
  deleted_at          timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint catalog_collections_connection_shopify_key unique (connection_id, shopify_id)
);

create index if not exists catalog_collections_connection_idx
  on public.catalog_collections (connection_id) where deleted_at is null;

-- ── Collection membership ───────────────────────────────────
create table if not exists public.catalog_collection_products (
  collection_id       uuid not null references public.catalog_collections(id) on delete cascade,
  product_id          uuid not null references public.catalog_products(id) on delete cascade,
  connection_id       uuid not null references public.shopify_connections(id) on delete cascade,
  position            integer not null default 0,
  last_seen_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),

  primary key (collection_id, product_id)
);

create index if not exists catalog_collection_products_product_idx
  on public.catalog_collection_products (product_id);

-- ── Webhook idempotency ─────────────────────────────────────
-- Already used in production by the legacy webhook handler but never captured
-- in a migration. Created here so a fresh environment matches production.
create table if not exists public.shopify_webhook_events (
  webhook_id          text primary key,
  topic               text,
  shop_domain         text,
  processed_at        timestamptz not null default now()
);

create index if not exists shopify_webhook_events_processed_idx
  on public.shopify_webhook_events (processed_at);

-- ── updated_at triggers ─────────────────────────────────────
drop trigger if exists catalog_products_updated_at on public.catalog_products;
create trigger catalog_products_updated_at
  before update on public.catalog_products
  for each row execute function public.set_updated_at();

drop trigger if exists catalog_variants_updated_at on public.catalog_variants;
create trigger catalog_variants_updated_at
  before update on public.catalog_variants
  for each row execute function public.set_updated_at();

drop trigger if exists catalog_product_images_updated_at on public.catalog_product_images;
create trigger catalog_product_images_updated_at
  before update on public.catalog_product_images
  for each row execute function public.set_updated_at();

drop trigger if exists catalog_collections_updated_at on public.catalog_collections;
create trigger catalog_collections_updated_at
  before update on public.catalog_collections
  for each row execute function public.set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────
-- The backend uses the service role and bypasses RLS. These policies exist so
-- a merchant reading directly with an anon key can only ever see their own rows.
alter table public.catalog_sync_runs          enable row level security;
alter table public.catalog_products           enable row level security;
alter table public.catalog_variants           enable row level security;
alter table public.catalog_product_images     enable row level security;
alter table public.catalog_collections        enable row level security;
alter table public.catalog_collection_products enable row level security;
alter table public.shopify_webhook_events     enable row level security;

drop policy if exists "Users can view their own sync runs" on public.catalog_sync_runs;
create policy "Users can view their own sync runs"
  on public.catalog_sync_runs for select
  using (account_id in (select id from public.accounts where user_id = auth.uid()));

drop policy if exists "Users can view their own catalog products" on public.catalog_products;
create policy "Users can view their own catalog products"
  on public.catalog_products for select
  using (account_id in (select id from public.accounts where user_id = auth.uid()));

drop policy if exists "Users can view their own catalog collections" on public.catalog_collections;
create policy "Users can view their own catalog collections"
  on public.catalog_collections for select
  using (account_id in (select id from public.accounts where user_id = auth.uid()));

drop policy if exists "Users can view their own catalog variants" on public.catalog_variants;
create policy "Users can view their own catalog variants"
  on public.catalog_variants for select
  using (
    product_id in (
      select p.id from public.catalog_products p
      where p.account_id in (select id from public.accounts where user_id = auth.uid())
    )
  );

drop policy if exists "Users can view their own catalog images" on public.catalog_product_images;
create policy "Users can view their own catalog images"
  on public.catalog_product_images for select
  using (
    product_id in (
      select p.id from public.catalog_products p
      where p.account_id in (select id from public.accounts where user_id = auth.uid())
    )
  );

drop policy if exists "Users can view their own collection links" on public.catalog_collection_products;
create policy "Users can view their own collection links"
  on public.catalog_collection_products for select
  using (
    product_id in (
      select p.id from public.catalog_products p
      where p.account_id in (select id from public.accounts where user_id = auth.uid())
    )
  );
