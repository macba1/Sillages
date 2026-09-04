import { env } from './env.js';
import { PRODUCT_MODES, type ProductMode } from './envSchema.js';

export { PRODUCT_MODES };
export type { ProductMode };

/**
 * Central place to ask which product this process is running.
 *
 * Nothing outside this module should compare `PRODUCT_MODE` against a string
 * literal: import one of these helpers instead. That keeps the legacy product
 * reversible with a single environment variable and makes the mode surface
 * greppable.
 */
export function getProductMode(): ProductMode {
  return env.PRODUCT_MODE;
}

/** True for the original Sillages product (briefs, alerts, actions, Tower…). */
export function isLegacyMode(): boolean {
  return getProductMode() === 'legacy';
}

/** True for the new product (Shopify catalogue → shoppable social gallery). */
export function isSocialGalleryMode(): boolean {
  return getProductMode() === 'social_gallery';
}

/**
 * Guard for legacy-only background work (schedulers, auditors, workflows).
 * Returns true when the caller must NOT run because we are in the new product.
 */
export function legacyProcessesDisabled(): boolean {
  return !isLegacyMode();
}
