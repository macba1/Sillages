import { env } from '../../config/env.js';
import { isGalleryStyle, type GalleryStyle } from '../gallery/galleryTypes.js';
import { buildProposals, newPublicToken } from './previewGenerator.js';
import {
  CLAIM_TTL_MINUTES,
  PREVIEW_TTL_DAYS,
  supabasePreviewStore,
  type PreviewProject,
  type PreviewStore,
} from './previewStore.js';
import { detectStore, StoreDetectionError } from './storeDetector.js';
import type { SafeFetchOptions } from './safeFetch.js';

const LOG = '[preview]';

export interface PreviewDeps {
  store?: PreviewStore;
  fetchOptions?: SafeFetchOptions;
  now?: () => Date;
}

export type CreateResult =
  | { ok: true; project: PreviewProject; url: string }
  | { ok: false; status: 400 | 404 | 502; reason: string; message: string };

/**
 * Builds a private before/after from a store's own public catalogue.
 *
 * Nothing about the store is modified and nothing is installed: this reads only
 * what the storefront already publishes to any visitor.
 */
export async function createPreview(input: unknown, deps: PreviewDeps = {}): Promise<CreateResult> {
  const store = deps.store ?? supabasePreviewStore;
  const now = deps.now ?? (() => new Date());

  const url = typeof input === 'string' ? input : (input as { url?: unknown })?.url;
  if (typeof url !== 'string') {
    return { ok: false, status: 400, reason: 'invalid_url', message: 'Enter the address of a Shopify store.' };
  }

  let detected;
  try {
    detected = await detectStore(url, deps.fetchOptions ?? {});
  } catch (err) {
    if (err instanceof StoreDetectionError) {
      const status = err.code === 'unreachable' ? 502 : 400;
      return { ok: false, status, reason: err.code, message: err.message };
    }
    return { ok: false, status: 502, reason: 'unreachable', message: 'We could not reach that store.' };
  }

  const proposals = buildProposals(detected);
  const expiresAt = new Date(now().getTime() + PREVIEW_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const project = await store.create({
    shopDomain: detected.shopDomain,
    sourceUrl: detected.sourceUrl,
    shopName: detected.shopName,
    proposals,
    products: detected.products,
    publicToken: newPublicToken(),
    expiresAt,
  });

  console.log(`${LOG} built a preview for ${detected.shopDomain} (${detected.products.length} products)`);
  return { ok: true, project, url: previewUrl(project.publicToken) };
}

export function previewUrl(token: string): string {
  return `${env.FRONTEND_URL.replace(/\/+$/, '')}/preview/${token}`;
}

/** What the public preview page is allowed to see. */
export function publicPreviewPayload(project: PreviewProject, now: Date = new Date()) {
  const expired = Date.parse(project.expiresAt) < now.getTime();
  return {
    shopDomain: project.shopDomain,
    sourceUrl: project.sourceUrl,
    status: expired ? ('expired' as const) : project.status,
    expired,
    expiresAt: project.expiresAt,
    productCount: project.productCount,
    proposals: expired ? [] : project.proposals,
    claimed: Boolean(project.claimedByConnectionId),
  };
}

export type ClaimStartResult =
  | { ok: true; installUrl: string; claimToken: string }
  | { ok: false; status: 400 | 404 | 410; reason: string; message: string };

/**
 * Starts an install from a preview.
 *
 * The chosen proposal is written to a single-use server-side token; the browser
 * only ever carries the token. That is what makes "install and get exactly the
 * design you were shown" true rather than a hope about query strings.
 */
export async function startClaim(
  publicToken: string,
  proposal: unknown,
  deps: PreviewDeps = {},
): Promise<ClaimStartResult> {
  const store = deps.store ?? supabasePreviewStore;
  const now = deps.now ?? (() => new Date());

  if (!isGalleryStyle(proposal)) {
    return { ok: false, status: 400, reason: 'unknown_proposal', message: 'Choose one of the three designs.' };
  }

  const project = await store.getByToken(publicToken);
  if (!project) {
    return { ok: false, status: 404, reason: 'not_found', message: 'This preview no longer exists.' };
  }
  if (Date.parse(project.expiresAt) < now().getTime()) {
    return { ok: false, status: 410, reason: 'expired', message: 'This preview has expired.' };
  }

  const claimExpiry = new Date(now().getTime() + CLAIM_TTL_MINUTES * 60 * 1000).toISOString();
  const claimToken = await store.createClaimToken(project.id, proposal, claimExpiry);

  const installUrl =
    `${env.SHOPIFY_APP_URL.replace(/\/+$/, '')}/api/shopify/auth` +
    `?shop=${encodeURIComponent(project.shopDomain)}&preview=${encodeURIComponent(claimToken)}`;

  return { ok: true, installUrl, claimToken };
}

/**
 * Remembers the chosen design at the moment the merchant leaves for Shopify.
 *
 * Shopify's authorize URL carries only client_id, scope, redirect_uri and
 * state, so our claim token does not survive the round trip and the callback
 * never sees it. Recording the choice here is what makes "install and get
 * exactly the design you were shown" true rather than aspirational.
 *
 * Never throws: a failure here costs the merchant their chosen style, not their
 * installation.
 */
export async function recordPreviewChoice(
  claimToken: string | undefined,
  deps: PreviewDeps = {},
): Promise<boolean> {
  if (!claimToken) return false;
  const store = deps.store ?? supabasePreviewStore;

  try {
    const consumed = await store.consumeClaimToken(claimToken);
    if (!consumed) return false;
    await store.recordProposalChoice(consumed.previewId, consumed.proposal);
    console.log(`${LOG} recorded the "${consumed.proposal}" choice before the install`);
    return true;
  } catch (err) {
    console.warn(`${LOG} could not record the preview choice: ${(err as Error).message}`);
    return false;
  }
}

export interface ClaimedPreview {
  proposal: GalleryStyle;
  projectId: string;
}

/**
 * Recovers the proposal after an install. Returns null when there is nothing to
 * recover, which is the normal case for an ordinary App Store install.
 */
export async function claimPreview(
  claimToken: string | undefined,
  shopDomain: string,
  connectionId: string,
  deps: PreviewDeps = {},
): Promise<ClaimedPreview | null> {
  const store = deps.store ?? supabasePreviewStore;

  // Preferred path: the merchant came from a preview and carried its token.
  if (claimToken) {
    const consumed = await store.consumeClaimToken(claimToken);
    if (consumed) {
      await store.markClaimed(consumed.previewId, connectionId, consumed.proposal);
      if (isGalleryStyle(consumed.proposal)) {
        console.log(`${LOG} ${shopDomain}: recovered the "${consumed.proposal}" proposal`);
        return { proposal: consumed.proposal, projectId: consumed.previewId };
      }
    }
  }

  // Fallback: they saw a demo, then installed from the App Store instead of the
  // button. Matching by shop domain still recovers their design.
  const project = await store.findUnclaimedForShop(shopDomain);
  if (!project) return null;

  // The design the merchant actually picked, recorded before they left for
  // Shopify. Falling back to the first proposal would silently hand someone who
  // chose Film the Original design instead.
  const proposal = project.claimedProposal ?? project.proposals[0]?.style;
  if (!isGalleryStyle(proposal)) return null;

  await store.markClaimed(project.id, connectionId, proposal);
  console.log(`${LOG} ${shopDomain}: matched an unclaimed preview by shop domain`);
  return { proposal, projectId: project.id };
}
