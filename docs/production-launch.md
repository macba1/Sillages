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
- Shopify App Pricing: Basic $9.99 with a 14-day trial, and nothing else on
  sale. Growth ($19.99) and Pro ($49.99) are shown as coming soon and cannot
  be subscribed to.

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

---

# What happened on the day — 2026-09-14

The pivot is live on the public app. One thing blocks the last step, and it is
not a defect in this codebase.

## Blocked: nobody can subscribe, so nobody can publish

Choosing a plan in production answers, from Shopify:

> Cannot use the Billing API (to create charges) when on Shopify App Pricing.

The public app is enrolled in **Shopify App Pricing** (Shopify-managed pricing),
under which Shopify owns the subscription and the Billing API refuses to create
charges. The app's own plan picker therefore cannot start a subscription, and
publishing is entitlement-gated, so no gallery can go live.

The gate itself behaves correctly: Publish is disabled and says "Choose a plan
to publish your gallery."

Two ways forward, both a pricing decision rather than a code change, and both
left for Antonio:

1. **Stay on Shopify App Pricing.** Configure the plans (Basic $29, Growth $79)
   in the app's pricing settings, and change the Plan screen from a charge
   creator into a link to Shopify's own pricing page. Entitlements keep working:
   `app_subscriptions/update` fires for managed subscriptions too, and that is
   already what feeds `shop_subscriptions`.
2. **Leave Shopify App Pricing** and use the Billing API the code already
   implements. This changes how the app charges every future merchant, so it is
   not something to flip while nobody is watching.

Nothing was changed in the app's pricing configuration.

## Also fixed during the launch, from production behaviour

- The root route served the daily-brief landing to merchants who had just
  installed the gallery. `/` now goes to the product in social_gallery.
- `resolveShopByAccount` used `maybeSingle()`, so any account with more than one
  Shopify connection was told "No Shopify store connected". The demo account has
  three.
- Supabase Auth's redirect allow list held only `https://sillages.app/**`, while
  the backend redirects to `www`. The magic link fell back to the site root and
  the merchant arrived signed out. `https://www.sillages.app/**` added.

## Day of launch — 14 September 2026

The pivot went live on the existing public app. The App Store listing was
replaced in place: it is now **Sillages: Social Gallery**, $9.99/month with a
free trial, with new feature media and four screenshots taken from production.
Every reference to the daily brief is gone from the listing, the app shell and
the legal pages.

### Plans

Shopify App Pricing now has exactly one public plan.

| Plan | Before | Now |
|---|---|---|
| `basic` | $29/month | **$9.99/month**, 14-day trial, free on development stores |
| `growth` | $79/month, public | deleted — see below |
| `pro` | $59/month, public | deleted |
| `starter` | $19/month, public | deleted |

`starter` and `pro` were leftovers from the daily brief. `growth` was on sale
advertising multiple galleries, revenue attribution, automatic reordering and
design experiments; none of the four exist, and `multiple_galleries` is
contradicted outright by the `gallery_configs_one_per_connection_idx` unique
index. Shopify has no draft state for a plan — it is public or it is gone — so
Growth is a draft in `socialGalleryPlans.ts` (`status: 'coming_soon'`) and no
longer exists in Shopify.

All three were deleted only after confirming zero real subscribers from three
independent sources: Shopify's own **$0.00 total earnings to date** on the app,
"Removed subscriptions: no data" in the Dev Dashboard, and a single row in
production's `shop_subscriptions` with `status = 'none'`. Shopify's own
confirmation dialog states that any merchant already subscribed stays
subscribed; there were none.

### The app handle

`/charges/<handle>/pricing_plans` needs the **installed app handle**, which is
`sillages-1`. The listing slug is `sillages`, and using it sent every merchant
to Settings → Apps with no explanation — Shopify redirects an unknown handle
instead of erroring, so the failure was silent. Fixed in `shopifyBilling.ts`
and pinned by a test.

### Defects found by running the real journey

Three, all in production, all fixed and redeployed:

1. **The add-to-cart button was invisible on every storefront.** `.sg-buy` set
   `background: currentColor` and `color: Canvas` in the same rule;
   `currentColor` resolves against the element's own `color`, so the fill and
   the text were both Canvas. Quick buy looked like it had no button.
2. **Saves and shares were never sent.** The event queue only emptied at 20
   events, on add-to-cart, or on a single `pagehide`. A shopper who browsed,
   saved and shared produced nothing. "Essential interaction metrics" is a
   feature Basic advertises.
3. **The Performance screen promised a pixel that does not ship**, and showed a
   "Purchases 0" row that reads as "nobody bought" rather than "not measured".

### What was exercised in production

On `sillages-storefront-test.myshopify.com`, a development store created for
this, with the public app installed from the App Store listing:

| Step | Result |
|---|---|
| Install with minimal scopes | consent screen showed "Products" only |
| Choose Basic on Shopify's hosted page | free test charge, no billing |
| Plan confirmed by the API | ACTIVE Basic, renews 28/09/2026 |
| Publishing unblocked by the plan | Publish enabled, version 1 |
| Theme app block added in the theme editor | gallery renders on the storefront |
| Catalogue | 15 products, prices, SOLD OUT honoured |
| Stories | row of collection circles |
| Quick buy | variant picker, add to cart, "added to your cart" |
| Save | heart fills, survives a reload, counted |
| Metrics | views, opens, add-to-cart and saves all arrive |
| Visual style | changed to Film, republished, served as `style: film` |
| Turn off | storefront API returned `active: false`, 0 products |
| Turn on | `active: true`, version 3, 15 products |
| Versions | three versions listed, earlier ones restorable |

Not exercised: the share event reaching metrics (the control renders and is
clickable; the theme editor stopped accepting clicks before it could be
repeated after the fix), the storefront at mobile width, and a live plan
cancellation — Shopify's managed pricing page offers no cancel control when a
single plan exists, and cancelling would mean uninstalling. Publishing being
blocked *without* a plan was observed directly on the other store.

### The Web Pixel

Still not active anywhere. It is bundled in the app version because it is part
of the app configuration and removing it would need `--allow-deletes`, but it
is never activated: that needs `write_pixels`, which the app does not request.
The store's own app page shows **Extensions: 1 active**.

