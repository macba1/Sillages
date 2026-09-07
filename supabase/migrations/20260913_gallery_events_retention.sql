-- ============================================================
-- Retention for measurement data
--
-- gallery_events has no ceiling: a busy storefront emits a post_view per
-- product per shopper. Unbounded growth is a real operational risk here — this
-- project has already had a Supabase instance saturated once — and keeping raw
-- per-shopper events forever is not defensible under a privacy policy that says
-- measurement is aggregate.
--
-- Raw events are kept for 90 days, which covers the longest reporting window
-- the panel offers. Attribution is kept for 400 days, because revenue is what a
-- merchant looks back at across a year. Saves are state, not history, and are
-- kept while the shop is installed.
-- ============================================================

create or replace function public.purge_gallery_events(
  p_event_days integer default 90,
  p_attribution_days integer default 400,
  p_limit integer default 50000
)
returns table (
  events_deleted      bigint,
  attribution_deleted bigint
)
language plpgsql
as $$
declare
  v_event_cutoff timestamptz := now() - make_interval(days => greatest(1, p_event_days));
  v_attr_cutoff  timestamptz := now() - make_interval(days => greatest(1, p_attribution_days));
  v_events bigint;
  v_attr   bigint;
begin
  -- Bounded so one run cannot lock the table for minutes on a large database.
  -- The scheduler repeats until a run deletes nothing.
  with doomed as (
    select id from public.gallery_events
    where occurred_at < v_event_cutoff
    order by occurred_at
    limit greatest(1, least(coalesce(p_limit, 50000), 200000))
  )
  delete from public.gallery_events e
  using doomed
  where e.id = doomed.id;
  get diagnostics v_events = row_count;

  with doomed as (
    select id from public.gallery_attribution
    where occurred_at < v_attr_cutoff
    order by occurred_at
    limit greatest(1, least(coalesce(p_limit, 50000), 200000))
  )
  delete from public.gallery_attribution a
  using doomed
  where a.id = doomed.id;
  get diagnostics v_attr = row_count;

  return query select v_events, v_attr;
end;
$$;

-- Webhook idempotency keys are only useful for as long as Shopify might retry.
create or replace function public.purge_webhook_events(p_days integer default 30)
returns bigint
language plpgsql
as $$
declare
  v_deleted bigint;
begin
  delete from public.shopify_webhook_events
  where processed_at < now() - make_interval(days => greatest(1, p_days));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

grant execute on function public.purge_gallery_events(integer, integer, integer) to service_role;
grant execute on function public.purge_webhook_events(integer) to service_role;
