-- ============================================================
-- Review follow-up — one gallery per shop, enforced
--
-- getGallery() creates a row when none exists, and the admin loads two
-- endpoints that both call it in one Promise.all. On a shop's very first load
-- both could find nothing and both insert, leaving two configs: saves landed on
-- one, listVersions read the other, and a published gallery showed an empty
-- history.
--
-- The existing unique index was partial on status='published', which does not
-- cover a shop that has never published.
-- ============================================================

-- Collapse any duplicates before the constraint goes on, keeping the oldest.
delete from public.gallery_configs g
where exists (
  select 1 from public.gallery_configs keep
  where keep.connection_id = g.connection_id
    and (keep.created_at, keep.id) < (g.created_at, g.id)
);

create unique index if not exists gallery_configs_one_per_connection_idx
  on public.gallery_configs (connection_id);
