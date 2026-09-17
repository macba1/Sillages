import { storeHandle } from '../billing/shopifyBilling.js';

/**
 * One click instead of five.
 *
 * Placing the gallery used to be a five-step instruction: open the theme
 * editor, change the template selector, Add block, find Sillages, save. Every
 * merchant, by hand, and the step that matters most — the collection template —
 * was the one they were least likely to find. For a shop paying $9.99 that is
 * the difference between a catalogue that changed and an app they uninstall.
 *
 * Shopify's theme editor accepts a deep link that arrives with the app block
 * already inserted into a named template. The merchant lands on their own theme
 * with the gallery in place and presses Save.
 *
 * No new Shopify permission is involved: this is a URL we render as a button,
 * not an API call. Nothing is written to the theme until the merchant saves.
 */

/**
 * The published UUID of the theme app extension.
 *
 * Assigned by Shopify, not by us, and visible in the URL the storefront loads
 * its assets from:
 *
 *   cdn.shopify.com/extensions/<uuid>/sillages-NN/assets/social-gallery.js
 *
 * If the extension is ever recreated this changes, and a stale value makes the
 * deep link land the merchant in the theme editor without the block — annoying
 * but not broken, since they can still add it by hand.
 */
export const THEME_EXTENSION_UUID = '01a0a7f2-51ee-7532-b8c0-5bf150234eee';

/** The block's file name in `extensions/social-gallery/blocks`, without the suffix. */
const BLOCK_HANDLE = 'social-gallery';

/**
 * Templates worth offering, in the order they matter.
 *
 * `collection` first: that is the catalogue a shopper browses, and the whole
 * point of the app. `index` second, because a home-page gallery is a shop
 * window rather than the shop.
 */
export const PLACEMENTS = [
  {
    id: 'collection',
    template: 'collection',
    label: 'Add it to my collection pages',
    /** What the merchant gets, in their words rather than Shopify's. */
    outcome: 'Every collection a shopper opens becomes the gallery, in the design you chose here.',
  },
  {
    id: 'index',
    template: 'index',
    label: 'Add it to my home page',
    outcome: 'A gallery on the front page. Drag it above your featured products so it is the first thing seen.',
  },
] as const;

export type PlacementId = (typeof PLACEMENTS)[number]['id'];

/**
 * `newAppsSection` asks the editor for a section of its own rather than a slot
 * inside one of the theme's sections. It is the only target that behaves the
 * same in every Online Store 2.0 theme, and a section of its own is what makes
 * the gallery read as part of the page instead of a widget inside someone
 * else's block.
 *
 * `themes/current` avoids needing `read_themes` to look up a theme id: the
 * admin resolves it to whichever theme is published.
 */
export function themeEditorDeepLink(shopDomain: string, template: string): string {
  const handle = storeHandle(shopDomain);
  const params = new URLSearchParams({
    template,
    addAppBlockId: `${THEME_EXTENSION_UUID}/${BLOCK_HANDLE}`,
    target: 'newAppsSection',
  });
  return `https://admin.shopify.com/store/${handle}/themes/current/editor?${params.toString()}`;
}

export interface Placement {
  id: PlacementId;
  label: string;
  outcome: string;
  url: string;
}

/** Every placement, resolved for one shop. */
export function placementsFor(shopDomain: string): Placement[] {
  return PLACEMENTS.map((placement) => ({
    id: placement.id,
    label: placement.label,
    outcome: placement.outcome,
    url: themeEditorDeepLink(shopDomain, placement.template),
  }));
}
