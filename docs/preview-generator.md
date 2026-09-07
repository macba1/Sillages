# Before/after generator (Sprint 5)

A shop owner can be shown their own store as a shoppable gallery before
installing anything, and then install and get exactly that design.

## What it does

1. Someone pastes a Shopify store address at `/demo`.
2. The backend reads that store's **public** catalogue — `/products.json`, the
   same thing any visitor can fetch. No install, no credentials, nothing
   private, and nothing about the store is modified.
3. Three proposals are built from the merchant's own products and their own
   photographs: Original, Warm and Film. The ordering rule is identical in all
   three, so they differ only in look.
4. The demo lives at `/demo/:token` behind a 24-byte random token, expires in 14
   days, and is marked `noindex, nofollow, noarchive` both by the API header and
   by a meta tag on the page.
5. "Publish this design in my store" mints a single-use claim token and sends
   the owner to Shopify's install flow.
6. After installing, the chosen proposal is recovered and the gallery is seeded
   with it — as a draft, so the merchant still previews and publishes. Recovering
   the demo removes the setup, not the decision.

## The security boundary

This is the one place where the product fetches a URL a stranger supplies, which
makes it the SSRF boundary. `services/preview/safeFetch.ts` enforces, on **every
hop of a redirect chain**:

- https only;
- the hostname must resolve to a publicly routable address — every answer, not
  just the first, so a split-horizon record cannot slip through;
- literal private addresses refused directly, including `169.254.169.254`
  (cloud metadata), loopback, RFC1918, carrier NAT, multicast, IPv6 unique-local
  and IPv4-mapped IPv6;
- no credentials embedded in the URL;
- at most 3 redirects, each re-checked rather than followed;
- an 8-second timeout and a 3 MB response cap, both covering the **body** and
  not only the headers;
- **the connection is pinned to the address that was validated.** Resolving a
  hostname, approving it, and then letting the OS resolve again at connect time
  is the DNS-rebinding hole: a record can answer publicly for the check and
  privately microseconds later for the connection. A custom agent hands the
  socket the checked address whatever DNS says by then, and refuses outright if
  that address is not public. TLS still verifies the certificate against the
  original hostname, so pinning the address does not weaken it.

`preview.test.ts` pins all of it, including a redirect from a public host to a
private one.

## Rate limits

Building a preview fetches a third-party site, so it is the tightest budget in
the product: 5 per 10 minutes per IP. Reading one is 60 per minute.

## Claiming

The chosen proposal is stored server-side against a single-use token; the
browser only ever carries the token. A replay finds nothing.

There is also a fallback: if the owner sees the demo and then installs from the
App Store instead of the button, the preview is matched by shop domain. That
matters because the Shopify-initiated install flow does not carry our state
through OAuth, so without the fallback those merchants would land in a blank
setup having just been shown a design.

## Expiry

Unclaimed demos are deleted nightly at 03:50 by
`removeExpiredPreviews()`. A **claimed** preview is kept: it is the record of
what a merchant chose.

## What is stored

The shop domain, the source URL, the proposals, and the public product data they
were built from — titles, handles, prices and image URLs. No contact details, no
personal data, nothing scraped beyond the catalogue the store already publishes.

## Outreach

The plan is explicit that outreach is personalised and never mass-sent. This
sprint builds the generator; it does not build a sending pipeline, and none of
the retired outreach machinery is reachable in `social_gallery`.
