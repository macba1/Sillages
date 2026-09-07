# Product modes (`PRODUCT_MODE`)

Sprint 0 of the social-gallery pivot. This document describes how the two
product modes are selected, what each one runs, and which environment variables
each one needs.

No secret values appear here — only variable names.

## The two modes

| Mode | Meaning |
|---|---|
| `legacy` | The current Sillages product: daily briefs, alerts, actions, chat, push, Tower, growth workflows, Stripe billing. **Default.** |
| `social_gallery` | The new product: a Shopify catalogue turned into a shoppable social gallery. Sprint 0 ships the isolation layer and the UI shell only. |

`legacy` is the safe default everywhere. An unset `PRODUCT_MODE` keeps the
previous behaviour; an unrecognised value fails validation at boot on the
backend, and falls back to `legacy` on the frontend.

Nothing has been deleted. Switching `PRODUCT_MODE` back to `legacy` restores the
old product completely.

## Where the mode is read

| Layer | Source of truth | Helper |
|---|---|---|
| Backend | `PRODUCT_MODE` (validated in `backend/src/config/envSchema.ts`) | `backend/src/config/productMode.ts` |
| Frontend | `VITE_PRODUCT_MODE` | `frontend/src/config/productMode.ts` |

Do not compare the raw string anywhere else. Use `isLegacyMode()`,
`isSocialGalleryMode()`, `legacyProcessesDisabled()` (backend) or
`isLegacyMode()` / `isSocialGalleryMode()` / `HOME_ROUTE` (frontend).

## Backend behaviour per mode

### Background processes

| Process | `legacy` | `social_gallery` |
|---|---|---|
| `startScheduler()` — event loop, daily/weekly briefs, orchestrator, trial reminders, leads, outreach, nurture, inbox, content engine, Shopify webhook verification | runs | **not started** |
| `startAuditor()` — 6-hourly audit and 2-hourly token check | runs | **not started** |
| `startCatalogScheduler()` — nightly catalogue reconciliation at 04:20 | **not started** | runs |

Both are gated twice: `backend/src/index.ts` only calls them in `legacy`, and
each function returns immediately if the mode is not `legacy`. No `node-cron`
job is registered in `social_gallery`.

### HTTP surface

The mounting table lives in `backend/src/app.ts` (`ROUTE_MANIFEST`). A router
that does not belong to the active mode is not mounted; its prefix answers
`404 { "code": "FEATURE_NOT_AVAILABLE_IN_PRODUCT_MODE" }`.

| Prefix | `legacy` | `social_gallery` |
|---|---|---|
| `GET /health` | yes (reports `productMode`) | yes |
| `/api/auth` | yes | yes |
| `/api/shopify` (OAuth, callback, reconnect, connection, disconnect) | yes | yes |
| `/api/webhooks` (Shopify privacy topics, `app/uninstalled`, HMAC verification) | yes | yes |
| `/api/accounts` | yes | yes |
| `/api/plans` (new product plans) | **no** | yes |
| `/api/catalog` (live Shopify catalogue — see `docs/catalog-sync.md`) | **no** | yes |
| `/api/gallery` (gallery settings, preview, publish — see `docs/theme-extension.md`) | **no** | yes |
| `/api/public` (unauthenticated storefront API, event ingestion and the before/after generator) | **no** | yes |
| `/api/performance` (aggregate gallery metrics) | **no** | yes |
| `/api/subscription` (Shopify Billing — see `docs/billing-and-launch.md`) | **no** | yes |

### Background jobs in `social_gallery`

| Job | When |
|---|---|
| Measurement retention | 03:10 |
| Expired preview cleanup | 03:50 |
| Catalogue reconciliation | 04:20 |
| `/api/briefs`, `/api/billing`, `/api/alerts`, `/api/admin`, `/api/chat`, `/api/push`, `/api/actions`, `/api/unsubscribe`, `/api/tower` | yes | **no** |

Three endpoints live inside routers that stay mounted in both modes, so they are
gated individually with the `legacyOnly` middleware and return the same
controlled 404 in `social_gallery`:

- `POST /api/webhooks/stripe`
- `POST /api/webhooks/resend`
- `POST /api/webhooks/supabase` (sends the legacy welcome email)
- `GET /api/shopify/billing-callback`, `POST /api/shopify/billing/subscribe`,
  `GET /api/shopify/billing/callback`, `GET /api/shopify/billing/status`
  (legacy Shopify Billing, which still references retired plan ids)

## Frontend behaviour per mode

| Route | `legacy` | `social_gallery` |
|---|---|---|
| `/login`, `/forgot-password`, `/reset-password` | yes | yes |
| `/`, `/privacy`, `/terms`, `/reconnect` | yes | yes |
| `/dashboard`, `/briefs`, `/briefs/:id`, `/onboarding`, `/alerts`, `/actions`, `/chat`, `/settings`, `/tower`, `/admin/status`, `/plans` | yes | **no** (`/dashboard` redirects to `/collections` so the Shopify OAuth return still lands somewhere valid) |
| `/collections`, `/design`, `/preview`, `/publish`, `/performance`, `/plan` | **no** | yes (Sprint 0 placeholders) |

Because Vite inlines `import.meta.env.VITE_PRODUCT_MODE` at build time, a
`social_gallery` build does not ship the legacy page code at all.

## Environment variables

### Required in every mode

| Variable | Notes |
|---|---|
| `FRONTEND_URL` | URL, used for CORS and redirects |
| `SUPABASE_URL` | URL |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side only |
| `SHOPIFY_API_KEY` | |
| `SHOPIFY_API_SECRET` | also used for webhook HMAC verification |
| `SHOPIFY_APP_URL` | URL |

### Required in `legacy`, optional in `social_gallery`

| Variable | Why |
|---|---|
| `OPENAI_API_KEY` | brief generation and legacy agents |
| `RESEND_API_KEY` | all legacy email |

### Optional in every mode

`NODE_ENV`, `PORT`, `SHOPIFY_SCOPES`, `RESEND_FROM_EMAIL`,
`RESEND_WEBHOOK_SECRET`, `SUPABASE_WEBHOOK_SECRET`, `SHOPIFY_BETA_API_KEY`,
`SHOPIFY_BETA_API_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRICE_ID_STARTER`, `STRIPE_PRICE_ID_GROWTH`, `STRIPE_PRICE_ID_SCALE`,
`USE_DYNAMIC_BRIEF`, `USE_DYNAMIC_RECOVERY`, `USE_DYNAMIC_HEALTH`,
`USE_DYNAMIC_LEADS`, `USE_DYNAMIC_OUTREACH`, `USE_DYNAMIC_NURTURE`,
`USE_DYNAMIC_INBOX`, `USE_DYNAMIC_CONTENT`, `OUTREACH_DAILY_CAP`,
`POSTIZ_API_URL`, `POSTIZ_API_KEY`, `POSTIZ_INTEGRATION_ID`, `TAVILY_API_KEY`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`.

In `social_gallery` none of OpenAI, Resend, Postiz, Tavily, VAPID or Stripe is
needed to boot: the SDK clients fall back to inert placeholder keys and every
code path that would use them is unreachable.

### Frontend

`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` are required in
both modes. `VITE_PRODUCT_MODE` selects the mode.
`VITE_STRIPE_PUBLISHABLE_KEY` is declared but unused.

## Plans for the new product

`backend/src/config/socialGalleryPlans.ts` is the only source of truth for the
new product's commercial plans, served over `GET /api/plans` and rendered by the
frontend `/plan` screen.

| Plan | Price | Status |
|---|---|---|
| Basic | $29 / month | available |
| Growth | $79 / month | available |
| Pro | $149 / month | coming soon — shown, not subscribable |

Billing provider is `shopify_billing`. Stripe is not part of the
`social_gallery` flow. The legacy plan definitions (`lib/stripe.ts`,
`lib/shopify.ts`, `routes/billing.ts`, `lib/plans.ts`, `lib/plans_v2.ts` and the
`subscription_plans` migrations) are untouched so `legacy` stays reversible.

## Running locally

### Legacy (unchanged behaviour)

```bash
# backend/.env
PRODUCT_MODE=legacy            # or leave it unset

cd backend && npm run dev
```

```bash
# frontend/.env
VITE_PRODUCT_MODE=legacy       # or leave it unset

cd frontend && npm run dev
```

Boot log: `[server] Running on port 3001 in development mode (product=legacy)`.

### Social gallery

```bash
cd backend && PRODUCT_MODE=social_gallery npm run dev
cd frontend && VITE_PRODUCT_MODE=social_gallery npm run dev
```

Boot log:

```
[server] Running on port 3001 in development mode (product=social_gallery)
[server] Legacy background jobs disabled: scheduler and auditor not started
```

Quick checks:

```bash
curl -s localhost:3001/health            # {"status":"ok","productMode":"social_gallery",...}
curl -s localhost:3001/api/plans         # Basic $29, Growth $79, Pro coming soon
curl -s localhost:3001/api/tower         # {"error":"Not found","code":"FEATURE_NOT_AVAILABLE_IN_PRODUCT_MODE"}
curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/api/shopify/connection   # 401 — still mounted
```

### Tests

```bash
cd backend && npm run type-check && npm test
cd frontend && npm run type-check && npm run build
```

`backend/src/__tests__/product-mode.test.ts` boots the real Express app on an
ephemeral port in each mode and asserts the route surface, the plan
configuration, the environment requirements and that no cron job is registered
in `social_gallery`.
