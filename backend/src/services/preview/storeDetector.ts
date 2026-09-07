import { safeFetch, UnsafeUrlError, type SafeFetchOptions } from './safeFetch.js';

const LOG = '[preview]';

/**
 * Reads a Shopify storefront's public catalogue.
 *
 * Uses only what the store already publishes to anyone: `/products.json`. No
 * credentials, no install, nothing private. If a store has that endpoint turned
 * off, we say so instead of guessing.
 */

export interface DetectedImage {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

export interface DetectedProduct {
  id: number;
  title: string;
  handle: string;
  productType: string | null;
  images: DetectedImage[];
  priceMin: string | null;
  priceMax: string | null;
  available: boolean;
}

export interface DetectedStore {
  /** The hostname the visitor pasted. Often a custom domain. */
  shopDomain: string;
  /**
   * The `*.myshopify.com` domain, which is the only thing Shopify's OAuth
   * accepts. Null when the storefront did not disclose it — most do, via
   * `/products.json`'s sibling endpoints or a meta tag, but not all.
   */
  myshopifyDomain: string | null;
  sourceUrl: string;
  shopName: string | null;
  products: DetectedProduct[];
}

export class StoreDetectionError extends Error {
  constructor(message: string, public readonly code: 'not_shopify' | 'no_products' | 'unreachable' | 'invalid_url') {
    super(message);
    this.name = 'StoreDetectionError';
  }
}

const PRODUCTS_PER_PAGE = 250;
const MAX_PRODUCTS = 60;

/** Normalises whatever a person pastes into an origin we can fetch. */
export function normaliseStoreUrl(input: string): URL {
  const trimmed = String(input ?? '').trim();
  if (!trimmed || trimmed.length > 300) throw new StoreDetectionError('That does not look like a store address.', 'invalid_url');

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new StoreDetectionError('That does not look like a store address.', 'invalid_url');
  }

  if (!url.hostname.includes('.')) throw new StoreDetectionError('That does not look like a store address.', 'invalid_url');

  // Only the origin matters; a pasted deep link should still work.
  return new URL(url.origin);
}

export async function detectStore(input: string, options: SafeFetchOptions = {}): Promise<DetectedStore> {
  const origin = normaliseStoreUrl(input);

  let response;
  try {
    response = await safeFetch(`${origin.origin}/products.json?limit=${PRODUCTS_PER_PAGE}`, options);
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new StoreDetectionError(err.message, 'unreachable');
    throw new StoreDetectionError('We could not reach that store.', 'unreachable');
  }

  if (response.status !== 200) {
    throw new StoreDetectionError(
      "We could not read that store's products. It may not be a Shopify store, or its catalogue may be private.",
      'not_shopify',
    );
  }

  let payload: { products?: unknown };
  try {
    payload = JSON.parse(response.body) as { products?: unknown };
  } catch {
    throw new StoreDetectionError("That address did not return a Shopify catalogue.", 'not_shopify');
  }

  if (!Array.isArray(payload.products)) {
    throw new StoreDetectionError("That address did not return a Shopify catalogue.", 'not_shopify');
  }

  const products = (payload.products as RawProduct[])
    .map(toProduct)
    .filter((product): product is DetectedProduct => product !== null)
    .slice(0, MAX_PRODUCTS);

  if (products.length === 0) {
    throw new StoreDetectionError('We could not find any products with photos in that store.', 'no_products');
  }

  const hostname = origin.hostname.toLowerCase();
  const myshopifyDomain = hostname.endsWith('.myshopify.com')
    ? hostname
    : await detectMyshopifyDomain(origin.origin, options);

  console.log(
    `${LOG} detected ${products.length} product(s) at ${hostname}` +
      (myshopifyDomain && myshopifyDomain !== hostname ? ` (${myshopifyDomain})` : ''),
  );

  return {
    shopDomain: hostname,
    myshopifyDomain,
    sourceUrl: origin.origin,
    shopName: null,
    products,
  };
}

/**
 * Finds the `*.myshopify.com` name behind a custom domain.
 *
 * Shopify storefronts expose it in `Shopify.shop` inside the inline script the
 * platform injects on every page. Without it the install link cannot be built,
 * because Shopify's OAuth rejects anything that is not a myshopify domain — and
 * nearly every real store uses a custom domain.
 */
async function detectMyshopifyDomain(origin: string, options: SafeFetchOptions): Promise<string | null> {
  try {
    const response = await safeFetch(origin, options);
    const match = /Shopify\.shop\s*=\s*["']([a-z0-9][a-z0-9-]*\.myshopify\.com)["']/i.exec(response.body);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

// ── Mapping ─────────────────────────────────────────────────────────────────

interface RawImage { src?: string; alt?: string | null; width?: number; height?: number }
interface RawVariant { price?: string; available?: boolean }
interface RawProduct {
  id?: number;
  title?: string;
  handle?: string;
  product_type?: string;
  images?: RawImage[];
  variants?: RawVariant[];
}

function toProduct(raw: RawProduct): DetectedProduct | null {
  if (!raw || typeof raw.handle !== 'string' || typeof raw.title !== 'string') return null;

  const images = (raw.images ?? [])
    .map((image) => (typeof image?.src === 'string' && /^https:\/\//.test(image.src)
      ? { url: image.src, alt: image.alt ?? null, width: image.width ?? null, height: image.height ?? null }
      : null))
    .filter((image): image is DetectedImage => image !== null)
    .slice(0, 6);

  // A gallery is made of photographs; a product without one is not useful here.
  if (images.length === 0) return null;

  const prices = (raw.variants ?? [])
    .map((variant) => Number(variant?.price))
    .filter((price) => Number.isFinite(price));

  return {
    id: typeof raw.id === 'number' ? raw.id : 0,
    title: raw.title.slice(0, 200),
    handle: raw.handle,
    productType: typeof raw.product_type === 'string' && raw.product_type ? raw.product_type : null,
    images,
    priceMin: prices.length ? Math.min(...prices).toFixed(2) : null,
    priceMax: prices.length ? Math.max(...prices).toFixed(2) : null,
    available: (raw.variants ?? []).some((variant) => variant?.available === true),
  };
}
