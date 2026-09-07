import { register } from '@shopify/web-pixels-extension';

/**
 * Sillages measurement pixel.
 *
 * Runs in Shopify's strict sandbox, so it cannot read the storefront's DOM or
 * its localStorage. The link back to a gallery session is carried deliberately:
 * the gallery writes a `_sillages_sid` cart attribute when a shopper adds to
 * cart, and that attribute survives into the checkout the pixel can read.
 *
 * What is reported: which variant was added, that checkout started, and that an
 * order completed with its id, total and purchased variants.
 *
 * What is never reported: email, name, phone, address, customer id, or anything
 * else that identifies the shopper. If any of that were sent, the ingestion
 * endpoint would reject the whole batch.
 */

const SESSION_ATTRIBUTE = '_sillages_sid';

register(({ analytics, browser, init, settings }) => {
  const apiBase = String(settings?.apiBase || '').replace(/\/+$/, '');
  const shopDomain =
    init?.data?.shop?.myshopifyDomain || init?.context?.document?.location?.hostname || '';

  if (!apiBase || !shopDomain) return;

  /**
   * Consent gate. Nothing is sent until Shopify says analytics processing is
   * allowed, and consent is re-checked when the shopper changes it.
   */
  let allowed = Boolean(init?.customerPrivacy?.analyticsProcessingAllowed);

  analytics.subscribe('visitor_consent_collected', (event) => {
    allowed = Boolean(event?.customerPrivacy?.analyticsProcessingAllowed);
  });

  /** The gallery token, fetched once and cached in the sandbox's own storage. */
  let tokenPromise = null;

  async function ingestToken() {
    if (!tokenPromise) {
      tokenPromise = (async () => {
        try {
          const cached = await browser.localStorage.getItem('sillages_token');
          const parsed = cached ? JSON.parse(cached) : null;
          if (parsed && parsed.expires > Date.now() && parsed.token) return parsed.token;
        } catch {
          // Cache miss or unreadable cache: fall through and fetch a fresh one.
        }

        const response = await fetch(`${apiBase}/api/public/gallery/${encodeURIComponent(shopDomain)}`, {
          credentials: 'omit',
        });
        if (!response.ok) return null;
        const gallery = await response.json();
        if (!gallery || !gallery.ingestToken) return null;

        try {
          await browser.localStorage.setItem(
            'sillages_token',
            // Refresh well before the server-side expiry.
            JSON.stringify({ token: gallery.ingestToken, expires: Date.now() + 6 * 60 * 60 * 1000 }),
          );
        } catch {
          // Storage is optional; the token still works for this page view.
        }
        return gallery.ingestToken;
      })();
    }
    return tokenPromise;
  }

  function send(path, body) {
    if (!allowed) return Promise.resolve();
    return ingestToken()
      .then((token) => {
        if (!token) return;
        return fetch(`${apiBase}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'omit',
          keepalive: true,
          body: JSON.stringify({ ...body, token }),
        });
      })
      .catch(() => {
        // Measurement must never interfere with a purchase.
      });
  }

  /** Reads the session the gallery attached to the cart, when there is one. */
  function sessionFrom(container) {
    const attributes = container?.attributes || [];
    const found = attributes.find((attribute) => attribute?.key === SESSION_ATTRIBUTE);
    const value = found?.value;
    return typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : undefined;
  }

  function eventId(prefix, suffix) {
    return `${prefix}-${suffix}`.slice(0, 64);
  }

  // Deliberately NOT subscribing to `product_added_to_cart`.
  //
  // Shopify's add-to-cart event does not expose cart attributes, so the pixel
  // cannot know which gallery session an add belongs to. Reporting it anyway
  // would mean inventing a session id per pixel event, which would double-count
  // every add the gallery already reports with the real session and inflate the
  // shopper count with sessions that are not shoppers.
  //
  // The gallery reports its own adds, with the correct session. The pixel's job
  // is the two things the gallery cannot see: checkout and the completed order.

  analytics.subscribe('checkout_started', (event) => {
    const checkout = event?.data?.checkout;
    const sessionId = sessionFrom(checkout);
    if (!sessionId) return;

    void send('/api/public/events', {
      sessionId,
      events: [
        {
          type: 'checkout_started',
          id: eventId('cs', event.id),
          occurredAt: new Date(event.timestamp || Date.now()).toISOString(),
        },
      ],
    });
  });

  analytics.subscribe('checkout_completed', (event) => {
    const checkout = event?.data?.checkout;
    if (!checkout) return;

    const orderId = Number(String(checkout.order?.id ?? '').replace(/\D/g, ''));
    if (!Number.isSafeInteger(orderId) || !orderId) return;

    const variantIds = (checkout.lineItems || [])
      .map((line) => Number(String(line?.variant?.id ?? '').replace(/\D/g, '')))
      .filter((id) => Number.isSafeInteger(id) && id > 0);

    void send('/api/public/purchase', {
      sessionId: sessionFrom(checkout),
      orderId,
      amount: Number(checkout.totalPrice?.amount) || undefined,
      currency: checkout.currencyCode || undefined,
      variantIds,
      occurredAt: new Date(event.timestamp || Date.now()).toISOString(),
    });
  });
});
