/**
 * Shapes for the storefront gallery.
 *
 * The public payload is deliberately narrow: only data a shopper could already
 * see on the storefront. No account ids, no internal UUIDs, no tokens, no PII.
 */

export const GALLERY_STYLES = ['original', 'warm', 'film'] as const;
export type GalleryStyle = (typeof GALLERY_STYLES)[number];

export const GALLERY_STATUSES = ['draft', 'published', 'disabled'] as const;
export type GalleryStatus = (typeof GALLERY_STATUSES)[number];

export function isGalleryStyle(value: unknown): value is GalleryStyle {
  return typeof value === 'string' && (GALLERY_STYLES as readonly string[]).includes(value);
}

/** Settings as the merchant edits them. */
export interface GallerySettings {
  collectionId: string | null;
  style: GalleryStyle;
  showStories: boolean;
  showQuickBuy: boolean;
  postsLimit: number;
  heading: string | null;
}

export interface GalleryConfig extends GallerySettings {
  id: string;
  accountId: string;
  connectionId: string;
  status: GalleryStatus;
  version: number;
  publishedAt: string | null;
  disabledAt: string | null;
}

// ── Public storefront payload ───────────────────────────────────────────────

export interface PublicVariant {
  /** Numeric Shopify variant id — what /cart/add.js expects. */
  id: number;
  title: string;
  price: string;
  compareAtPrice: string | null;
  available: boolean;
  options: { name: string; value: string }[];
}

export interface PublicImage {
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
}

export interface PublicPost {
  id: number;
  handle: string;
  title: string;
  url: string;
  image: PublicImage | null;
  images: PublicImage[];
  priceMin: string | null;
  priceMax: string | null;
  available: boolean;
  variants: PublicVariant[];
}

export interface PublicStory {
  id: number;
  title: string;
  handle: string;
  url: string;
  imageUrl: string | null;
}

export interface PublicGallery {
  shop: string;
  active: boolean;
  version: number;
  /**
   * Short-lived token the storefront returns with its event batches. Null when
   * there is nothing published, so an inactive shop hands out nothing.
   */
  ingestToken: string | null;
  style: GalleryStyle;
  heading: string | null;
  showStories: boolean;
  showQuickBuy: boolean;
  stories: PublicStory[];
  posts: PublicPost[];
}

/** Answer for a shop with nothing published. The storefront renders nothing. */
export function inactiveGallery(shop: string): PublicGallery {
  return {
    shop,
    active: false,
    version: 0,
    ingestToken: null,
    style: 'original',
    heading: null,
    showStories: false,
    showQuickBuy: false,
    stories: [],
    posts: [],
  };
}

/** `gid://shopify/ProductVariant/123` -> 123. Returns null when unparseable. */
export function numericShopifyId(gid: string | null | undefined): number | null {
  if (!gid) return null;
  const match = /(\d+)\s*$/.exec(gid);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}
