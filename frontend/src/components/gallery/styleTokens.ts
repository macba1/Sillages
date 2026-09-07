import type { GalleryStyle } from '../../types/gallery';

/** Brand palette shared by every admin screen of the new product. */
export const T = {
  ink: '#2A1F14',
  body: '#5C4B38',
  muted: '#8A7A66',
  gold: '#C9964A',
  line: 'rgba(42,31,20,0.12)',
  surface: '#FFFDFA',
  danger: '#8A2E2E',
  font: "'DM Sans', sans-serif",
} as const;

/**
 * The same three looks the storefront renders, expressed for the admin preview.
 * Kept in sync with `extensions/social-gallery/assets/social-gallery.css`.
 */
export const STYLE_TOKENS: Record<GalleryStyle, { filter: string; cardBg: string; radius: number; pad: number }> = {
  original: { filter: 'none', cardBg: 'transparent', radius: 12, pad: 0 },
  warm: { filter: 'saturate(1.08) contrast(1.02) sepia(0.12)', cardBg: 'transparent', radius: 12, pad: 0 },
  film: { filter: 'saturate(0.92) contrast(1.06) brightness(1.02)', cardBg: '#FBFAF7', radius: 4, pad: 8 },
};
