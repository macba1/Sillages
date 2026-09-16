/**
 * What the first run on a real storefront found.
 *
 * Every assertion here is a bug that shipped, passed the whole suite, and was
 * only visible with the gallery open on a shop's own page. They are pinned
 * against the extension's source and the route that serves the card, because
 * that is the cheapest place to keep them from coming back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const assets = resolve(__dirname, '../../../extensions/social-gallery/assets');
const js = readFileSync(resolve(assets, 'social-gallery.js'), 'utf8');
const css = readFileSync(resolve(assets, 'social-gallery.css'), 'utf8');
const cardRoute = readFileSync(resolve(__dirname, '../routes/publicGallery.ts'), 'utf8');

describe('the shareable card can actually be shown', () => {
  it('is served so another origin may embed it', () => {
    // The app's default Cross-Origin-Resource-Policy is same-origin, which let
    // the card be fetched and opened but never embedded. On every storefront
    // the preview img failed silently and removed itself: no shopper had ever
    // seen the card before sending it.
    expect(cardRoute).toContain("res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')");
  });

  it('keeps its box when the card cannot be drawn', () => {
    // Removing the image changed the panel's height, which re-centred it while
    // a thumb was already moving towards a button.
    expect(css).toContain('.sg-share__frame');
    expect(css).toMatch(/\.sg-share__frame\s*\{[^}]*aspect-ratio: 9 \/ 16/);
  });

  it('downloads the card as a file rather than navigating to it', () => {
    // `download` is ignored on a cross-origin link, so the old version opened
    // the image and told the shopper it had been saved.
    expect(js).toContain('async function downloadCard');
    expect(js).toContain('URL.createObjectURL');
    expect(js).toContain('Card opened. Press and hold it to save.');
  });
});

describe('nothing blocks the page, and nothing lies about what happened', () => {
  it('never opens a browser prompt on a merchant storefront', () => {
    // window.prompt blocks every subsequent event until dismissed. The name
    // still appears in the comments that explain why it was removed, so this
    // looks for the call.
    expect(js).not.toMatch(/window\.prompt\(/);
  });

  it('keeps a link a shopper has just made on the screen', () => {
    expect(js).toContain('function showLink');
    expect(js).toContain('Send this to ask your friends');
  });

  it('does not offer a cart for a product that is sold out', () => {
    // The feed card printed SOLD OUT one line above an enabled Add to cart.
    expect(js).toMatch(/text: !post\.available \? 'Sold out'/);
    expect(js).toMatch(/disabled: !post\.available/);
    expect(css).toContain('.sg-feed-actions__buy[disabled]');
  });
});

describe('what the shopper sees while it loads, and what the theme cannot break', () => {
  it('puts photo paper under a photograph that has not arrived', () => {
    // The placeholder was a 6% tint of the current colour, which inside a dark
    // frame resolved to the frame's own near-black: a whole grid of black
    // rectangles until the images painted.
    expect(css).toContain('--sg-placeholder');
    expect(css).toMatch(/--sg-placeholder: color-mix\(in srgb, CanvasText 8%, Canvas\)/);
    expect(css).toMatch(/\.sg-card__media\s*\{[^}]*background: var\(--sg-placeholder\)/);
  });

  it('states the colour of every heading it draws', () => {
    // These are h3 elements. A theme that colours its own headings beats an
    // inherited colour, and in the story viewer that meant black on black.
    expect(css).toMatch(/\.sg-viewer__title\s*\{[^}]*color: #fff/);
    expect(css).toMatch(/\.sg-sheet__title\s*\{[^}]*color: CanvasText/);
  });

  it('hides the picks bar until something is saved', () => {
    // `display: flex` on the class beat the [hidden] attribute, so the bar sat
    // on the storefront reading "0 picks".
    expect(css).toContain('.sg-savedbar[hidden] { display: none; }');
  });

  it('shows a collection with no image of its own as its first product', () => {
    // Most shops never set a collection image, and the gallery opened with a
    // row of blank grey circles.
    expect(js).toContain("story.imageUrl || inStory.find((post) => post.image?.url)?.image?.url");
  });
});

describe('a keyboard can be used, and heard', () => {
  it('draws its own focus ring, which is the only visible one in the viewer', () => {
    // Measured on a real storefront with the tab focused: the theme's ring is
    // rgba(0,0,0,0.5), which is invisible on the viewer's #0b0a0c. In the grid
    // the theme's ring was already fine — carrying our own is insurance
    // against the many themes that clear it outright.
    expect(css).toContain(':focus-visible');
    expect(css).toMatch(/\[data-sillages-gallery\] :focus-visible[\s\S]{0,200}outline: 2px solid/);
    // The measured case: a white ring, because a dark one vanishes there.
    expect(css).toMatch(/\.sg-viewer :focus-visible\s*\{[^}]*outline-color: #fff/);
  });

  it('leaves the story bubble a button', () => {
    // role="listitem" sat on the button itself, which replaces the button role:
    // a screen reader announced "list item" and nothing pressable.
    expect(js).not.toMatch(/class: 'sg-story', type: 'button', role: 'listitem'/);
    expect(js).toContain("h('span', { class: 'sg-stories__item', role: 'listitem' }, [button])");
  });

  it('moves focus into an overlay and hands it back', () => {
    // Opening a full-screen story used to leave focus on the page behind it.
    expect(js).toContain("viewer.querySelector('.sg-viewer__close')?.focus()");
    expect(js).toMatch(/if \(returnFocusTo && returnFocusTo\.isConnected\) returnFocusTo\.focus\(\);/);
  });
});
