# Development environment — verified progress, 2026-09-08

## Created in Shopify

- Separate app: **Sillages (development)**, app ID `420760748033`, organization `208487189`.
- App client ID (public identifier, not a secret): `22dc365ecf72d104affe4e78da39fea3`.
- App settings: https://dev.shopify.com/dashboard/208487189/apps/420760748033/settings
- Separate free development store: **Sillages Gallery Dev**, Basic simulation, generated test data enabled.
- Store admin: https://admin.shopify.com/store/sillages-gallery-dev
- Verified in Products UI: **12 products**, including draft, archived, out-of-stock, and stocked examples.
- Verified in Collections UI: **3 collections**: Automated Collection (8 products), Hydrogen (3), Home page (1).
- Existing `sillagesdev` store was not modified.

## Local correction

The original three-scope specification was insufficient. Shopify's 2026-01 `webPixelCreate` documentation also requires `read_customer_events`:
https://shopify.dev/docs/api/admin-graphql/2026-01/mutations/webPixelCreate

Added it to development TOML and documented it; updated development config test. All six tests in `shopify-config.test.ts` pass. Public TOML unchanged.

## Not completed / must not claim verified

- Development app still has its initial placeholder version. Real tunnel URLs, scopes and extensions have NOT been released.
- CLI account authentication stopped at Shopify's login page: authenticated dashboard session did not authenticate CLI automatically.
- No secret retrieved, copied to chat, or committed.
- Dev config client_id remains empty; no config link/deploy performed.
- More than 50 products still required; current count is only 12. Multiple photos/variants need a complete audit or deliberate seed.
- Dev Supabase, installation, billing, webhooks, consent/pixel, theme compatibility and attribution not tested by this setup run.
- No production changes, push, merge, or deployment.

## Tooling notes

System Node is v18 and cannot run current Shopify CLI (4.7.1 requires >=22.12). Bundled Codex Node runs it successfully. CLI installed in an isolated temporary npm cache because normal npm cache was not writable. Do not repair global cache permissions or change unrelated projects.

Next: finish CLI login, link ONLY development config while preserving local settings, establish dev-only URLs and credentials, release development extensions, complete test catalog, then run staging checks. Never use default production config for deploy.
