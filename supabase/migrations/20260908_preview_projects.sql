-- ============================================================
-- Sprint 5 — Public before/after generator
--
-- Additive. A preview is built from a shop's own public storefront data and
-- belongs to nobody until that shop installs Sillages and claims it.
-- ============================================================

create table if not exists public.preview_projects (
  id                  uuid primary key default uuid_generate_v4(),

  -- The shop this preview was built for, normalised.
  shop_domain         text not null,
  source_url          text not null,
  shop_name           text,

  status              text not null default 'pending'
                        check (status in ('pending', 'ready', 'failed', 'claimed', 'expired')),
  error               text,

  -- The three proposals and the products they were built from. Public
  -- storefront data only: titles, handles, prices, image URLs.
  proposals           jsonb not null default '[]'::jsonb,
  products            jsonb not null default '[]'::jsonb,
  product_count       integer not null default 0,

  -- Unguessable, and the only way to open the preview.
  public_token        text not null,

  -- Set when the shop installs Sillages and the proposal is recovered.
  claimed_by_connection_id uuid references public.shopify_connections(id) on delete set null,
  claimed_at          timestamptz,
  claimed_proposal    text,

  expires_at          timestamptz not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint preview_projects_public_token_key unique (public_token)
);

create index if not exists preview_projects_shop_idx
  on public.preview_projects (shop_domain, created_at desc);
create index if not exists preview_projects_expiry_idx
  on public.preview_projects (expires_at) where status <> 'claimed';

drop trigger if exists preview_projects_updated_at on public.preview_projects;
create trigger preview_projects_updated_at
  before update on public.preview_projects
  for each row execute function public.set_updated_at();

-- ── Claim tokens ────────────────────────────────────────────
-- Handed to Shopify as OAuth state so the right preview is recovered after an
-- install, without trusting anything the browser sends back.
create table if not exists public.preview_claim_tokens (
  token               text primary key,
  preview_project_id  uuid not null references public.preview_projects(id) on delete cascade,
  proposal            text not null,
  used_at             timestamptz,
  expires_at          timestamptz not null,
  created_at          timestamptz not null default now()
);

create index if not exists preview_claim_tokens_project_idx
  on public.preview_claim_tokens (preview_project_id);
create index if not exists preview_claim_tokens_expiry_idx
  on public.preview_claim_tokens (expires_at);

-- ── RLS ─────────────────────────────────────────────────────
-- Previews are read through the backend by unguessable token, never directly.
alter table public.preview_projects     enable row level security;
alter table public.preview_claim_tokens enable row level security;
