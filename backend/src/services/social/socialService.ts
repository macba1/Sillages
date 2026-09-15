import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { supabase } from '../../lib/supabase.js';
import { composePublicGallery } from '../gallery/galleryService.js';
import { priceRange } from './priceRange.js';
import { renderShareCard } from './shareCard.js';
import {
  newPicksToken,
  normalisePicks,
  supabasePicksStore,
  type PicksStore,
} from './picksService.js';
import type { PublicGallery, PublicPost } from '../gallery/galleryTypes.js';

/**
 * The social half of the storefront: the card worth sending, the list worth
 * sharing, and the question worth asking.
 *
 * Every entry point starts from the published gallery. That is deliberate: the
 * gallery already decides whether the shop may serve anything at all, which
 * plan it is on, and which products are public. Reading it again here means
 * none of those answers can drift apart from the storefront's.
 */

const LOG = '[social]';

export interface SocialDeps {
  picks?: PicksStore;
  gallery?: typeof composePublicGallery;
  /** Shop lookups, injected so the logic can be tested without a database. */
  connectionIdFor?: (shopDomain: string) => Promise<string | null>;
  shopDomainFor?: (connectionId: string) => Promise<string | null>;
  shopName?: (shopDomain: string) => Promise<string>;
  /** Injected in tests; defaults to writing straight to gallery_events. */
  record?: (event: SocialEvent) => Promise<void>;
}

export interface SocialEvent {
  connectionId: string;
  type: 'picks_visit' | 'friend_vote';
  productId: number | null;
  /**
   * The list, not the person.
   *
   * Sessions are counted distinctly on the Performance screen, and a visitor
   * to a shared list has no storefront session. Keying these to the list keeps
   * the count meaningful — "this link was opened" — without inventing an
   * identifier for somebody who never visited the shop.
   */
  sessionId: string;
}

/**
 * Writes one event from our own pages.
 *
 * Storefront events arrive through the signed ingest endpoint. These two do
 * not: they happen on a Sillages page, where there is no storefront token, so
 * they are written here after the work they describe actually succeeded.
 */
async function writeEvent(event: SocialEvent): Promise<void> {
  try {
    await supabase.from('gallery_events').insert({
      connection_id: event.connectionId,
      session_id: event.sessionId,
      event_type: event.type,
      product_shopify_id: event.productId,
      source: 'gallery',
      occurred_at: new Date().toISOString(),
      dedupe_key: `${event.type}:${event.sessionId}:${Date.now()}`,
    });
  } catch {
    // Measurement never blocks the thing being measured.
  }
}

type Failure = { ok: false; status: 400 | 403 | 404 | 429; reason: string };
type Success<T> = { ok: true; value: T };

/**
 * Proof that this browser made this list.
 *
 * Derived from the token rather than stored, so deleting a list needs no extra
 * column and no session: the creator's device keeps the key it was handed, and
 * nobody else can compute it without the server's secret.
 */
function ownerKeyFor(token: string): string {
  return createHmac('sha256', env.SHOPIFY_API_SECRET).update(`picks:${token}`).digest('base64url').slice(0, 32);
}

function ownerKeyMatches(token: string, provided: string): boolean {
  const expected = Buffer.from(ownerKeyFor(token));
  const given = Buffer.from(String(provided ?? ''));
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/**
 * The shop's own name and currency, for the card.
 *
 * The currency matters: the card is an image sent to someone who is not
 * looking at the store, and `1025.00` beside a snowboard could be dollars,
 * euros or anything else. The name falls back to the domain.
 */
async function lookUpShop(shopDomain: string): Promise<{ name: string; currency: string | null }> {
  const { data } = await supabase
    .from('shopify_connections')
    .select('shop_name, shop_currency')
    .eq('shop_domain', shopDomain)
    .maybeSingle();

  const row = data as { shop_name?: string | null; shop_currency?: string | null } | null;
  const name = row?.shop_name;
  const currency = row?.shop_currency;
  return {
    name: name && name.trim().length > 0 ? name.trim() : shopDomain.replace(/\.myshopify\.com$/i, ''),
    currency: currency && currency.trim().length > 0 ? currency.trim().toUpperCase() : null,
  };
}

async function lookUpConnectionId(shopDomain: string): Promise<string | null> {
  const { data } = await supabase
    .from('shopify_connections')
    .select('id')
    .eq('shop_domain', shopDomain)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

async function lookUpShopDomain(connectionId: string): Promise<string | null> {
  const { data } = await supabase
    .from('shopify_connections')
    .select('shop_domain')
    .eq('id', connectionId)
    .maybeSingle();
  return (data as { shop_domain?: string } | null)?.shop_domain ?? null;
}

// ── The shareable card ──────────────────────────────────────────

/**
 * Draws one product's card, or returns null.
 *
 * Only products in the published gallery get one. A product the merchant did
 * not choose to show is not made shareable by asking for it by id.
 */
export async function composeShareCard(
  shopDomain: string,
  productId: number,
  deps: SocialDeps = {},
): Promise<Buffer | null> {
  const gallery = await (deps.gallery ?? composePublicGallery)(shopDomain);
  if (!gallery.active) return null;

  const post = gallery.posts.find((p) => p.id === productId);
  if (!post) return null;

  const shop = deps.shopName
    ? { name: await deps.shopName(shopDomain), currency: null }
    : await lookUpShop(shopDomain);

  return renderShareCard({
    post,
    shopName: shop.name,
    productUrl: `https://${shopDomain}${post.url}`,
    tagline: gallery.shareTagline,
    showBranding: gallery.showBranding,
    style: gallery.style,
    intensity: gallery.filterIntensity,
    priceLabel: priceRange(post, shop.currency),
  });
}

// ── Shared lists ────────────────────────────────────────────────

export interface CreatedPicks {
  token: string;
  url: string;
  /** Kept by the creator's browser so it can delete its own list later. */
  ownerKey: string;
  mode: 'list' | 'vote';
}

export async function createPicks(
  shopDomain: string,
  rawIds: unknown,
  rawMode: unknown,
  deps: SocialDeps = {},
): Promise<Success<CreatedPicks> | Failure> {
  const gallery = await (deps.gallery ?? composePublicGallery)(shopDomain);
  if (!gallery.active) return { ok: false, status: 404, reason: 'not_found' };

  const normalised = normalisePicks(rawIds, rawMode);
  if (!normalised) return { ok: false, status: 400, reason: 'invalid_picks' };

  // The plan is checked here, on the server, and not only by hiding a button.
  // A Basic shop's storefront never shows "Share my picks"; a request that
  // arrives anyway is refused rather than served.
  const allowed = normalised.mode === 'vote' ? gallery.features.friendVotes : gallery.features.sharedLists;
  if (!allowed) return { ok: false, status: 403, reason: 'not_on_this_plan' };

  // Only products the merchant actually published can be put in a list.
  const publicIds = new Set(gallery.posts.map((post) => post.id));
  const productIds = normalised.productIds.filter((id) => publicIds.has(id));
  if (productIds.length === 0) return { ok: false, status: 400, reason: 'invalid_picks' };
  if (normalised.mode === 'vote' && productIds.length < 2) {
    return { ok: false, status: 400, reason: 'invalid_picks' };
  }

  const connectionId = await (deps.connectionIdFor ?? lookUpConnectionId)(shopDomain);
  if (!connectionId) return { ok: false, status: 404, reason: 'not_found' };

  const token = newPicksToken();
  const store = deps.picks ?? supabasePicksStore;
  const created = await store.create({ token, connectionId, productIds, mode: normalised.mode });
  if (!created) {
    console.warn(`${LOG} ${shopDomain}: could not store a list of ${productIds.length}`);
    return { ok: false, status: 400, reason: 'could_not_create' };
  }

  return {
    ok: true,
    value: {
      token,
      url: `${env.FRONTEND_URL.replace(/\/+$/, '')}/picks/${token}`,
      ownerKey: ownerKeyFor(token),
      mode: created.mode,
    },
  };
}

export interface PicksView {
  mode: 'list' | 'vote';
  shop: string;
  /** The look the merchant chose, so the shared page matches their gallery. */
  style: string;
  frame: string;
  filterIntensity: number;
  showBranding: boolean;
  products: PublicPost[];
  /** Product id → votes. Empty for a plain list. */
  votes: Record<number, number>;
  expiresAt: string;
}

export async function readPicks(token: string, deps: SocialDeps = {}): Promise<PicksView | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;

  const store = deps.picks ?? supabasePicksStore;
  const record = await store.getByToken(token);
  if (!record) return null;

  const shopDomain = await (deps.shopDomainFor ?? lookUpShopDomain)(record.connectionId);
  if (!shopDomain) return null;

  const gallery: PublicGallery = await (deps.gallery ?? composePublicGallery)(shopDomain);
  // A list outlives a gallery that has been turned off, but it must not keep
  // selling for a shop that stopped publishing.
  if (!gallery.active) return null;

  const byId = new Map(gallery.posts.map((post) => [post.id, post]));
  const products = record.productIds.map((id) => byId.get(id)).filter((p): p is PublicPost => Boolean(p));
  if (products.length === 0) return null;

  await (deps.record ?? writeEvent)({
    connectionId: record.connectionId,
    type: 'picks_visit',
    productId: null,
    sessionId: `picks:${token}`,
  });

  return {
    mode: record.mode,
    shop: shopDomain,
    style: gallery.style,
    frame: gallery.frame,
    filterIntensity: gallery.filterIntensity,
    showBranding: gallery.showBranding,
    products,
    votes: record.mode === 'vote' ? await store.tally(token) : {},
    expiresAt: record.expiresAt,
  };
}

// ── The vote ────────────────────────────────────────────────────

export async function castPickVote(
  token: string,
  rawProductId: unknown,
  rawVoterKey: unknown,
  deps: SocialDeps = {},
): Promise<Success<{ votes: Record<number, number> }> | Failure> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return { ok: false, status: 404, reason: 'not_found' };

  const productId = Number(rawProductId);
  if (!Number.isSafeInteger(productId) || productId <= 0) {
    return { ok: false, status: 400, reason: 'invalid_vote' };
  }

  // The voter's browser makes this up. It is not derived from the person, the
  // device or the network: it exists only so the same browser cannot vote
  // twice, and it is worth exactly as much as an informal poll deserves.
  const voterKey = String(rawVoterKey ?? '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(voterKey)) {
    return { ok: false, status: 400, reason: 'invalid_vote' };
  }

  const store = deps.picks ?? supabasePicksStore;
  const list = await store.getByToken(token);
  const ok = await store.castVote(token, productId, voterKey);
  if (!ok) return { ok: false, status: 404, reason: 'not_found' };

  if (list) {
    await (deps.record ?? writeEvent)({
      connectionId: list.connectionId,
      type: 'friend_vote',
      productId,
      sessionId: `picks:${token}`,
    });
  }

  return { ok: true, value: { votes: await store.tally(token) } };
}

export async function deletePicks(token: string, ownerKey: string, deps: SocialDeps = {}): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return false;
  if (!ownerKeyMatches(token, ownerKey)) return false;
  return (deps.picks ?? supabasePicksStore).softDelete(token);
}
