/**
 * Mirrors the backend payloads in `backend/src/services/gallery/galleryTypes.ts`
 * and `backend/src/routes/catalog.ts`. Kept narrow on purpose: the admin only
 * ever sees public storefront data plus its own settings.
 */

export const GALLERY_STYLES = ['original', 'warm', 'film'] as const;
export type GalleryStyle = (typeof GALLERY_STYLES)[number];

export type GalleryStatus = 'draft' | 'published' | 'disabled';

export interface GalleryConfig {
  id: string;
  collectionId: string | null;
  style: GalleryStyle;
  showStories: boolean;
  showQuickBuy: boolean;
  postsLimit: number;
  heading: string | null;
  status: GalleryStatus;
  version: number;
  publishedAt: string | null;
  disabledAt: string | null;
}

export interface GalleryVersion {
  version: number;
  publishedAt: string;
  snapshot: {
    style: GalleryStyle;
    heading: string | null;
    collectionId: string | null;
  };
}

export interface PublicVariant {
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

export interface GalleryPreview {
  shop: string;
  active: boolean;
  version: number;
  style: GalleryStyle;
  heading: string | null;
  showStories: boolean;
  showQuickBuy: boolean;
  stories: PublicStory[];
  posts: PublicPost[];
}

export interface Collection {
  id: string;
  shopifyId: string;
  title: string;
  handle: string;
  imageUrl: string | null;
  productsCount: number | null;
}

export interface SyncCounts {
  productsSeen: number;
  productsUpserted: number;
  productsDeleted: number;
  variantsUpserted: number;
  imagesUpserted: number;
  collectionsSeen: number;
  collectionsUpserted: number;
  collectionsDeleted: number;
  collectionLinksUpserted: number;
}

export interface CatalogStatus {
  connected: boolean;
  shopDomain?: string;
  productCount: number;
  collectionCount: number;
  lastSync: {
    trigger: string;
    status: 'running' | 'completed' | 'failed';
    /** True when the run claims to be running but stopped reporting. */
    stale?: boolean;
    startedAt: string;
    finishedAt: string | null;
    counts: SyncCounts;
    error: string | null;
  } | null;
}

export const STYLE_LABELS: Record<GalleryStyle, { name: string; description: string }> = {
  original: { name: 'Original', description: 'Your photos exactly as they are.' },
  warm: { name: 'Warm', description: 'A gently warmer, richer tone.' },
  film: { name: 'Film', description: 'Soft contrast on a printed white frame.' },
};

// ── Performance (Sprint 4) ──────────────────────────────────────────────────

export interface PerformanceTotals {
  galleryViews: number;
  postOpens: number;
  variantSelects: number;
  saves: number;
  shares: number;
  addToCarts: number;
  purchases: number;
  attributedOrders: number;
  attributedRevenue: number;
  currency: string | null;
  sessions: number;
}

export interface PerformanceResponse {
  connected: boolean;
  range: '7d' | '30d' | '90d';
  measuring: boolean;
  /** What is genuinely being measured, mechanism by mechanism. */
  measurement?: { gallery: boolean; checkout: boolean };
  /** True when the aggregates were unavailable and the counts are bounded. */
  approximate?: boolean;
  totals: PerformanceTotals;
  funnel: { step: string; count: number }[];
  topProducts: { productId: number; opens: number; addToCarts: number }[];
}

// ── Entitlements (what this shop's plan allows) ─────────────────────────────

export interface Entitlements {
  canPublish: boolean;
  canUseMultipleGalleries: boolean;
  canUseAttribution: boolean;
  planId: 'basic' | 'growth' | 'pro' | null;
  status: 'none' | 'pending' | 'active' | 'declined' | 'expired' | 'frozen' | 'cancelled';
  isTest: boolean;
  /** Why publishing is unavailable, in words a merchant can act on. */
  reason: string | null;
}
