-- ============================================================
-- Sprint 2 — Gallery configuration and publish history
--
-- Additive. Nothing legacy is altered.
-- ============================================================

-- ── Gallery configuration ───────────────────────────────────
create table if not exists public.gallery_configs (
  id                  uuid primary key default uuid_generate_v4(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  connection_id       uuid not null references public.shopify_connections(id) on delete cascade,

  -- Null means "every product in the catalogue".
  collection_id       uuid references public.catalog_collections(id) on delete set null,

  style               text not null default 'original'
                        check (style in ('original', 'warm', 'film')),
  show_stories        boolean not null default true,
  show_quick_buy      boolean not null default true,
  posts_limit         integer not null default 60 check (posts_limit between 1 and 250),
  heading             text,

  status              text not null default 'draft'
                        check (status in ('draft', 'published', 'disabled')),
  published_at        timestamptz,
  disabled_at         timestamptz,
  -- Bumped on every publish; the storefront uses it to bust its cache.
  version             integer not null default 0,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists gallery_configs_connection_idx
  on public.gallery_configs (connection_id);
-- Basic ships one gallery per shop. The service layer enforces the plan limit;
-- this index makes "the published gallery" an unambiguous lookup.
create unique index if not exists gallery_configs_one_published_idx
  on public.gallery_configs (connection_id)
  where status = 'published';

-- ── Publish history, so "revert" is a real operation ────────
create table if not exists public.gallery_config_versions (
  id                  uuid primary key default uuid_generate_v4(),
  gallery_config_id   uuid not null references public.gallery_configs(id) on delete cascade,
  connection_id       uuid not null references public.shopify_connections(id) on delete cascade,
  version             integer not null,
  -- Full snapshot of the settings that were live at this version.
  snapshot            jsonb not null,
  published_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),

  constraint gallery_config_versions_unique unique (gallery_config_id, version)
);

create index if not exists gallery_config_versions_config_idx
  on public.gallery_config_versions (gallery_config_id, version desc);

-- ── updated_at trigger ──────────────────────────────────────
drop trigger if exists gallery_configs_updated_at on public.gallery_configs;
create trigger gallery_configs_updated_at
  before update on public.gallery_configs
  for each row execute function public.set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────
alter table public.gallery_configs         enable row level security;
alter table public.gallery_config_versions enable row level security;

drop policy if exists "Users can view their own galleries" on public.gallery_configs;
create policy "Users can view their own galleries"
  on public.gallery_configs for select
  using (account_id in (select id from public.accounts where user_id = auth.uid()));

drop policy if exists "Users can view their own gallery versions" on public.gallery_config_versions;
create policy "Users can view their own gallery versions"
  on public.gallery_config_versions for select
  using (
    gallery_config_id in (
      select g.id from public.gallery_configs g
      where g.account_id in (select id from public.accounts where user_id = auth.uid())
    )
  );
