import type { PublicPost } from '../gallery/galleryTypes.js';

/**
 * The price as it is printed on the shareable card.
 *
 * Plain digits with the shop's own currency code rather than a symbol: the
 * card is drawn on a server that does not know the shopper's locale, and
 * guessing one would print the wrong currency next to a real price. The code
 * was promised here from the start and never actually added, so the card went
 * out reading `1025.00` — a number a friend cannot act on.
 *
 * With no currency recorded the digits go out alone, which is what happened
 * before and is better than inventing one.
 */
export function priceRange(post: PublicPost, currency: string | null = null): string {
  if (!post.priceMin) return '';
  const range =
    !post.priceMax || post.priceMin === post.priceMax
      ? post.priceMin
      : `${post.priceMin} – ${post.priceMax}`;
  return currency ? `${range} ${currency}` : range;
}
