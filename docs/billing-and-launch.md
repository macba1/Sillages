# Billing, QA and App Store readiness (Sprint 6)

## Billing

Shopify Billing only. A charge appears on the merchant's Shopify invoice; Stripe
is not part of this product and its routes stay retired in `social_gallery`.

| Plan | Price | Trial |
|---|---|---|
| Basic | $29 / month | 14 days |
| Growth | $79 / month | 14 days |
| Pro | $149 / month | announced, **not on sale** — the API refuses to subscribe to it |

### No real charge can happen by accident

`SHOPIFY_BILLING_LIVE` must be the literal string `"true"` for a live charge.
Anything else — unset, `"false"`, `"TRUE"`, `"1"` — creates a Shopify **test**
charge, and a test is pinned to that. The Plan screen states plainly that
billing is in test mode so nobody believes they have paid.

Switching to live billing is a deliberate, single change, made after App Store
approval. **It has not been made.**

### Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/subscription` | what the merchant is on, read back from Shopify rather than from our own record |
| `POST /api/subscription` | starts a plan, returns Shopify's approval URL |
| `GET /api/subscription/callback` | where Shopify returns after approval |

If Shopify is unreachable the screen says so instead of showing a blank plan.

## Uninstall, reinstall and erasure

- **Uninstall** disables the gallery first, so the storefront stops serving it
  even if the theme still has the block, then the legacy handler marks the
  connection disconnected.
- **Reinstall** reuses the existing connection; the gallery comes back as a
  draft, not silently live.
- **`shop/redact`** deletes everything. Ten tables cascade from
  `shopify_connections`; `preview_projects` does not, because a preview exists
  before a shop ever connects, so it is deleted explicitly by shop domain. This
  is verified against a real database in
  `catalog-store.integration.test.ts` — seed every table, delete, count what
  survives — rather than reasoned about.

## Storefront performance budget

Enforced by a test, so exceeding it is a decision rather than a surprise on a
merchant's Lighthouse score:

| Asset | Budget |
|---|---|
| `social-gallery.js` | 16 KB |
| `gallery-core.js` | 10 KB |
| `social-gallery.css` | 14 KB |
| **Total downloaded** | **36 KB** uncompressed |

The same test asserts the block renders no content (so it cannot delay first
paint), that the script is a deferred module, that every `<img>` is lazy and
async-decoded, that no third-party code is imported at runtime, that every fetch
goes to a relative path, and that every CSS selector is scoped so it cannot leak
into a merchant's theme.

## What still needs a real store — nothing here is verified

These are the manual scripts to run once a development store exists. **None has
been run.**

### Themes (Dawn plus two more)

For each theme: add the block from the theme editor, confirm the gallery renders,
open a product, switch a variant, add to cart, confirm the cart updates, remove
the block, and confirm the storefront is byte-identical to before.

### Install lifecycle

1. Install from a preview → the chosen design is recovered as a draft.
2. Install from the App Store with no preview → blank setup, four steps.
3. Update scopes → existing gallery and catalogue survive.
4. Uninstall → gallery stops serving; storefront unaffected.
5. Reinstall → connection reused, gallery still a draft.
6. `shop/redact` → nothing left.

### Mobile performance

Lighthouse on a product page and on the gallery page, before and after adding
the block, on a throttled mobile profile. Record CLS in particular: the skeleton
has a fixed aspect ratio precisely to keep it at zero.

### Billing

With `SHOPIFY_BILLING_LIVE` unset, subscribe to Basic and to Growth, confirm
Shopify shows a **test** charge and a 14-day trial, then cancel.

## App Store listing — prepared, not submitted

Draft copy and the screenshot specification live below so nothing has to be
invented under time pressure. **The public listing has not been touched and
nothing has been submitted for review**, as instructed.

**Name.** Sillages — Shoppable social gallery

**Tagline.** Turn your catalogue into a social gallery that sells.

**Short description.** Sillages turns your Shopify catalogue into a shoppable
social gallery and keeps it in sync automatically. No photos to upload, no
products to tag, no Instagram to connect, no editor to learn.

**Key benefits.**
- Publish in minutes: pick a collection, pick a look, publish.
- Always current: products, prices, photos and stock stay in sync on their own.
- Shoppable: shoppers choose a variant and add to cart without leaving the feed.
- Reversible: your theme code is never edited, and removing the block removes
  the gallery completely.
- Measured: see what shoppers looked at, saved, shared and bought.

**Screenshots to capture (6).** 1 — the gallery on a phone. 2 — the product
sheet with the variant picker. 3 — the Collections screen. 4 — the Design screen
with the three looks. 5 — the Preview screen. 6 — the Performance funnel.

**Video (30s).** A store's product grid, then the same store as a gallery, then
a variant chosen and added to cart, then the Publish screen and the one-click
publish.

**Privacy answers.** No customer personal data is collected. Scopes requested:
`read_products`, `read_inventory`. Mandatory privacy webhooks implemented, with
erasure verified against a real database.
