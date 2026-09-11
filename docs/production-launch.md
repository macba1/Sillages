# Launch plan — the social gallery on the existing public app

Prepared, not executed. Nothing in here runs without Antonio's authorisation.

## What ships

The automatic social gallery and nothing else:

- catalogue sync from Shopify (products, variants, images, collections, stock)
- stories, the three looks, heading, quick buy on/off
- likes and saves, share (link, WhatsApp, the device's own sheet)
- quick buy with the correct variant
- publish, republish, turn off, roll back to a previous version
- interaction metrics: gallery views, product views, opens, variants chosen,
  saves, shares, adds to cart
- Shopify Billing exactly as it is today: Basic $29, Growth $79, Pro coming
  soon, 14-day trial, test charges until the listing is approved

## What does not ship, and why

| Not shipping | Reason |
|---|---|
| Web Pixel / checkout and purchase measurement | needs `write_pixels`, which the public app has never been granted. Asking would re-prompt every installed merchant for a permission this release does not use. |
| Revenue attribution | depends on the pixel, or on `read_orders`. Neither is in this launch. The Performance screen already says checkout is not measured. |
| The public purchase endpoint | closed. It accepted revenue from anyone holding a gallery ingest token, and every storefront visitor gets one. |
| A second Shopify app | not needed. This runs on the existing public app. |

## Permissions

Requested scopes go **down**, never up: `read_products, read_inventory`. Both are
already inside the grant every installed merchant gave, so no merchant is
re-prompted and no existing token stops working. New installs see a consent
screen listing "View store data: Products" and nothing else — confirmed on the
development store.

`shopify.app.toml` keeps `use_legacy_install_flow = false`. Managed installation
was verified end to end against the development app configured the same way: it
returns an authorization code to the app's redirect URL, and the standalone
OAuth callback completes normally. An earlier note in this repo blamed that
setting for `redirect_uri is not whitelisted`; the actual cause was a stale dev
preview on the store, and the note was wrong.

## The one-way door, stated plainly

`PRODUCT_MODE=social_gallery` switches the product for **every merchant on the
public app at once**. Briefs, alerts, actions, chat, Tower and the rest stop
being served the moment the backend restarts. That is the pivot, not a bug, but
it is not a gradual rollout: there is no per-shop flag today.

If a staged rollout is wanted instead, that is a change to build before
launching, not something this plan can arrange at deploy time.

## Sequence

Each step is reversible on its own, and each is a separate decision.

1. **Merge.** `pivot/social-gallery` → `develop`, run `npm run premerge`, then
   `develop` → `main` with `./scripts/deploy.sh`. Railway deploys `main`.
   *Reverse:* revert the merge commit and redeploy. The old product is intact in
   the tree; nothing was deleted.

2. **Migrations, before the mode flip.** `./scripts/migrate.sh plan production`,
   then apply what it lists. Twelve migrations are pending, all additive: new
   `catalog_*`, `gallery_*` and `shop_subscriptions` tables, two columns on
   `shopify_connections` that production already has by hand, and one unique
   index correction. None drops or rewrites legacy data.
   *Reverse:* nothing to undo. The legacy product does not read these tables.

3. **Release the theme app extension to the public app.** Build the release from
   a tree **without** `extensions/social-gallery-pixel` — the pixel is not part
   of this launch and should not appear in the app version.
   *Reverse:* release the previous app version from the Dev Dashboard.

4. **Flip the backend.** `PRODUCT_MODE=social_gallery` on Railway, restart.
   *Reverse:* set it back to `legacy` and restart. One environment variable, no
   deploy, seconds.

5. **Flip the frontend.** `VITE_PRODUCT_MODE=social_gallery` on Vercel and
   **rebuild** — the frontend reads it at build time, so unlike the backend this
   is not an instant switch.
   *Reverse:* set it back and rebuild. Minutes, not seconds. Flip the frontend
   last and roll it back first.

6. **Smoke test on a real shop**, in this order: the admin loads Collections with
   the shop's own catalogue; publish; the block renders on the storefront; quick
   buy adds the right variant; Performance shows the interaction counts; turn
   off and confirm the storefront is unchanged.

## Rollback, fastest first

| Symptom | Action | Cost |
|---|---|---|
| Gallery misbehaving on storefronts | merchant turns it off, or set the config to `disabled` | immediate, per shop |
| Product-wide problem | `PRODUCT_MODE=legacy` + restart | seconds |
| Admin broken | `VITE_PRODUCT_MODE=legacy` + rebuild | minutes |
| Bad code | revert the merge, redeploy | one deploy |
| Extension broken | re-release the previous app version | minutes |

Migrations are deliberately not in the rollback path: they add tables the legacy
product ignores.

## Before asking for authorisation

- [ ] `premerge` green on the merge commit
- [ ] `./scripts/migrate.sh plan production` reviewed line by line
- [ ] production `SHOPIFY_SCOPES` confirmed to still contain the two requested
- [ ] a named pilot shop to smoke-test on, and someone watching it
- [ ] agreement that every merchant loses the old product at step 4
