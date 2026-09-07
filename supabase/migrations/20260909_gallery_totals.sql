-- ============================================================
-- Review follow-up — aggregate gallery metrics in the database
--
-- The performance panel used to select up to 50,000 event rows and count them
-- in application code. Two problems: beyond that ceiling the numbers a merchant
-- was shown were silently under-counted, and every page load dragged tens of
-- thousands of rows out of Postgres — the pattern that has saturated this
-- project's database before.
--
-- These functions aggregate in the database instead: one round trip, accurate
-- at any volume, and served from the existing indexes.
--
-- SECURITY INVOKER (the default) on purpose: called with the service role the
-- backend already uses, and if ever called with a merchant's own key, row level
-- security still applies and they see only their own shop.
-- ============================================================

create or replace function public.gallery_event_totals(
  p_connection_id uuid,
  p_since timestamptz
)
returns table (
  gallery_views     bigint,
  post_opens        bigint,
  variant_selects   bigint,
  saves             bigint,
  shares            bigint,
  add_to_carts      bigint,
  purchases         bigint,
  sessions          bigint
)
language sql
stable
as $$
  select
    count(*) filter (where event_type = 'gallery_view')   as gallery_views,
    count(*) filter (where event_type = 'post_open')      as post_opens,
    count(*) filter (where event_type = 'variant_select') as variant_selects,
    count(*) filter (where event_type = 'save')           as saves,
    count(*) filter (where event_type = 'share')          as shares,
    count(*) filter (where event_type = 'add_to_cart')    as add_to_carts,
    count(*) filter (where event_type = 'purchase')       as purchases,
    count(distinct session_id)                            as sessions
  from public.gallery_events
  where connection_id = p_connection_id
    and occurred_at >= p_since;
$$;

create or replace function public.gallery_attribution_totals(
  p_connection_id uuid,
  p_since timestamptz
)
returns table (
  attributed_orders  bigint,
  attributed_revenue numeric,
  currency           text
)
language sql
stable
as $$
  select
    count(*)                        as attributed_orders,
    coalesce(sum(amount), 0)        as attributed_revenue,
    min(currency)                   as currency
  from public.gallery_attribution
  where connection_id = p_connection_id
    and occurred_at >= p_since;
$$;

create or replace function public.gallery_top_products(
  p_connection_id uuid,
  p_since timestamptz,
  p_limit integer default 10
)
returns table (
  product_id    bigint,
  opens         bigint,
  add_to_carts  bigint
)
language sql
stable
as $$
  select
    product_shopify_id as product_id,
    count(*) filter (where event_type = 'post_open')   as opens,
    count(*) filter (where event_type = 'add_to_cart') as add_to_carts
  from public.gallery_events
  where connection_id = p_connection_id
    and occurred_at >= p_since
    and product_shopify_id is not null
    and event_type in ('post_open', 'add_to_cart')
  group by product_shopify_id
  order by add_to_carts desc, opens desc
  limit greatest(1, least(coalesce(p_limit, 10), 100));
$$;

grant execute on function public.gallery_event_totals(uuid, timestamptz)       to authenticated, service_role;
grant execute on function public.gallery_attribution_totals(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.gallery_top_products(uuid, timestamptz, integer) to authenticated, service_role;
