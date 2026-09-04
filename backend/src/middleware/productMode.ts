import type { Request, Response, NextFunction } from 'express';
import { isLegacyMode } from '../config/productMode.js';

/**
 * Controlled response for a legacy endpoint that is retired in the current
 * product mode. 404 (not 403/410) so the new product does not advertise which
 * legacy surfaces exist, while the machine-readable `code` still tells our own
 * clients why the route is gone.
 */
export function featureNotAvailableInProductMode(_req: Request, res: Response): void {
  res.status(404).json({
    error: 'Not found',
    code: 'FEATURE_NOT_AVAILABLE_IN_PRODUCT_MODE',
  });
}

/**
 * Per-handler guard for legacy endpoints that live inside a router which is
 * still mounted in `social_gallery` (currently only `routes/webhooks.ts`, whose
 * Shopify privacy and uninstall endpoints must stay reachable in every mode).
 */
export function legacyOnly(req: Request, res: Response, next: NextFunction): void {
  if (isLegacyMode()) {
    next();
    return;
  }
  featureNotAvailableInProductMode(req, res);
}
