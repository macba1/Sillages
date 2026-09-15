import sharp from 'sharp';
import type { PublicPost } from '../gallery/galleryTypes.js';

/**
 * Draws the vertical card a shopper sends a friend.
 *
 * A bare link is not something anybody wants to send. This is: the product
 * photograph, its name and price, the shop's name, and the address to buy it —
 * sized 1080×1920 so it drops straight into whatever the shopper is posting.
 *
 * Three rules govern the whole file:
 *
 *  1. Only photographs the shop already publishes are fetched, and only from
 *     Shopify's own CDN. The allowlist below is the SSRF protection: there is
 *     no code path that fetches a host the merchant or a shopper chose.
 *  2. Nothing about a person is drawn or accepted. The card is a function of
 *     public catalogue data and the shop's settings.
 *  3. Every string that reaches the SVG layer is escaped, because the text is
 *     merchant-controlled and an unescaped `&` would not merely look wrong —
 *     it would break the render for that product and no other.
 */

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1920;

/** Where a product photograph may come from. Nothing else is fetched. */
const ALLOWED_IMAGE_HOSTS = new Set([
  'cdn.shopify.com',
  'cdn.shopifycdn.net',
]);

/** A photograph that never arrives must not hold a request open. */
const FETCH_TIMEOUT_MS = 6000;

/** A Shopify product image is comfortably under this; anything larger is a trap. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export interface ShareCardInput {
  post: PublicPost;
  shopName: string;
  productUrl: string;
  tagline: string;
  /** Basic keeps a small Sillages mark; Growth removes it. */
  showBranding: boolean;
  /** One of the gallery filters, applied the same way the storefront does. */
  style: string;
  /** 0–100, the merchant's intensity setting. */
  intensity: number;
  priceLabel: string;
}

/** Whether a URL is one we are willing to fetch a photograph from. */
export function isAllowedImageUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return ALLOWED_IMAGE_HOSTS.has(url.hostname.toLowerCase());
}

/**
 * Shortens the product address so it fits on one line beside the mark.
 *
 * The scheme is already gone; what is dropped next is the tail of the path,
 * because the host is the part that tells a stranger which shop this is.
 */
export function trimUrl(raw: string, max: number): string {
  const bare = String(raw).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (bare.length <= max) return bare;
  return `${bare.slice(0, Math.max(1, max - 1))}…`;
}

/** XML-escapes text on its way into the SVG overlay. */
export function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Breaks a title over at most `maxLines`, ellipsing what will not fit. */
export function wrap(text: string, perLine: number, maxLines: number): string[] {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= perLine) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);

  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = `${last.slice(0, Math.max(0, perLine - 1)).trimEnd()}…`;
  }
  return lines;
}

/**
 * The same treatments the storefront applies in CSS, as the closest thing
 * sharp offers. They will never match a browser pixel for pixel; what matters
 * is that a card made from a Warm gallery reads as warm rather than neutral.
 */
function treat(image: sharp.Sharp, style: string, intensity: number): sharp.Sharp {
  const k = Math.min(1, Math.max(0, Number(intensity) / 100));
  if (!Number.isFinite(k) || k === 0 || style === 'original') return image;

  switch (style) {
    case 'warm':
      return image.modulate({ saturation: 1 + 0.10 * k, brightness: 1 }).tint({ r: 255, g: 246, b: 235 });
    case 'film':
      return image.modulate({ saturation: 1 - 0.10 * k, brightness: 1 + 0.02 * k }).linear(1 + 0.08 * k, -(8 * k));
    case 'soft':
      return image.modulate({ saturation: 1 - 0.04 * k, brightness: 1 + 0.05 * k }).linear(1 - 0.07 * k, 10 * k);
    case 'vintage':
      return image.modulate({ saturation: 1 - 0.14 * k, brightness: 1 + 0.03 * k }).tint({ r: 255, g: 240, b: 220 });
    case 'flash':
      return image.modulate({ saturation: 1 + 0.06 * k, brightness: 1 + 0.07 * k }).linear(1 + 0.12 * k, -(12 * k));
    default:
      return image;
  }
}

/** Fetches one product photograph, refusing anything that is not one. */
async function loadPhoto(url: string, fetchImpl: typeof fetch): Promise<Buffer | null> {
  if (!isAllowedImageUrl(url)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error' });
    if (!response.ok) return null;

    const type = response.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return null;

    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_IMAGE_BYTES) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.byteLength > MAX_IMAGE_BYTES ? null : buffer;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The text layer.
 *
 * Deliberately one SVG rather than several composites: it is a single raster
 * pass, and the gradient behind the words is what keeps them readable over a
 * photograph nobody chose for its bottom third.
 */
export function overlaySvg(input: ShareCardInput): string {
  const title = wrap(input.post.title, 24, 2).map(escapeXml);
  const shop = escapeXml(input.shopName);
  const price = escapeXml(input.priceLabel);
  const tagline = escapeXml(input.tagline);
  // The address is there to be read off a phone screen, not to be complete.
  // A long handle would otherwise run under the Sillages mark on the same line.
  const link = escapeXml(trimUrl(input.productUrl, input.showBranding ? 34 : 52));

  // Presentation attributes, not a stylesheet.
  //
  // The renderer behind sharp is librsvg, which does not apply the `font`
  // shorthand from a <style> block. Declaring it that way produced a card
  // where every line was drawn at the default size — legible on a desktop
  // preview and unreadable on the phone the card is actually made for.
  const FONT = 'DejaVu Sans, Helvetica, Arial, sans-serif';
  const text = (
    x: number,
    y: number,
    size: number,
    weight: number,
    opacity: number,
    content: string,
    anchor = 'start',
    spacing = 0,
  ) =>
    `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" ` +
    `fill="#ffffff" fill-opacity="${opacity}" text-anchor="${anchor}"` +
    (spacing ? ` letter-spacing="${spacing}"` : '') +
    `>${content}</text>`;

  const titleLines = title
    .map((line, i) => text(76, 1400 + i * 92, 74, 700, 1, line))
    .join('');

  const mark = input.showBranding
    ? text(1004, 1848, 28, 400, 0.52, 'made with Sillages', 'end')
    : '';

  return `<svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="veil" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.40" stop-color="#000000" stop-opacity="0"/>
      <stop offset="0.60" stop-color="#000000" stop-opacity="0.45"/>
      <stop offset="0.78" stop-color="#000000" stop-opacity="0.78"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.94"/>
    </linearGradient>
  </defs>
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#veil)"/>
  ${text(76, 1280, 36, 700, 0.88, shop.toUpperCase(), 'start', 4)}
  ${titleLines}
  ${text(76, 1606, 56, 600, 0.96, price)}
  ${text(76, 1690, 36, 400, 0.82, tagline)}
  ${text(76, 1848, 30, 400, 0.66, link)}
  ${mark}
</svg>`;
}

export interface RenderDeps {
  fetchImpl?: typeof fetch;
}

/**
 * Renders the card, or returns null.
 *
 * Null is a normal outcome, not an error: the storefront hides the preview and
 * every other way of sharing still works. A card that cannot be drawn must
 * never take sharing down with it.
 */
export async function renderShareCard(
  input: ShareCardInput,
  deps: RenderDeps = {},
): Promise<Buffer | null> {
  const source = input.post.image?.url;
  if (!source) return null;

  const photo = await loadPhoto(source, deps.fetchImpl ?? fetch);
  if (!photo) return null;

  try {
    const base = treat(
      sharp(photo, { failOn: 'none' }).resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'cover', position: 'attention' }),
      input.style,
      input.intensity,
    );

    return await base
      .composite([{ input: Buffer.from(overlaySvg(input)), top: 0, left: 0 }])
      .jpeg({ quality: 82, progressive: true, mozjpeg: true })
      .toBuffer();
  } catch {
    return null;
  }
}
