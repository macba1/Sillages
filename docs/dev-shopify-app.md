# Development Shopify app

`shopify.app.dev.toml` is a **separate** Shopify app, used only against a
development store. It exists so the social-gallery product can be exercised end
to end without touching the public listing.

`shopify.app.toml` is the public, production app. **Do not edit it, and never run
`shopify app deploy` without `--config dev`.** A test pins both files apart.

## Scopes

| Scope | Why |
|---|---|
| `read_products` | products, variants, images, collections |
| `read_inventory` | stock, so a sold-out variant shows as sold out |
| `write_pixels` | activating the Web Pixel with `webPixelCreate` — **without it checkout and purchases are never measured**, because the extension does nothing until the app creates it |

Deliberately dropped, unlike production: `read_all_orders`, `read_customers`,
`write_customers`, `read_analytics`, `read_reports`, `read_pixels`,
`write_products`, `write_discounts`, `read_checkouts`, `write_marketing_events`.
The new product reads none of them.

## Setting it up

`client_id` is committed empty on purpose — filling it in would tie this file to
one person's Partners account.

```bash
# 1. Create the app in the Partners dashboard (a NEW app, not the Sillages one)
# 2. Link this config to it. This writes client_id into shopify.app.dev.toml.
shopify app config link --config dev

# 3. Point the URLs at your tunnel
cloudflared tunnel --url http://localhost:3001
#    then replace REPLACE-WITH-TUNNEL in shopify.app.dev.toml

# 4. Deploy the extensions to the DEVELOPMENT app only
shopify app deploy --config dev
```

Step 4 is what produces the theme app extension's UUID, which the "add the
gallery to my theme" deep link needs.

## After linking

`client_id` will be present in your working copy. It identifies a development
app and is not a secret, but keep it out of commits that touch the production
config, and never copy it into `shopify.app.toml`.
