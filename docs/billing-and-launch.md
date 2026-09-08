# Billing, QA and App Store readiness (Sprint 6)

## Billing

**Decision, confirmed 8 September 2026:** Shopify Billing is the only way
Sillages charges for the social-gallery product, matching production. In
development, only Shopify **test** charges. No real charges, no Stripe, no
change to the app's distribution or to the production configuration.

The decision is pinned by `src/__tests__/billing-policy.test.ts` rather than by
this paragraph: no file in the new product may import, construct or call Stripe;
the legacy Stripe routes must stay legacy-only; `SHOPIFY_BILLING_LIVE` unlocks
real charges only when it is exactly the string `"true"`; a subscription created
without it is marked as a test charge; the development environment file may not
enable live billing; the production TOML keeps its own identity and scopes; and
the development TOML declares no distribution at all.

That last one matters: **choosing a distribution is permanent.** An app with
none chosen still installs on a development store and still supports test
charges, which is everything staging needs.

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

## Plan enforcement

Publishing is the paid feature, and losing a plan takes it away.

- `shop_subscriptions` mirrors Shopify's subscription per shop: status, plan,
  whether it is a test charge, and the period end. Shopify stays the source of
  truth; this is what the storefront can consult without a round trip.
- `app_subscriptions/update` is registered. A cancellation, a declined payment,
  a freeze for non-payment or an expiry disables a published gallery.
- `composePublicGallery` re-checks the entitlement before serving, so a gallery
  stops being served even if that webhook never arrives. Closed by default
  rather than dependent on a delivery.
- Opening the Plan screen reads the subscription from Shopify and writes what it
  reads, so a merchant whose approval webhook was missed is repaired rather than
  left paying with no access.
- A Shopify **test** charge unlocks features while `SHOPIFY_BILLING_LIVE` is
  unset, because that is how the flow is exercised before launch, and unlocks
  nothing once it is `true`.
- Choosing a plan is step 4 of the five-step onboarding, so it is part of the
  journey rather than a wall discovered at the end of it.

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

> **Do this before testing the gallery itself.** Publishing is gated on a live
> plan, so a store with no subscription serves nothing and the storefront will
> look broken when it is behaving correctly. The backend logs
> `not served — none` in that case. A test charge grants full access while
> `SHOPIFY_BILLING_LIVE` is unset.

With `SHOPIFY_BILLING_LIVE` unset, subscribe to Basic and to Growth, confirm
Shopify shows a **test** charge and a 14-day trial. Then cancel and confirm the
opposite: the gallery stops being served, the Publish screen explains why, and
re-subscribing brings it back.

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

**Privacy answers.** No customer personal data is collected. Mandatory privacy
webhooks implemented, with erasure verified against a real database.

**Scopes.** The development app (`shopify.app.dev.toml`, see
`docs/dev-shopify-app.md`) requests exactly `read_products`, `read_inventory`
and `write_pixels`. The **public** app still requests the twelve legacy scopes,
including `read_all_orders`, `read_customers` and `write_products`, which the
new product no longer uses. Reducing that list, and adding `write_pixels`, is a
deliberate change to the public listing that has not been made — and until
`write_pixels` is granted there, the Web Pixel cannot be activated on a
production store and checkout is not measured.
