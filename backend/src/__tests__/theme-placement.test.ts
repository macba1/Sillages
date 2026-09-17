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
  themeEditorDeepLink,
} from '../services/gallery/themeDeepLink.js';

const SHOP = 'sillages-storefront-test.myshopify.com';

describe('the theme editor opens with the gallery already in it', () => {
  it('builds a link Shopify accepts', () => {
    const url = new URL(themeEditorDeepLink(SHOP, 'collection'));

    expect(url.host).toBe('admin.shopify.com');
    // `current` rather than a numeric id, so no read_themes scope is needed.
    expect(url.pathname).toBe('/store/sillages-storefront-test/themes/current/editor');
    expect(url.searchParams.get('template')).toBe('collection');
    expect(url.searchParams.get('addAppBlockId')).toBe(`${THEME_EXTENSION_UUID}/social-gallery`);
    // A section of its own is the only target that behaves the same in every
    // Online Store 2.0 theme.
    expect(url.searchParams.get('target')).toBe('newAppsSection');
  });

  it('offers the collection template first, because that is the catalogue', () => {
    expect(PLACEMENTS[0].template).toBe('collection');
    expect(PLACEMENTS.map((p) => p.template)).toEqual(['collection', 'index']);
  });

  it('describes each placement by what the merchant gets', () => {
    for (const placement of placementsFor(SHOP)) {
      expect(placement.outcome.length).toBeGreaterThan(30);
      expect(placement.url).toContain('addAppBlockId=');
      // Not a Shopify term in sight: no "app block", no "section target".
      expect(placement.outcome).not.toMatch(/app block|newAppsSection|template/i);
    }
  });

  it('carries the published extension UUID, not the local one from the toml', () => {
    // The local `uid` in shopify.extension.toml is not what the editor wants;
    // the published UUID is the one the storefront loads assets under.
    expect(THEME_EXTENSION_UUID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('asks for no new Shopify permission', () => {
    const source = readFileSync(resolve(__dirname, '../services/gallery/themeDeepLink.ts'), 'utf8');
    // It is a URL, not an API call. Nothing here talks to Shopify.
    expect(source).not.toMatch(/createClient|graphql|request\(/i);
  });
});
