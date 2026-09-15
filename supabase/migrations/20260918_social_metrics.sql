-- ============================================================
-- Social metrics
--
-- The gallery now measures things the first aggregate did not know about:
-- stories opened and read to the end, which channel a share went through,
-- lists created and opened, and votes cast.
--
-- `create or replace` on a function that already returns a table cannot add
-- columns, so the old one is dropped and rebuilt. Nothing reads it between the
-- two statements — they are in one transaction — and the shape is a superset,
-- so the application keeps working whichever version is live.
-- ============================================================

drop function if exists public.gallery_event_totals(uuid, timestamptz);

create function public.gallery_event_totals(
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
  sessions          bigint,
  story_opens       bigint,
  story_completions bigint,
  picks_created     bigint,
  picks_visits      bigint,
  friend_votes      bigint,
  shares_link       bigint,
  shares_whatsapp   bigint,
  shares_native     bigint,
  shares_other      bigint
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
    count(distinct session_id)                            as sessions,
    count(*) filter (where event_type = 'story_open')     as story_opens,
    -- A story counts as read only when the viewer reported reaching the end.
    count(*) filter (
      where event_type = 'story_close' and meta ->> 'completed' = 'true'
    )                                                     as story_completions,
    count(*) filter (
      where event_type in ('picks_created', 'picks_vote_created')
    )                                                     as picks_created,
    count(*) filter (where event_type = 'picks_visit')    as picks_visits,
    count(*) filter (where event_type = 'friend_vote')    as friend_votes,
    count(*) filter (where event_type = 'share' and meta ->> 'channel' = 'link')     as shares_link,
    count(*) filter (where event_type = 'share' and meta ->> 'channel' = 'whatsapp') as shares_whatsapp,
    count(*) filter (where event_type = 'share' and meta ->> 'channel' = 'native')   as shares_native,
    count(*) filter (where event_type = 'share' and meta ->> 'channel' = 'other')    as shares_other
  from public.gallery_events
  where connection_id = p_connection_id
    and occurred_at >= p_since;
$$;

grant execute on function public.gallery_event_totals(uuid, timestamptz) to authenticated, service_role;

-- Most saved and most shared, alongside the opens and adds that already existed.
drop function if exists public.gallery_top_products(uuid, timestamptz, integer);

create function public.gallery_top_products(
  p_connection_id uuid,
  p_since timestamptz,
  p_limit integer default 10
)
returns table (
  product_id   bigint,
  opens        bigint,
  add_to_carts bigint,
  saves        bigint,
  shares       bigint
)
language sql
stable
as $$
  -- The column is product_shopify_id; product_id is this function's own output
  -- name. Selecting `product_id` here resolves to the OUT parameter, not to a
  -- column, and Postgres rejects it.
  select
    e.product_shopify_id                                 as product_id,
    count(*) filter (where e.event_type = 'post_open')   as opens,
    count(*) filter (where e.event_type = 'add_to_cart') as add_to_carts,
    count(*) filter (where e.event_type = 'save')        as saves,
    count(*) filter (where e.event_type = 'share')       as shares
  from public.gallery_events e
  where e.connection_id = p_connection_id
    and e.occurred_at >= p_since
    and e.product_shopify_id is not null
  group by e.product_shopify_id
  order by
    count(*) filter (where e.event_type = 'add_to_cart') desc,
    count(*) filter (where e.event_type = 'save') desc,
    count(*) filter (where e.event_type = 'post_open') desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

grant execute on function public.gallery_top_products(uuid, timestamptz, integer) to authenticated, service_role;
