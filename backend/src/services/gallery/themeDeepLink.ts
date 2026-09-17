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
 * The UUID the theme editor needs to insert the block by itself.
 *
 * Null on purpose. The first attempt used the id in the storefront's asset URL
 * (`cdn.shopify.com/extensions/<id>/sillages-NN/assets/...`) and the editor
 * answered "social-gallery not added. There is a problem with the app block."
 * That id is not the one the editor wants: it changes between deployed
 * versions, so it cannot be the extension's stable identity.
 *
 * Until the real one is confirmed against a theme, the link opens the editor on
 * the right template and the merchant presses Add block once. Two actions
 * instead of five, and no red banner. Setting this to a verified UUID turns
 * the last step into nothing without touching anything else.
 *
 * The authoritative value is the `type` recorded in the theme's own
 * `config/settings_data.json` once the block has been added by hand:
 *   "shopify://apps/<app>/blocks/social-gallery/<uuid>"
 */
export const THEME_EXTENSION_UUID: string | null = null;

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
    label: 'Put it on my collection pages',
    /** What the merchant gets, in their words rather than Shopify's. */
    outcome: 'Every collection a shopper opens becomes the gallery, in the design you chose here.',
  },
  {
    id: 'index',
    template: 'index',
    label: 'Put it on my home page',
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
  const params = new URLSearchParams({ template });

  // Only ask the editor to insert the block when we know the id it wants. A
  // wrong id does not degrade quietly: it shows the merchant a red "there is a
  // problem with the app block" banner, which is worse than one honest click.
  if (THEME_EXTENSION_UUID) {
    params.set('addAppBlockId', `${THEME_EXTENSION_UUID}/${BLOCK_HANDLE}`);
    params.set('target', 'newAppsSection');
  }

  return `https://admin.shopify.com/store/${handle}/themes/current/editor?${params.toString()}`;
}

/** Whether the editor will place the block, or the merchant still adds it. */
export function placesBlockAutomatically(): boolean {
  return THEME_EXTENSION_UUID !== null;
}

export interface Placement {
  id: PlacementId;
  label: string;
  outcome: string;
  url: string;
  /** False while the merchant still has to press Add block themselves. */
  autoPlaced: boolean;
}

/** Every placement, resolved for one shop. */
export function placementsFor(shopDomain: string): Placement[] {
  return PLACEMENTS.map((placement) => ({
    id: placement.id,
    label: placement.label,
    outcome: placement.outcome,
    url: themeEditorDeepLink(shopDomain, placement.template),
    autoPlaced: placesBlockAutomatically(),
  }));
}
