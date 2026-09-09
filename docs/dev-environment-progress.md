# Staging validation on the development store — 2026-09-09

Development app **Sillages (development)** (`420760748033`, org `208487189`),
development store **sillages-gallery-dev.myshopify.com**. The public production
app and its store were not touched at any point.

## The merchant journey, executed end to end

Every line below was run against Shopify, not asserted from code.

| Step | Evidence | Verdict |
|---|---|---|
| Install and OAuth | callback 302, connection row with token, app version `sillages-development-7` | `Verificado` |
| Exactly four scopes | `read_customer_events,read_inventory,read_products,write_pixels` on the stored row | `Verificado` |
| Lands on the gallery, not the old product | `/collections` with the Social Gallery navigation | `Verificado` |
| Catalogue import | 75 products, 200 variants, 3 collections, 134 images — matches Shopify exactly | `Verificado` |
| Real webhooks | 430 `products/update` deliveries processed during a CSV import; `inventory_levels/update` handled | `Verificado` |
| Web Pixel | `webPixelCreate` at install; `checkout_started` and `purchase` received from the storefront | `Verificado` |
| Theme app extension | block added to a Dawn theme, rendered on the storefront with the dev API base | `Verificado` |
| Quick buy | correct variant added — "The Complete Snowboard - Ice", $699.95 | `Verificado` |
| Test purchase | Bogus Gateway order `#XEDVUAA8W`, then a second order at $629.95 | `Verificado` |
| Attribution | `gallery_attribution` row, order `6670044528828`, match `session`, $629.95 | `Verificado` |
| Shopify Billing test charge | Basic then Growth, `is_test = true`, 14-day trial, Pro not subscribable | `Verificado` |
| Cancellation switches the gallery off | subscription cancelled → gallery `disabled` → public gallery `active: false` | `Verificado` |
| Uninstall leaves no trace on the storefront | no container, no assets, theme's own 6 sections intact | `Verificado` |

## What this run cost the product, in defects found

Each was found by running the journey, not by reading code, and each is fixed
and committed on `pivot/social-gallery`:

1. Install requested the legacy twelve scopes, because the Shopify CLI puts
   `SCOPES` in the environment.
2. `app_client_id` and `refresh_token` existed only in production, added by
   hand — any environment rebuilt from migrations failed the install.
3. A photo shared between products erased itself from all but one of them.
4. The legacy reconnection sync ran in `social_gallery` and only ever 403'd.
5. Reinstalling dropped the merchant on `/login`.
6. The `/dashboard` alias discarded the fragment carrying the session.
7. Shopify stopped accepting non-expiring offline tokens; nothing requested an
   expiring one.
8. Nothing refreshed the expiring token in `social_gallery`, so everything 401'd
   an hour after install.
9. Performance told merchants the pixel was off while it was reporting.
10. Upgrading Basic → Growth switched the merchant's gallery off.
11. Uninstall wrote a `sync_status` the schema rejects, so no shop was ever
    actually marked disconnected.

## Open, and deliberately not closed here

- **Purchase reporting is behind `ENABLE_PIXEL_PURCHASE_REPORTING`**, on only in
  the dev launcher. The endpoint accepts revenue from anyone holding a gallery
  ingest token, and those are handed to every storefront visitor. Attribution
  cannot ship to production until that is closed.
- **Production still has `use_legacy_install_flow = false`** while the backend
  implements the classic authorize flow. The development app needed `true`
  before OAuth would complete.
- **Public distribution was selected on the development app**, with Antonio's
  explicit authorisation, because Shopify refuses the Billing API without it.
  The choice is irreversible. Nothing was submitted for review.
- Seeded inventory: 58 products have photos but no stock. The store has two
  locations, so the product CSV cannot set quantities, and the admin's inventory
  importer keeps its file input inside shadow DOM.
- An empty `apps` section remains in the live `test-data` template. It renders
  nothing; the CLI rejects the cleanup push because that Shopify-managed theme
  has no section files locally.
- `shop/redact` arrives 48 hours after uninstall, so it could not be observed in
  this run.
- Lighthouse, accessibility and a full mobile pass were not run.

## Manual interventions, declared

- A `shop_subscriptions` row was inserted by hand early on to reach Publish
  before Billing worked. It was deleted before the real Billing test, and every
  billing result above comes from real Shopify charges.
- The catalogue was re-imported through the admin's CSV importer to give the
  seeded products photos.
- The theme app extension block was added to Dawn by pushing the template with
  the CLI, because the theme editor UI does not render in this environment.
