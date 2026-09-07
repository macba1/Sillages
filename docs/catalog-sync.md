# Live Shopify catalogue (Sprint 1)

How the social-gallery product keeps a shop's catalogue mirrored and current.
Everything here runs only when `PRODUCT_MODE=social_gallery`; see
`docs/product-modes.md`.

## Shape

| Piece | File |
|---|---|
| GraphQL Admin client (current API version, throttle-aware) | `backend/src/lib/shopifyCatalog.ts` |
| Paginated readers (products, variants, images, collections, membership) | `backend/src/services/catalog/catalogFetch.ts` |
| Persistence contract | `backend/src/services/catalog/catalogStore.ts` |
| Supabase implementation | `backend/src/services/catalog/supabaseCatalogStore.ts` |
| Full sync + reconciliation | `backend/src/services/catalog/catalogSync.ts` |
| Webhook handlers | `backend/src/services/catalog/catalogWebhooks.ts` |
| Webhook dispatch (idempotency, legacy topics) | `backend/src/services/catalog/catalogWebhookRouter.ts` |
| Webhook registration over GraphQL | `backend/src/services/catalog/catalogWebhookSetup.ts` |
| Nightly reconciliation cron | `backend/src/services/catalog/catalogScheduler.ts` |
| Install hook | `backend/src/services/catalog/catalogInstall.ts` |
| HTTP surface | `backend/src/routes/catalog.ts` |
| Tables | `supabase/migrations/20260904_social_gallery_catalog.sql` |

The legacy Shopify client (`backend/src/lib/shopify.ts`, REST/GraphQL 2024-04) is
untouched and still serves the legacy product.

## API version

`SHOPIFY_CATALOG_API_VERSION = '2026-01'`, matching the `api_version` already
declared for webhooks in `shopify.app.toml`. Bumping it is a one-line change in
`lib/shopifyCatalog.ts`.

## Required Shopify scopes

`read_products` and `read_inventory`, both already present in the current
`access_scopes`. **Sprint 1 requests no new permission.** Trimming the scope list
down to the minimum is a separate, deliberate change.

## Three ways the catalogue stays current

1. **Install** — `onShopifyConnected()` registers the catalogue webhooks and runs
   the first full import.
2. **Webhooks** — `products/*`, `collections/*` and `inventory_levels/update`
   apply changes as they happen. Product and collection payloads are treated as
   a notification: the entity is re-read over GraphQL so the stored row is always
   complete, which also makes a redelivery harmless.
3. **Nightly reconciliation** — 04:20, a full re-read per shop. This is the
   safety net for a webhook that never arrived.

## Rules that protect a merchant's data

- **Deletions are soft.** A product that disappears gets `deleted_at`; the row
  survives, so a mistake is recoverable and history is not lost.
- **A failed sync never deletes.** Reconciliation runs only after a complete,
  successful pass. A network failure half-way through leaves the catalogue
  exactly as it was.
- **One sync per shop at a time.** A partial unique index on
  `catalog_sync_runs (connection_id) where status = 'running'` is the lock; a
  second sync returns `already_running` instead of racing.
- **Everything is scoped by `connection_id`,** so one shop can never read or
  overwrite another's rows.
- **Resurrection over duplication.** A product that comes back is restored in
  place, not inserted again.
- **Heartbeats.** Long runs update `heartbeat_at`, so a stalled run is
  detectable rather than looking "in progress" forever.

## Endpoints (social_gallery only)

| Endpoint | Purpose |
|---|---|
| `GET /api/catalog/status` | product count, collection count, last sync run |
| `GET /api/catalog/collections` | collections available for a gallery |
| `POST /api/catalog/sync` | manual re-sync for diagnosis, max 5 per 10 min per account |

`POST /api/catalog/sync` answers `409 already_running` when a sync is in flight
and `502` when the Shopify read failed.

## Tables

`catalog_products`, `catalog_variants`, `catalog_product_images`,
`catalog_collections`, `catalog_collection_products`, `catalog_sync_runs`, and
`shopify_webhook_events` (which production already had but no migration
described). All additive; no legacy table is altered.

RLS is enabled on every one. The backend uses the service role and bypasses it;
the policies exist so a merchant reading with an anon key sees only their rows.

## Testing without production data

```bash
cd backend && npm test
```

- `src/__tests__/catalog-sync.test.ts` — full import of a 137-product store,
  page draining, nested variant/image pages, idempotency, reconciliation,
  and the guarantee that a failed sync deletes nothing.
- `src/__tests__/catalog-webhooks.test.ts` — price, photo, variant, inventory and
  collection changes; deletions; redelivery; malformed payloads; legacy topics
  ignored; `app/uninstalled` still delegated.

Both run against `src/__tests__/helpers/fakeShopify.ts` (an in-memory GraphQL
double with real cursor pagination) and
`src/__tests__/helpers/memoryCatalogStore.ts`. No network, no credentials, no
production data.

To validate the migration itself against a real Postgres:

```bash
docker run -d --name sillages-pg-test -e POSTGRES_PASSWORD=devonly \
  -e POSTGRES_DB=sillages_dev -p 55432:5432 postgres:16-alpine
# create accounts / shopify_connections / set_updated_at, then:
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20260904_social_gallery_catalog.sql
```

The migration is re-runnable: every statement is `if not exists` or
`drop ... if exists` first.
