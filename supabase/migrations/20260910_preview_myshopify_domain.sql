-- ============================================================
-- Review follow-up — remember a store's *.myshopify.com name
--
-- A before/after demo is built from whatever address a visitor pastes, which is
-- almost always a custom domain. Shopify's OAuth accepts only the myshopify
-- name, so without this the install button at the end of the funnel answered
-- 400 for nearly every real store.
-- ============================================================

alter table public.preview_projects
  add column if not exists myshopify_domain text;

create index if not exists preview_projects_myshopify_idx
  on public.preview_projects (myshopify_domain)
  where myshopify_domain is not null;
