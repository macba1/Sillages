import type { ShopContext } from '../catalog/catalogStore.js';
import { supabaseGalleryStore, type GalleryStore } from './galleryStore.js';
import { issueIngestToken } from '../events/ingestToken.js';
import {
  entitlementsFor,
  supabaseSubscriptionStore,
  type Entitlements,
  type SubscriptionStore,
} from '../billing/entitlements.js';
import {
  inactiveGallery,
  isGalleryStyle,
  type GalleryConfig,
  type GallerySettings,
  type PublicGallery,
} from './galleryTypes.js';

const LOG = '[gallery]';

/** Collections shown as stories above the feed. */
const STORIES_LIMIT = 12;

export interface GalleryDeps {
  store?: GalleryStore;
  subscriptions?: SubscriptionStore;
  now?: () => number;
}

/** What a shop may do right now, closed by default. */
export async function entitlementsForShop(
  ctx: ShopContext,
  deps: GalleryDeps = {},
): Promise<Entitlements> {
  const subscriptions = deps.subscriptions ?? supabaseSubscriptionStore;
  return entitlementsFor(await subscriptions.get(ctx.connectionId), deps.now);
}

const DEFAULT_SETTINGS: GallerySettings = {
  collectionId: null,
  style: 'original',
  showStories: true,
  showQuickBuy: true,
  postsLimit: 60,
  heading: null,
};

/**
 * Normalises whatever the client sent into settings we are willing to store.
 * Anything unrecognised falls back to the default rather than reaching the
 * database and failing a check constraint.
 */
export function normaliseSettings(input: unknown, base: GallerySettings = DEFAULT_SETTINGS): GallerySettings {
  const raw = (input ?? {}) as Record<string, unknown>;

  const postsLimit = Number(raw.postsLimit ?? base.postsLimit);
  // `heading: null` is a deliberate "remove it", not an omission. Treating the
  // two the same made the heading impossible to clear once set.
  const headingProvided = Object.prototype.hasOwnProperty.call(raw, 'heading');
  const heading = headingProvided
    ? typeof raw.heading === 'string'
      ? raw.heading.trim().slice(0, 120)
      : null
    : base.heading;

  return {
    collectionId:
      raw.collectionId === null
        ? null
        : typeof raw.collectionId === 'string' && raw.collectionId.length > 0
          ? raw.collectionId
          : base.collectionId,
    style: isGalleryStyle(raw.style) ? raw.style : base.style,
    showStories: typeof raw.showStories === 'boolean' ? raw.showStories : base.showStories,
    showQuickBuy: typeof raw.showQuickBuy === 'boolean' ? raw.showQuickBuy : base.showQuickBuy,
    postsLimit: Number.isFinite(postsLimit) ? Math.min(250, Math.max(1, Math.trunc(postsLimit))) : base.postsLimit,
    heading: heading && heading.length > 0 ? heading : null,
  };
}

export async function getGallery(ctx: ShopContext, deps: GalleryDeps = {}): Promise<GalleryConfig> {
  const store = deps.store ?? supabaseGalleryStore;
  const existing = await store.getByConnection(ctx.connectionId);
  if (existing) return existing;
  // A shop always has a gallery to edit, even before it is published.
  return store.upsertSettings(ctx, DEFAULT_SETTINGS);
}

export async function saveGallery(
  ctx: ShopContext,
  input: unknown,
  deps: GalleryDeps = {},
): Promise<GalleryConfig> {
  const store = deps.store ?? supabaseGalleryStore;
  const current = await store.getByConnection(ctx.connectionId);
  const settings = normaliseSettings(input, current ? toSettings(current) : DEFAULT_SETTINGS);
  return store.upsertSettings(ctx, settings);
}

/**
 * Publishes the current settings.
 *
 * Bumps the version and snapshots it first, so every published state can be
 * returned to. The version also lets the storefront bust its cache.
 */
export type PublishResult =
  | { ok: true; gallery: GalleryConfig }
  | { ok: false; reason: 'no_gallery' | 'no_plan'; message: string };

/**
 * Publishing is the paid feature. A shop with no live plan cannot publish, and
 * — see `composePublicGallery` — a gallery published before a plan lapsed stops
 * being served.
 */
export async function publishGallery(ctx: ShopContext, deps: GalleryDeps = {}): Promise<PublishResult> {
  const store = deps.store ?? supabaseGalleryStore;

  const entitlements = await entitlementsForShop(ctx, deps);
  if (!entitlements.canPublish) {
    return { ok: false, reason: 'no_plan', message: entitlements.reason ?? 'Choose a plan to publish your gallery.' };
  }

  const current = await store.getByConnection(ctx.connectionId);
  if (!current) return { ok: false, reason: 'no_gallery', message: 'There is no gallery to publish yet.' };

  const published = await store.setStatus(current.id, 'published', current.version + 1);
  if (!published) return { ok: false, reason: 'no_gallery', message: 'There is no gallery to publish yet.' };

  await store.saveVersion(published);
  console.log(`${LOG} ${ctx.shopDomain}: published v${published.version}`);
  return { ok: true, gallery: published };
}

/**
 * Turns the gallery off. The storefront then renders nothing at all, which is
 * what "disable leaves no trace" means: no markup, no styles, no requests
 * beyond the one that reported it inactive.
 */
export async function disableGallery(ctx: ShopContext, deps: GalleryDeps = {}): Promise<GalleryConfig | null> {
  const store = deps.store ?? supabaseGalleryStore;
  const current = await store.getByConnection(ctx.connectionId);
  if (!current) return null;

  const disabled = await store.setStatus(current.id, 'disabled');
  console.log(`${LOG} ${ctx.shopDomain}: disabled`);
  return disabled;
}

/** Restores a previously published version and publishes it as a new version. */
export async function revertGallery(
  ctx: ShopContext,
  targetVersion: number,
  deps: GalleryDeps = {},
): Promise<GalleryConfig | null> {
  const store = deps.store ?? supabaseGalleryStore;
  const current = await store.getByConnection(ctx.connectionId);
  if (!current) return null;

  const snapshot = await store.getVersion(current.id, targetVersion);
  if (!snapshot) return null;

  await store.upsertSettings(ctx, normaliseSettings(snapshot));
  const published = await publishGallery(ctx, deps);
  if (!published.ok) return null;
  console.log(`${LOG} ${ctx.shopDomain}: reverted to v${targetVersion}`);
  return published.gallery;
}

/**
 * Builds the payload the storefront renders.
 *
 * Only published galleries produce content. Everything returned is public
 * storefront data: no account ids, no internal UUIDs, no customer data.
 */
export async function composePublicGallery(
  shopDomain: string,
  deps: GalleryDeps = {},
): Promise<PublicGallery> {
  const store = deps.store ?? supabaseGalleryStore;
  const found = await store.getPublishedByShopDomain(shopDomain);
  if (!found) return inactiveGallery(shopDomain);

  const { config, connectionId } = found;

  // A gallery published while a plan was live must stop being served when that
  // plan ends. The webhook disables it, but this is the closed-by-default
  // backstop for a webhook that never arrived.
  const entitlements = entitlementsFor(
    await (deps.subscriptions ?? supabaseSubscriptionStore).get(connectionId),
    deps.now,
  );
  if (!entitlements.canPublish) {
    console.log(`${LOG} ${shopDomain}: not served — ${entitlements.status}`);
    return inactiveGallery(shopDomain);
  }

  const [posts, stories] = await Promise.all([
    store.loadPosts(connectionId, config.collectionId, config.postsLimit),
    config.showStories ? store.loadStories(connectionId, STORIES_LIMIT) : Promise.resolve([]),
  ]);

  return {
    shop: shopDomain,
    active: true,
    version: config.version,
    ingestToken: issueIngestToken(shopDomain),
    style: config.style,
    heading: config.heading,
    showStories: config.showStories,
    showQuickBuy: config.showQuickBuy,
    stories,
    posts,
  };
}

function toSettings(config: GalleryConfig): GallerySettings {
  return {
    collectionId: config.collectionId,
    style: config.style,
    showStories: config.showStories,
    showQuickBuy: config.showQuickBuy,
    postsLimit: config.postsLimit,
    heading: config.heading,
  };
}
