import type { PublicPost } from '../gallery/galleryTypes.js';

/**
 * The price as it is printed on the shareable card.
 *
 * Plain digits with the shop's own currency code rather than a symbol: the
 * card is drawn on a server that does not know the shopper's locale, and
 * guessing one would print the wrong currency next to a real price.
 */
export function priceRange(post: PublicPost): string {
  if (!post.priceMin) return '';
  if (!post.priceMax || post.priceMin === post.priceMax) return post.priceMin;
  return `${post.priceMin} – ${post.priceMax}`;
}
