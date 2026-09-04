/**
 * Product mode — frontend mirror of the backend `PRODUCT_MODE`.
 *
 * - `legacy`         — the original Sillages product (Dashboard, Briefs,
 *                      Alerts, Actions, Chat, Tower…). Safe default.
 * - `social_gallery` — the new product shell (Collections, Design, Preview,
 *                      Publish, Performance, Plan).
 *
 * Set with `VITE_PRODUCT_MODE`. Anything other than `social_gallery` — including
 * an unset variable or a typo — falls back to `legacy`, so a misconfiguration
 * can never hide the existing product from merchants.
 *
 * Read the mode through this module; do not compare `import.meta.env` strings
 * anywhere else.
 */
export const PRODUCT_MODES = ['legacy', 'social_gallery'] as const;
export type ProductMode = (typeof PRODUCT_MODES)[number];

function readProductMode(): ProductMode {
  const raw = import.meta.env.VITE_PRODUCT_MODE as string | undefined;
  return raw === 'social_gallery' ? 'social_gallery' : 'legacy';
}

export const PRODUCT_MODE: ProductMode = readProductMode();

export function isLegacyMode(): boolean {
  return PRODUCT_MODE === 'legacy';
}

export function isSocialGalleryMode(): boolean {
  return PRODUCT_MODE === 'social_gallery';
}

/** Where an authenticated merchant lands after login or after Shopify OAuth. */
export const HOME_ROUTE = isSocialGalleryMode() ? '/collections' : '/dashboard';
