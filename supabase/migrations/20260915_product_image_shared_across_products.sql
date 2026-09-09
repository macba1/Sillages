-- A Shopify ProductImage id is not unique per product.
--
-- When a merchant attaches the same file to several products, Shopify returns
-- the SAME gid://shopify/ProductImage/... under every one of them. The old
-- unique key (connection_id, shopify_id) therefore made those products fight
-- over a single row: a catalogue with 104 image references and 18 distinct ids
-- stored 18 rows, and 65 of 74 products showed no photo at all.
--
-- The identity of a stored image is the pair (product, image).

alter table public.catalog_product_images
  drop constraint if exists catalog_product_images_connection_shopify_key;

-- Collapse anything the old key already merged, keeping the newest row per
-- (connection, product, image) so the re-sync below has a clean base.
delete from public.catalog_product_images a
using public.catalog_product_images b
where a.connection_id = b.connection_id
  and a.product_id = b.product_id
  and a.shopify_id = b.shopify_id
  and a.ctid < b.ctid;

alter table public.catalog_product_images
  add constraint catalog_product_images_connection_product_shopify_key
  unique (connection_id, product_id, shopify_id);
