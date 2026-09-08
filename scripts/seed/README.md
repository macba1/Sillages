# Development catalogue

`dev-catalogue.csv` fills the development store with enough real-shaped data to
test the gallery. It is imported through the store admin, which needs **no
change to the app's permissions** — the app keeps `read_products` and never asks
for `write_products` just to create test data.

## What it contains

| | |
|---|---|
| Products | 58 (plus the 12 already in the store = 70, comfortably past the 50 the Sprint 1 criterion needs) |
| Variants | 3 per product — Size × Shade, so the variant picker has something real to resolve |
| Photographs | 3 per product, fetched by Shopify from a public image service |
| Drafts | 3, deliberately — the storefront must never serve them, and that filter is one of the things staging has to prove |
| Out of stock | 5 variants at zero, to prove "Sold out" renders and quick buy is disabled |
| Compare-at prices | on the middle variant, so a price range renders |

Generated deterministically, so re-importing produces the same catalogue.

## Importing

1. Shopify admin → **Products** → **Import**
2. Upload `scripts/seed/dev-catalogue.csv`
3. Leave "Overwrite any current products that have the same handle" **unticked**
   on a first run; tick it to re-seed
4. Import. Shopify fetches the images itself; give it a few minutes

## Afterwards

- Products → confirm ~70 products and that three are drafts
- Collections → add some of the seeded products to a collection, so a
  collection-scoped gallery can be tested against something other than
  "every product"

## Never against a real store

This is test data. It carries the `seed` tag and the vendor `Sillages Dev`, so
it is easy to find and remove, but it should only ever be imported into a
development store.
