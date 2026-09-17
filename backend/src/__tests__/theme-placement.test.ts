/**
 * Placing the block should be one click, not five steps.
 *
 * The merchant asked the right question: "el punto 1 lo tendría que hacer cada
 * owner de tiendas?" It did, by hand, including the step that matters most —
 * the collection template — which is the one they were least likely to find.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PLACEMENTS,
  THEME_EXTENSION_UUID,
  placementsFor,
  placesBlockAutomatically,
  themeEditorDeepLink,
} from '../services/gallery/themeDeepLink.js';

const SHOP = 'sillages-storefront-test.myshopify.com';

describe('the theme editor opens with the gallery already in it', () => {
  it('opens the editor on the right template', () => {
    const url = new URL(themeEditorDeepLink(SHOP, 'collection'));

    expect(url.host).toBe('admin.shopify.com');
    // `current` rather than a numeric id, so no read_themes scope is needed.
    expect(url.pathname).toBe('/store/sillages-storefront-test/themes/current/editor');
    expect(url.searchParams.get('template')).toBe('collection');
  });

  it('does not ask the editor to insert the block until the id is confirmed', () => {
    // The first attempt used the id from the storefront's asset URL and the
    // editor answered "social-gallery not added. There is a problem with the
    // app block." A wrong id shows the merchant a red banner, which is worse
    // than one honest click, so the parameter is only sent when it is known.
    const url = new URL(themeEditorDeepLink(SHOP, 'collection'));
    if (THEME_EXTENSION_UUID === null) {
      expect(url.searchParams.get('addAppBlockId')).toBeNull();
      expect(url.searchParams.get('target')).toBeNull();
      expect(placesBlockAutomatically()).toBe(false);
    } else {
      expect(url.searchParams.get('addAppBlockId')).toBe(`${THEME_EXTENSION_UUID}/social-gallery`);
      expect(url.searchParams.get('target')).toBe('newAppsSection');
      expect(placesBlockAutomatically()).toBe(true);
    }
  });

  it('offers the collection template first, because that is the catalogue', () => {
    expect(PLACEMENTS[0].template).toBe('collection');
    expect(PLACEMENTS.map((p) => p.template)).toEqual(['collection', 'index']);
  });

  it('describes each placement by what the merchant gets', () => {
    for (const placement of placementsFor(SHOP)) {
      expect(placement.outcome.length).toBeGreaterThan(30);
      expect(placement.url).toContain('template=');
      // Not a Shopify term in sight: no "app block", no "section target".
      expect(placement.outcome).not.toMatch(/app block|newAppsSection|template/i);
    }
  });

  it('holds a real UUID or nothing, never a guess', () => {
    // The id in the asset URL changes between deployed versions, so it cannot
    // be the extension's identity. Anything set here has to be verified
    // against a theme first.
    if (THEME_EXTENSION_UUID !== null) {
      expect(THEME_EXTENSION_UUID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it('asks for no new Shopify permission', () => {
    const source = readFileSync(resolve(__dirname, '../services/gallery/themeDeepLink.ts'), 'utf8');
    // It is a URL, not an API call. Nothing here talks to Shopify.
    expect(source).not.toMatch(/createClient|graphql|request\(/i);
  });
});
