-- Purchases and revenue now come from Shopify's signed orders/create webhook,
-- not from the storefront. The browser can no longer report an order at all, so
-- a third source has to be tellable from the other two: 'gallery' is the theme
-- block, 'web_pixel' is the sandboxed pixel, and 'shopify' is the shop's own
-- ledger.
--
-- Rows already stored as 'web_pixel' purchases came from the old public
-- endpoint. They are left as they are: rewriting them would claim Shopify
-- confirmed something it never sent.

alter table public.gallery_events
  drop constraint if exists gallery_events_source_check;

alter table public.gallery_events
  add constraint gallery_events_source_check
  check (source in ('gallery', 'web_pixel', 'shopify'));

comment on column public.gallery_events.source is
  'Who reported the event: gallery (theme block), web_pixel (sandboxed pixel), shopify (signed webhook). Only shopify may carry money.';
