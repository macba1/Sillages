# Measurement and attribution (Sprint 4)

What the gallery reports, how an order gets credited to it, and — as importantly
— what is deliberately never collected.

## What is collected

| Event | Where from |
|---|---|
| `gallery_view` | the gallery renders |
| `post_view` | a product actually scrolls on screen (IntersectionObserver, once) |
| `post_open` | a shopper opens a product |
| `variant_select` | a shopper picks an option |
| `save` / `unsave` | the local favourite is toggled |
| `share` | link, WhatsApp or the device share sheet |
| `add_to_cart` | the gallery only. Shopify's pixel event carries no cart attributes, so the pixel cannot know the session and reporting it there would double-count |
| `checkout_started` | Web Pixel |
| `purchase` | written by the server after attribution, never by a browser |

> **Not measured today.** The Web Pixel does nothing until the app activates it
> with `webPixelCreate`, which needs the `write_pixels` scope the app does not
> yet request. Until that is granted and an install activates the pixel,
> `checkout_started` and `purchase` are never reported, attribution stays empty,
> and the Performance screen says so instead of showing a confident zero.
> `POST /api/public/purchase` is closed for the same reason: see
> `ENABLE_PIXEL_PURCHASE_REPORTING` below.

## What is never collected

No email, name, phone, address, customer id, IP or user agent. The event schema
is `.strict()`, so an unexpected field fails the whole batch, and a separate
check rejects anything person-shaped however it is nested or cased. Both are
tested.

The only identifier is `session_id`: 22 random characters the browser generates
for itself and stores locally. It is meaningless outside its own shop, is never
linked to a customer, and survives only in that browser.

## The signed ingest token

`GET /api/public/gallery/:shop` returns a 12-hour token, signed server-side, that
the storefront returns with every batch.

**This is not authentication and is not presented as such.** A storefront script
is public, so anyone who loads a shop's gallery can read its token. What it does
buy is real:

- events cannot be posted for a shop without first fetching *that* shop's
  gallery, so one scraped token does not open every store;
- tokens expire;
- the shop is carried by the signature, not by a client-supplied field, so a
  batch cannot claim to belong to a different shop.

Anything that must not be forgeable is derived server-side instead.

## How an order is credited

Two signals, in order of confidence, and the merchant is told which was used:

1. **`session`** — when the gallery adds to cart it also writes a
   `_sillages_sid` cart attribute. That attribute survives into the checkout,
   where the Web Pixel reads it. Exact.
2. **`variant`** — a purchased variant is one this shop's gallery was used to
   open, configure or add to cart within the attribution window (7 days).
   Inferred.

An order is credited at most once; the unique index on
`(connection_id, order_shopify_id)` enforces it, not application logic.

### The honest limit on revenue

The amount comes from the Web Pixel — that is, from the browser. Reading the
order server-side would need the `read_orders` scope, which the product
deliberately does not request. So attributed revenue is an indication, not
accounting, and the Performance screen says exactly that. Adding `read_orders`
later would upgrade it to verified.

## Consent

The Web Pixel runs in Shopify's strict sandbox with
`customer_privacy.analytics = true`. It sends nothing until Shopify reports that
analytics processing is allowed, and it re-checks on
`visitor_consent_collected`. Marketing, preferences and sale-of-data are all
declared off.

## Rate limits

Three independent budgets, so one cannot starve another:

| Surface | Limit |
|---|---|
| Admin API | 100 / 15 min per IP |
| Gallery reads | 120 / min per IP |
| Event and purchase ingestion | 60 / min per IP, max 50 events per batch |

## `ENABLE_PIXEL_PURCHASE_REPORTING`

`POST /api/public/purchase` writes merchant-facing revenue from a browser. Its
only legitimate caller is the Web Pixel, which is not active on any store, so
the endpoint is closed unless this is exactly `"true"`. Open it in the same
change that activates the pixel — and preferably only once orders can be read
server-side, since a browser-reported total is not accounting.

## In the browser

Events are queued and flushed in batches of 20, or on `pagehide` with
`keepalive`. A failed send is dropped rather than retried, because a lost
measurement is better than a stuck queue on someone's storefront. Saves are
local-first: no account, no sign-in, no request needed to favourite something.
