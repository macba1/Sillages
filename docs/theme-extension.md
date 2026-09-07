# Social gallery on the storefront (Sprint 2)

The shoppable gallery a merchant publishes to their store, delivered as a
Shopify **Theme App Extension**. Everything here runs only when
`PRODUCT_MODE=social_gallery`.

## Why an app block

The merchant adds the block from the theme editor. No theme file is ever
edited, and removing the block removes every trace of the gallery — no leftover
markup, no orphan styles, no requests. That is what "disable restores the store"
means in practice.

```
extensions/social-gallery/
  shopify.extension.toml
  blocks/social-gallery.liquid      app block (target: section)
  assets/gallery-core.js            pure logic — variant matching, cart payload
  assets/social-gallery.js          DOM renderer, loaded as a deferred module
  assets/social-gallery.css         mobile-first styles, all scoped under .sg-
  locales/en.default.json, es.json
```

## How a page renders

1. The Liquid block emits an empty container carrying the shop domain and the
   API base. Nothing else. It cannot block rendering because it has no content.
2. `social-gallery.js` is a deferred ES module. It paints a skeleton with a
   fixed aspect ratio, so there is no layout shift when the real cards arrive.
3. It fetches `GET /api/public/gallery/:shopDomain`, which is cached for 60s
   with a 300s stale-while-revalidate window.
4. If nothing is published, the request fails, or there is nothing to show, the
   script **removes its own container**. A shopper never sees an error.
5. Images use `loading="lazy"`, `decoding="async"` and explicit dimensions.

## Buying the right variant

`gallery-core.js` holds the logic that decides what goes in the cart, and it is
unit-tested from the backend suite (`src/__tests__/gallery.test.ts`) so the code
that runs in a shopper's browser is the code under test.

- One selector per option, in the order Shopify presents them.
- `selectVariant` returns `null` when the chosen combination does not exist, so
  the button is disabled rather than adding something the shopper did not pick.
- The default selection is the first variant actually **in stock**.
- The cart payload carries the numeric Shopify variant id — `cartPayload`
  refuses a GID, so a malformed id can never reach the cart.
- Adding posts to the shop's own `/cart/add.js` (respecting
  `Shopify.routes.root` for localised stores) and dispatches
  `sillages:cart:added` so a theme can refresh its cart drawer.

## The three styles

`original`, `warm` and `film`. Each is a CSS custom-property set on the root
container — image filter, card background, corner radius — so switching style
never re-fetches or re-renders anything server-side.

## Mobile first

The base stylesheet is the phone layout: a two-column grid, a horizontally
scrolling story rail, and a bottom sheet for the product. One media query at
750px widens the grid to four columns and turns the sheet into a centred modal.
Touch targets are at least 40px, the buy button 48px, and
`prefers-reduced-motion` disables every animation.

## Publish, disable, revert

State lives in `gallery_configs`, with a snapshot of every published version in
`gallery_config_versions`.

| Action | Endpoint | Effect |
|---|---|---|
| Save | `PUT /api/gallery` | Changes the draft. The storefront is untouched. |
| Publish | `POST /api/gallery/publish` | Bumps the version, snapshots it, goes live. |
| Disable | `POST /api/gallery/disable` | The public API reports inactive; the storefront renders nothing. |
| Revert | `POST /api/gallery/revert` | Restores an earlier snapshot and publishes it **forward** as a new version, so history is never rewritten. |

A partial unique index guarantees at most one published gallery per shop.

## The public API

`GET /api/public/gallery/:shopDomain` is the only unauthenticated, cross-origin
surface of the product.

- Returns strictly public storefront data: products, variants, prices, images,
  collection names. No account ids, no internal UUIDs, no tokens, no shopper
  data. A test asserts this.
- `Access-Control-Allow-Origin: *`, GET and OPTIONS only. It is excluded from
  the admin CORS policy and from the admin rate limiter, and carries its own
  storefront limiter — otherwise ordinary shoppers behind a shared IP would be
  throttled.
- An unknown or malformed shop gets exactly the same inactive answer as a shop
  with nothing published, so the endpoint cannot be used to enumerate which
  stores have Sillages installed.

## Still to do before a real storefront

The extension has never been deployed. `shopify app deploy` against a
development app is required to get its UUID, which is what the theme-editor deep
link ("Add the gallery to my theme") needs. Until then the merchant adds the
block manually from the theme editor.
