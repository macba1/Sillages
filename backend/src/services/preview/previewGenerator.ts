import crypto from 'node:crypto';
import { GALLERY_STYLES, type GalleryStyle } from '../gallery/galleryTypes.js';
import type { DetectedProduct, DetectedStore } from './storeDetector.js';

/**
 * Turns a detected storefront into three private proposals.
 *
 * Nothing is generated or invented: each proposal is the merchant's own
 * products and their own photographs, arranged as a gallery in one of the three
 * looks. The "before" is the store as it is; the "after" is the same catalogue
 * in a gallery.
 */

export interface ProposalPost {
  id: number;
  title: string;
  handle: string;
  url: string;
  imageUrl: string;
  alt: string | null;
  priceMin: string | null;
  priceMax: string | null;
}

export interface Proposal {
  style: GalleryStyle;
  name: string;
  description: string;
  posts: ProposalPost[];
}

const STYLE_COPY: Record<GalleryStyle, { name: string; description: string }> = {
  original: { name: 'Original', description: 'Your photographs exactly as they are, arranged as a shoppable feed.' },
  warm: { name: 'Warm', description: 'A gently warmer tone that makes product photography feel less like a catalogue.' },
  film: { name: 'Film', description: 'Soft contrast on a printed white frame, like a set of prints.' },
};

const POSTS_PER_PROPOSAL = 24;

/**
 * Ordering rule, applied identically to every proposal so the three differ only
 * in look: products with more photographs first, then those in stock. It is
 * deterministic, so reopening a preview shows the same thing.
 */
function rank(products: DetectedProduct[]): DetectedProduct[] {
  return [...products].sort((a, b) => {
    if (b.images.length !== a.images.length) return b.images.length - a.images.length;
    if (a.available !== b.available) return a.available ? -1 : 1;
    return a.handle.localeCompare(b.handle, 'en');
  });
}

export function buildProposals(store: DetectedStore): Proposal[] {
  const ordered = rank(store.products).slice(0, POSTS_PER_PROPOSAL);

  const posts: ProposalPost[] = ordered.map((product) => ({
    id: product.id,
    title: product.title,
    handle: product.handle,
    url: `${store.sourceUrl}/products/${product.handle}`,
    imageUrl: product.images[0].url,
    alt: product.images[0].alt,
    priceMin: product.priceMin,
    priceMax: product.priceMax,
  }));

  return GALLERY_STYLES.map((style) => ({
    style,
    name: STYLE_COPY[style].name,
    description: STYLE_COPY[style].description,
    posts,
  }));
}

/** Unguessable, URL-safe, and the only way to open a preview. */
export function newPublicToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}
