import type { GalleryFrame, GalleryLayout, GalleryStyle } from '../../types/gallery';

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
 * The same looks the storefront renders, expressed for the admin preview.
 *
 * Kept in sync with `extensions/social-gallery/assets/social-gallery.css` on
 * purpose, and written the same way: every value scales with `k`, the
 * merchant's intensity as a 0–1 multiplier, so what the Design screen shows at
 * 40% is what a shopper sees at 40%.
 */
export function filterFor(style: GalleryStyle, intensity: number): string {
  const k = Math.min(1, Math.max(0, Number(intensity) / 100));
  if (!Number.isFinite(k) || k === 0) return 'none';

  switch (style) {
    case 'warm':
      return `saturate(${1 + 0.1 * k}) contrast(${1 + 0.03 * k}) sepia(${0.14 * k})`;
    case 'film':
      return `saturate(${1 - 0.1 * k}) contrast(${1 + 0.08 * k}) brightness(${1 + 0.02 * k})`;
    case 'soft':
      return `brightness(${1 + 0.05 * k}) contrast(${1 - 0.07 * k}) saturate(${1 - 0.04 * k})`;
    case 'vintage':
      return `sepia(${0.26 * k}) saturate(${1 - 0.14 * k}) contrast(${1 + 0.05 * k}) brightness(${1 + 0.03 * k})`;
    case 'flash':
      return `brightness(${1 + 0.07 * k}) contrast(${1 + 0.12 * k}) saturate(${1 + 0.06 * k})`;
    default:
      return 'none';
  }
}

export const STYLE_COPY: Record<GalleryStyle, { name: string; blurb: string }> = {
  original: { name: 'Original', blurb: 'Your photos exactly as they are.' },
  warm: { name: 'Warm', blurb: 'A gently warmer, richer tone.' },
  film: { name: 'Film', blurb: 'Soft contrast, like a printed photograph.' },
  soft: { name: 'Soft', blurb: 'Light lifted into the shadows. Airy.' },
  vintage: { name: 'Vintage', blurb: 'Faded warmth, kept in a drawer.' },
  flash: { name: 'Flash', blurb: 'Brighter and crisper, like direct light.' },
};

export const LAYOUT_COPY: Record<GalleryLayout, { name: string; blurb: string }> = {
  grid: { name: 'Social Grid', blurb: 'Clean columns. The arrangement everyone already reads.' },
  polaroid: { name: 'Polaroid Wall', blurb: 'Paper borders at slightly different sizes, like a wall of prints.' },
  feed: { name: 'Social Feed', blurb: 'One product at a time, large, with the actions underneath.' },
  stories: { name: 'Story Gallery', blurb: 'Collections as circles up top, opening full screen.' },
};

export const FRAME_COPY: Record<GalleryFrame, { name: string; blurb: string }> = {
  none: { name: 'None', blurb: 'Just the photograph.' },
  clean: { name: 'Clean', blurb: 'A thin white edge.' },
  polaroid: { name: 'Polaroid', blurb: 'Wide paper border with the name printed underneath.' },
  film: { name: 'Film print', blurb: 'Dark border with sprocket marks.' },
  card: { name: 'Social card', blurb: 'Rounded card with a soft shadow.' },
};

/** The border, as inline style, matching `.sg-frame--*` on the storefront. */
export function frameStyle(frame: GalleryFrame): {
  padding: string;
  background: string;
  boxShadow: string;
  borderRadius: number;
} {
  switch (frame) {
    case 'clean':
      return { padding: '6px', background: '#FFFEFB', boxShadow: '0 1px 2px rgba(0,0,0,0.07)', borderRadius: 8 };
    case 'polaroid':
      return { padding: '10px 10px 30px', background: '#FFFEFB', boxShadow: '0 1px 2px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.07)', borderRadius: 3 };
    case 'film':
      return { padding: '8px', background: '#17161A', boxShadow: '0 2px 10px rgba(0,0,0,0.22)', borderRadius: 2 };
    case 'card':
      return { padding: '0', background: '#FFFEFB', boxShadow: '0 1px 2px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.07)', borderRadius: 18 };
    default:
      return { padding: '0', background: 'transparent', boxShadow: 'none', borderRadius: 12 };
  }
}
