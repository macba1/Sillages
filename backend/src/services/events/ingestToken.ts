import crypto from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * Short-lived token binding an event batch to one shop.
 *
 * A storefront script is public, so this is deliberately NOT authentication:
 * anyone who loads a shop's gallery can read its token. What it buys us is
 * real, and worth stating plainly:
 *
 *  - events cannot be posted for a shop without first fetching that shop's
 *    gallery, so a single scraped token cannot be replayed across every store;
 *  - tokens expire, so a leaked one stops working;
 *  - the shop is carried by the signature rather than by a client-supplied
 *    field, so a batch cannot claim to belong to a different shop.
 *
 * Anything that must not be forgeable is derived server-side instead: order
 * totals come from the Shopify webhook, never from the browser.
 */

const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function sign(payload: string): string {
  return crypto.createHmac('sha256', env.SHOPIFY_API_SECRET).update(payload).digest('base64url');
}

export function issueIngestToken(shopDomain: string, now: () => number = Date.now): string {
  const expiry = now() + TTL_MS;
  const payload = `${shopDomain}.${expiry}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

export interface VerifiedToken {
  shopDomain: string;
  expiresAt: number;
}

export function verifyIngestToken(token: string, now: () => number = Date.now): VerifiedToken | null {
  if (typeof token !== 'string' || token.length > 512) return null;

  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  let payload: string;
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const expected = sign(payload);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;

  const separator = payload.lastIndexOf('.');
  if (separator < 1) return null;

  const shopDomain = payload.slice(0, separator);
  const expiresAt = Number(payload.slice(separator + 1));
  if (!Number.isFinite(expiresAt) || expiresAt < now()) return null;

  return { shopDomain, expiresAt };
}
