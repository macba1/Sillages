# Merchant admin (Sprint 3)

The self-service screens a merchant uses to get a gallery live. Shown only when
`VITE_PRODUCT_MODE=social_gallery`; the legacy screens are not in the bundle at
all.

## The journey is four steps

The onboarding strip is on every screen until the gallery is published, so a
merchant never has to guess what comes next.

| Step | Screen | What happens |
|---|---|---|
| 1 | Collections | The catalogue has synced. Choose every product, or one collection. |
| 2 | Design | Choose Original, Warm or Film. Optional heading, stories and quick buy toggles. |
| 3 | Preview | See the gallery on a phone and on a desktop, before anything is live. |
| 4 | Publish | One click. Turn it off, or restore an earlier version. |

`onboardingProgress()` derives the current step from real state — a synced
catalogue with products, a saved gallery, a preview that actually has posts, and
a published status — rather than from a checklist the merchant ticks.

## Screens

- **Collections** — product and collection counts, when the catalogue last
  synced, a manual "Sync now", and the radio group choosing the gallery source.
  A failed sync shows its error, not a silent zero.
- **Design** — the three looks, each rendered with the merchant's *own* first
  product photo so the choice is made on real content. Heading, stories and
  quick buy.
- **Preview** — the same renderer as Design, full size, with a mobile/desktop
  toggle. Style tokens are kept in sync with the theme extension's CSS, so what
  is approved here is what a shopper gets.
- **Publish** — status badge (Live / Off / Draft), publish, republish, turn off,
  and the list of previous versions with Restore. Publishing is disabled, with
  an explanation, when there is nothing to show. The one-time theme-editor step
  is spelled out here rather than left to support.
- **Performance** — the funnel from gallery views to purchases, saves, shares
  and the products most added to cart. It distinguishes what is genuinely
  measured from what is not: gallery activity is reported by the storefront,
  while checkout and revenue need the Web Pixel, which is not active on any
  store yet. The screen says so rather than showing a confident zero.
- **Plan** — Basic, Growth and Pro, read from `GET /api/plans`.

## Errors

`useGallery` turns every failure into a sentence a merchant can act on — a 409
becomes "a sync is already running", a 429 becomes "wait a minute", a 502
becomes "Shopify did not answer" — and renders it in one `role="alert"` banner
per screen. Nothing fails silently.

## Tests

`frontend/npm test` (vitest + jsdom + Testing Library, added in this sprint —
the admin had no automated verification at all before).

`src/test/adminFlow.test.tsx` covers the four steps of progress, choosing a
collection, choosing a style, saving a heading only when it changed, publishing
in one click, refusing to publish an empty gallery, turning off, restoring a
previous version but never the current one, and the three error paths.

## Mobile

Every control is at least 44px tall, the grids are `auto-fit` so they collapse
to one column, and the preview defaults to the phone frame.
