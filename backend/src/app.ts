import express from 'express';
import type { Express, Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import { env } from './config/env.js';
import { getProductMode, type ProductMode } from './config/productMode.js';
import { errorHandler } from './middleware/errorHandler.js';
import { featureNotAvailableInProductMode } from './middleware/productMode.js';

import authRoutes from './routes/auth.js';
import shopifyRoutes from './routes/shopify.js';
import briefsRoutes from './routes/briefs.js';
import billingRoutes from './routes/billing.js';
import webhooksRoutes from './routes/webhooks.js';
import alertsRoutes from './routes/alerts.js';
import accountsRoutes from './routes/accounts.js';
import adminRoutes from './routes/admin.js';
import chatRoutes from './routes/chat.js';
import pushRoutes from './routes/push.js';
import actionsRoutes from './routes/actions.js';
import unsubscribeRoutes from './routes/unsubscribe.js';
import towerRoutes from './routes/tower.js';
import plansRoutes from './routes/plans.js';
import catalogRoutes from './routes/catalog.js';
import galleryRoutes from './routes/gallery.js';
import publicRoutes from './routes/public.js';
import performanceRoutes from './routes/performance.js';
import subscriptionRoutes from './routes/subscription.js';

/**
 * Declarative map of every mounted router and the product modes it belongs to.
 *
 * This is the single place that decides what the HTTP surface looks like per
 * mode. Nothing is deleted: a router absent from the current mode is simply not
 * mounted, and its prefix answers with a controlled "not found" instead.
 */
export interface RouteMount {
  prefix: string;
  router: Router;
  modes: readonly ProductMode[];
  /** Short note explaining why the route belongs to those modes. */
  reason: string;
}

const BOTH: readonly ProductMode[] = ['legacy', 'social_gallery'];
const LEGACY_ONLY: readonly ProductMode[] = ['legacy'];
const SOCIAL_GALLERY_ONLY: readonly ProductMode[] = ['social_gallery'];

export const ROUTE_MANIFEST: readonly RouteMount[] = [
  // ── Essential in every mode ──────────────────────────────────────────────
  { prefix: '/api/auth', router: authRoutes, modes: BOTH, reason: 'Authentication' },
  { prefix: '/api/shopify', router: shopifyRoutes, modes: BOTH, reason: 'Shopify OAuth, connection status, disconnect, reconnect' },
  { prefix: '/api/webhooks', router: webhooksRoutes, modes: BOTH, reason: 'Mandatory Shopify privacy webhooks + app/uninstalled (legacy Stripe/Resend/Supabase endpoints inside are gated with legacyOnly)' },
  { prefix: '/api/accounts', router: accountsRoutes, modes: BOTH, reason: 'Account settings' },

  // ── New product only ─────────────────────────────────────────────────────
  { prefix: '/api/plans', router: plansRoutes, modes: SOCIAL_GALLERY_ONLY, reason: 'Single source of truth for the new product plans' },
  { prefix: '/api/catalog', router: catalogRoutes, modes: SOCIAL_GALLERY_ONLY, reason: 'Live Shopify catalogue: status, collections, manual sync' },
  { prefix: '/api/gallery', router: galleryRoutes, modes: SOCIAL_GALLERY_ONLY, reason: 'Gallery settings, preview, publish, disable, revert' },
  { prefix: '/api/performance', router: performanceRoutes, modes: SOCIAL_GALLERY_ONLY, reason: 'Aggregate gallery performance and attributed revenue' },
  { prefix: '/api/subscription', router: subscriptionRoutes, modes: SOCIAL_GALLERY_ONLY, reason: 'Shopify Billing for the new product (test mode unless SHOPIFY_BILLING_LIVE=true)' },
  { prefix: '/api/public', router: publicRoutes, modes: SOCIAL_GALLERY_ONLY, reason: 'Unauthenticated surface: storefront gallery, event ingestion and the before/after generator' },

  // ── Legacy product only — retired in social_gallery, never deleted ───────
  { prefix: '/api/briefs', router: briefsRoutes, modes: LEGACY_ONLY, reason: 'Legacy briefs' },
  { prefix: '/api/billing', router: billingRoutes, modes: LEGACY_ONLY, reason: 'Legacy Stripe billing' },
  { prefix: '/api/alerts', router: alertsRoutes, modes: LEGACY_ONLY, reason: 'Legacy alerts' },
  { prefix: '/api/admin', router: adminRoutes, modes: LEGACY_ONLY, reason: 'Legacy admin triggers for scheduler/auditor/orchestrator' },
  { prefix: '/api/chat', router: chatRoutes, modes: LEGACY_ONLY, reason: 'Legacy brief chat' },
  { prefix: '/api/push', router: pushRoutes, modes: LEGACY_ONLY, reason: 'Legacy web push' },
  { prefix: '/api/actions', router: actionsRoutes, modes: LEGACY_ONLY, reason: 'Legacy actions and cart recovery' },
  { prefix: '/api/unsubscribe', router: unsubscribeRoutes, modes: LEGACY_ONLY, reason: 'Legacy email unsubscribe' },
  { prefix: '/api/tower', router: towerRoutes, modes: LEGACY_ONLY, reason: 'Legacy internal Tower' },
];

/** Prefixes mounted in the given mode. */
export function getMountedRoutePrefixes(mode: ProductMode): string[] {
  return ROUTE_MANIFEST.filter((r) => r.modes.includes(mode)).map((r) => r.prefix);
}

/** Prefixes that exist in the codebase but are NOT mounted in the given mode. */
export function getBlockedRoutePrefixes(mode: ProductMode): string[] {
  return ROUTE_MANIFEST.filter((r) => !r.modes.includes(mode)).map((r) => r.prefix);
}

/**
 * Builds the Express application. Kept separate from `index.ts` so tests can
 * construct the app without opening a port or starting background jobs.
 */
export function createApp(): Express {
  const mode = getProductMode();

  const app = express();
  app.set('trust proxy', 1);

  // ── Security & middleware ──────────────────────────────────────
  app.use(helmet());
  app.use(compression());
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  // Raw body required for Stripe and Shopify webhook signature verification
  // Must be registered BEFORE express.json()
  app.use('/api/webhooks', express.raw({ type: 'application/json' }));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ── CORS ──────────────────────────────────────────────────────
  // The admin API is restricted to our own front end. The storefront API is
  // read by arbitrary shop domains, so it is excluded here and sets its own
  // headers in `routes/publicGallery.ts`; otherwise this middleware would
  // answer its preflight with the admin method list and no allowed origin.
  const adminCors = cors({
    origin: [env.FRONTEND_URL, 'https://sillages.app', 'https://www.sillages.app'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/public/')) {
      next();
      return;
    }
    adminCors(req, res, next);
  });

  // ── Rate limiting ─────────────────────────────────────────────
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  });
  // The storefront API is public and high-traffic: it carries its own, more
  // generous limiter. Applying the admin limiter to it as well would throttle
  // ordinary shoppers behind a shared IP.
  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/public/')) {
      next();
      return;
    }
    limiter(req, res, next);
  });

  // ── Health check ──────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', productMode: mode, timestamp: new Date().toISOString() });
  });

  // ── Routes ────────────────────────────────────────────────────
  for (const mount of ROUTE_MANIFEST) {
    if (mount.modes.includes(mode)) {
      app.use(mount.prefix, mount.router);
    } else {
      // Retired in this mode: answer with a controlled response so no legacy
      // handler is ever reached, and so the behaviour is explicit and testable.
      app.use(mount.prefix, featureNotAvailableInProductMode);
    }
  }

  // ── 404 ───────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // ── Error handler (must be last) ──────────────────────────────
  app.use(errorHandler);

  return app;
}
