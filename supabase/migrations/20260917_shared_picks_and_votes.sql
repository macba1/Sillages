-- ============================================================
-- Shareable picks, and the informal vote between them
--
-- A shopper saves a few products, presses "Share my picks", and gets a link.
-- Optionally the link is a question — "which one?" — that friends answer with
-- one tap.
--
-- Nothing here identifies anybody:
--   * no name, email, account or profile, and none can be added — there are
--     no columns for them;
--   * a vote is keyed by a random per-browser id the shopper's own device
--     generates, used only to stop the same browser voting twice;
--   * the token is the only way in, and it expires.
--
-- Both tables are additive and are read only through their token.
-- ============================================================

create table if not exists public.gallery_picks (
  id uuid primary key default gen_random_uuid(),
  -- 32 url-safe characters from a CSPRNG. Long enough that guessing one is
  -- not a strategy, short enough to send in a message.
  token text not null unique,
  connection_id uuid not null references public.shopify_connections(id) on delete cascade,
  -- Shopify product ids, in the order the shopper saved them. Bounded by the
  -- application to a sensible maximum.
  product_ids bigint[] not null,
  -- 'list' is a set of picks; 'vote' asks friends to choose between them.
  mode text not null default 'list' check (mode in ('list', 'vote')),
  created_at timestamptz not null default now(),
  -- Retention, in the row itself so a cleanup job needs no other knowledge.
  expires_at timestamptz not null default (now() + interval '90 days'),
  -- The creator's device can delete its own list; nobody else can.
  deleted_at timestamptz
);

create index if not exists gallery_picks_connection_idx on public.gallery_picks (connection_id, created_at desc);
create index if not exists gallery_picks_expiry_idx on public.gallery_picks (expires_at);

create table if not exists public.gallery_pick_votes (
  id uuid primary key default gen_random_uuid(),
  pick_id uuid not null references public.gallery_picks(id) on delete cascade,
  product_id bigint not null,
  -- Random, generated in the voter's browser. Not a fingerprint and not
  -- derived from anything about the person or their device.
  voter_key text not null,
  created_at timestamptz not null default now()
);

-- One vote per browser per list. Changing your mind replaces the row rather
-- than adding one, which the application does with an upsert on this key.
create unique index if not exists gallery_pick_votes_one_per_voter_idx
  on public.gallery_pick_votes (pick_id, voter_key);

create index if not exists gallery_pick_votes_pick_idx on public.gallery_pick_votes (pick_id);

-- Service-role only, exactly like the rest of the gallery tables: everything
-- a shopper reads goes through the API, which checks the token first.
alter table public.gallery_picks enable row level security;
alter table public.gallery_pick_votes enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'gallery_picks' and policyname = 'service_role_all') then
    create policy service_role_all on public.gallery_picks for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'gallery_pick_votes' and policyname = 'service_role_all') then
    create policy service_role_all on public.gallery_pick_votes for all to service_role using (true) with check (true);
  end if;
end $$;

-- Deletes expired lists and, through the cascade, their votes. Called by the
-- same retention job that trims gallery_events.
create or replace function public.purge_expired_picks()
returns integer
language plpgsql
as $$
declare
  removed integer;
begin
  delete from public.gallery_picks
  where expires_at < now() or deleted_at is not null and deleted_at < now() - interval '7 days';
  get diagnostics removed = row_count;
  return removed;
end $$;
