/**
 * Shapes for the storefront gallery.
 *
 * The public payload is deliberately narrow: only data a shopper could already
 * see on the storefront. No account ids, no internal UUIDs, no tokens, no PII.
 */

/**
 * Photo treatments. `original`, `warm` and `film` shipped first and are kept
 * as-is so a published gallery keeps looking the way the merchant left it.
 *
 * These are presentation only: a CSS filter over the shopper's screen. The
 * files in Shopify are never touched, so turning a filter off restores the
 * photograph exactly.
 */
export const GALLERY_STYLES = ['original', 'warm', 'film', 'soft', 'vintage', 'flash'] as const;
export type GalleryStyle = (typeof GALLERY_STYLES)[number];

/** Filters available on Basic. The rest are a Growth difference. */
export const BASIC_STYLES: readonly GalleryStyle[] = ['original', 'warm', 'film'];

/** How the products are arranged. */
export const GALLERY_LAYOUTS = ['grid', 'polaroid', 'feed', 'stories'] as const;
export type GalleryLayout = (typeof GALLERY_LAYOUTS)[number];

/** Layouts available on Basic. */
export const BASIC_LAYOUTS: readonly GalleryLayout[] = ['grid', 'polaroid', 'feed', 'stories'];

/** The border drawn around each photograph. */
export const GALLERY_FRAMES = ['none', 'clean', 'polaroid', 'film', 'card'] as const;
export type GalleryFrame = (typeof GALLERY_FRAMES)[number];

/** Frames available on Basic. */
export const BASIC_FRAMES: readonly GalleryFrame[] = ['none', 'clean'];

export const GALLERY_STATUSES = ['draft', 'published', 'disabled'] as const;
export type GalleryStatus = (typeof GALLERY_STATUSES)[number];

/**
 * Who turned a gallery off.
 *
 * `merchant` is a deliberate decision and is never undone for them. `plan` is
 * our own doing — the subscription stopped, so the paid feature stopped — and
 * is put back when the subscription returns. Null on a disabled gallery means
 * it predates this distinction and is read as the merchant's decision.
 */
export type DisabledReason = 'merchant' | 'plan';

export function isGalleryStyle(value: unknown): value is GalleryStyle {
  return typeof value === 'string' && (GALLERY_STYLES as readonly string[]).includes(value);
}

export function isGalleryLayout(value: unknown): value is GalleryLayout {
  return typeof value === 'string' && (GALLERY_LAYOUTS as readonly string[]).includes(value);
}

export function isGalleryFrame(value: unknown): value is GalleryFrame {
  return typeof value === 'string' && (GALLERY_FRAMES as readonly string[]).includes(value);
}

/**
 * Filter strength, as a percentage.
 *
 * 100 is the filter exactly as designed — every filter is drawn conservatively
 * so that full strength still shows the product's real colour. 0 is the
 * untouched photograph. The default is 100 so that galleries published before
 * this setting existed keep looking the way their merchant left them.
 */
export const FILTER_INTENSITY_MIN = 0;
export const FILTER_INTENSITY_MAX = 100;
export const FILTER_INTENSITY_DEFAULT = 100;

export function clampIntensity(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return FILTER_INTENSITY_DEFAULT;
  return Math.min(FILTER_INTENSITY_MAX, Math.max(FILTER_INTENSITY_MIN, n));
}

/** Settings as the merchant edits them. */
export interface GallerySettings {
  collectionId: string | null;
  layout: GalleryLayout;
  style: GalleryStyle;
  /** 0–100. Applied to the filter only; 0 shows the original photograph. */
  filterIntensity: number;
  frame: GalleryFrame;
  showStories: boolean;
  showQuickBuy: boolean;
  postsLimit: number;
  heading: string | null;
  /** Words on the shareable card. Null uses the default. */
  shareTagline: string | null;
  /**
   * Growth removes the small Sillages mark from the shareable card. Stored as
   * the merchant's wish; what is actually rendered is decided server-side from
   * the subscription, never from this flag alone.
   */
  hideBranding: boolean;
}

/**
 * What a brand-new gallery looks like before the merchant touches anything.
 *
 * It used to be grid + original + no frame, which is a theme's own product grid
 * with extra steps: a merchant installed Sillages and the first thing they saw
 * was what they already had. The filters, the frames and the wall of prints
 * only appeared if they went looking. The default is the demo, and ours was
 * switched off.
 *
 * So it opens on the polaroid wall, warmed, with a thin print edge. Every one
 * of those three is in the Basic sets on purpose: an ambitious default that
 * gets coerced back to plain for anyone not on Growth would be a worse first
 * impression than a modest one that survives.
 */
export const DEFAULT_SETTINGS: GallerySettings = {
  collectionId: null,
  layout: 'polaroid',
  style: 'warm',
  filterIntensity: 70,
  frame: 'clean',
  showStories: true,
  showQuickBuy: true,
  postsLimit: 60,
  heading: null,
  shareTagline: null,
  hideBranding: false,
};

export interface GalleryConfig extends GallerySettings {
  id: string;
  accountId: string;
  connectionId: string;
  status: GalleryStatus;
  version: number;
  publishedAt: string | null;
  disabledAt: string | null;
  disabledReason: DisabledReason | null;
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
  /**
   * Shopify product ids in this collection, in the merchant's own order.
   *
   * Carried so the story viewer shows the collection a shopper tapped rather
   * than the whole catalogue. Bounded, and already public: the same ids are on
   * the collection page of the storefront.
   */
  productIds: number[];
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
  layout: GalleryLayout;
  style: GalleryStyle;
  filterIntensity: number;
  frame: GalleryFrame;
  heading: string | null;
  showStories: boolean;
  showQuickBuy: boolean;
  /** Words printed on the shareable card. */
  shareTagline: string;
  /** Whether the storefront draws the Sillages mark on the shareable card. */
  showBranding: boolean;
  /** Growth-only shopper features, decided by the subscription. */
  features: PublicFeatures;
  stories: PublicStory[];
  posts: PublicPost[];
}

/**
 * What the storefront is allowed to offer this shopper.
 *
 * Sent so the storefront can hide what it cannot do, never as the enforcement
 * itself: every endpoint behind these re-checks the shop's plan.
 */
export interface PublicFeatures {
  /** "Share my picks": turn saved products into a link. */
  sharedLists: boolean;
  /** "Ask your friends": let people vote between saved products. */
  friendVotes: boolean;
}

/** Default words on the shareable card. */
export const DEFAULT_SHARE_TAGLINE = 'Shop this look';

/** Answer for a shop with nothing published. The storefront renders nothing. */
export function inactiveGallery(shop: string): PublicGallery {
  return {
    shop,
    active: false,
    version: 0,
    ingestToken: null,
    layout: 'grid',
    style: 'original',
    filterIntensity: FILTER_INTENSITY_DEFAULT,
    frame: 'none',
    heading: null,
    showStories: false,
    showQuickBuy: false,
    shareTagline: DEFAULT_SHARE_TAGLINE,
    showBranding: true,
    features: { sharedLists: false, friendVotes: false },
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
