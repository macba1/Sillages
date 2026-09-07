/**
 * Sprint 0 — PRODUCT_MODE isolation.
 *
 * Proves, without deleting any legacy code, that:
 *   1. `legacy` keeps the previous behaviour (all legacy routes + cron jobs).
 *   2. `social_gallery` starts no legacy background task.
 *   3. `social_gallery` keeps the essential routes reachable.
 *   4. Legacy routes are not exposed in `social_gallery`.
 *   5. The new plan configuration returns Basic and Growth.
 *   6. Optional legacy env vars do not block start-up in `social_gallery`.
 *
 * Route assertions boot the real Express app on an ephemeral port and issue
 * real HTTP requests, so they verify the running server, not the source text.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';

// ── Fake environment shared by every mode ────────────────────────────────────
// Deliberately contains no real secrets: these are inert test literals.
const BASE_ENV = {
  NODE_ENV: 'test',
  PORT: 3001,
  FRONTEND_URL: 'http://localhost:5173',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
  RESEND_FROM_EMAIL: 'briefs@sillages.co',
  SHOPIFY_API_KEY: 'test-shopify-key',
  SHOPIFY_API_SECRET: 'test-shopify-secret',
  SHOPIFY_SCOPES: 'read_products',
  SHOPIFY_APP_URL: 'https://example.test',
  OUTREACH_DAILY_CAP: 20,
  VAPID_EMAIL: 'mailto:support@sillages.app',
  USE_DYNAMIC_BRIEF: false,
  USE_DYNAMIC_RECOVERY: false,
  USE_DYNAMIC_HEALTH: false,
  USE_DYNAMIC_LEADS: false,
  USE_DYNAMIC_OUTREACH: false,
  USE_DYNAMIC_NURTURE: false,
  USE_DYNAMIC_INBOX: false,
  USE_DYNAMIC_CONTENT: false,
};

/** Legacy-only credentials, absent on purpose in the social_gallery fixture. */
const LEGACY_CREDENTIALS = {
  OPENAI_API_KEY: 'test-openai-key',
  RESEND_API_KEY: 'test-resend-key',
};

function envFor(mode: 'legacy' | 'social_gallery') {
  return mode === 'legacy'
    ? { ...BASE_ENV, ...LEGACY_CREDENTIALS, PRODUCT_MODE: mode }
    : { ...BASE_ENV, PRODUCT_MODE: mode };
}

async function loadAppModule(mode: 'legacy' | 'social_gallery') {
  vi.resetModules();
  vi.doMock('../config/env.js', () => ({ env: envFor(mode) }));
  return import('../app.js');
}

/** Boots the app on an ephemeral port, runs `fn`, always closes the server. */
async function withServer<T>(app: Express, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const ESSENTIAL_PREFIXES = ['/api/auth', '/api/shopify', '/api/webhooks', '/api/accounts'];
const LEGACY_PREFIXES = [
  '/api/briefs',
  '/api/billing',
  '/api/alerts',
  '/api/admin',
  '/api/chat',
  '/api/push',
  '/api/actions',
  '/api/unsubscribe',
  '/api/tower',
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.doUnmock('../config/env.js');
  vi.resetModules();
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Test 1: route manifest per product mode', () => {
  it('legacy mounts every legacy route and no social_gallery route', async () => {
    const { getMountedRoutePrefixes, getBlockedRoutePrefixes } = await loadAppModule('legacy');

    const mounted = getMountedRoutePrefixes('legacy');
    for (const prefix of [...ESSENTIAL_PREFIXES, ...LEGACY_PREFIXES]) {
      expect(mounted).toContain(prefix);
    }
    expect(mounted).not.toContain('/api/plans');
    expect(mounted).not.toContain('/api/catalog');
    expect(getBlockedRoutePrefixes('legacy').sort()).toEqual(
      ['/api/catalog', '/api/gallery', '/api/performance', '/api/plans', '/api/public', '/api/subscription'].sort(),
    );
  });

  it('social_gallery mounts only essential routes plus /api/plans', async () => {
    const { getMountedRoutePrefixes, getBlockedRoutePrefixes } = await loadAppModule('social_gallery');

    expect(getMountedRoutePrefixes('social_gallery').sort()).toEqual(
      [...ESSENTIAL_PREFIXES, '/api/plans', '/api/catalog', '/api/gallery', '/api/performance', '/api/subscription', '/api/public'].sort(),
    );
    expect(getBlockedRoutePrefixes('social_gallery').sort()).toEqual([...LEGACY_PREFIXES].sort());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Test 2: social_gallery does not expose legacy routes', () => {
  it('every legacy prefix answers 404 FEATURE_NOT_AVAILABLE_IN_PRODUCT_MODE', async () => {
    const { createApp } = await loadAppModule('social_gallery');

    await withServer(createApp(), async (baseUrl) => {
      for (const prefix of LEGACY_PREFIXES) {
        const res = await fetch(`${baseUrl}${prefix}`);
        expect(res.status, `${prefix} should not be served`).toBe(404);
        const body = await res.json();
        expect(body.code, `${prefix} should report the retired-feature code`).toBe(
          'FEATURE_NOT_AVAILABLE_IN_PRODUCT_MODE',
        );
      }
    });
  });

  it('legacy Stripe / Resend / Supabase webhook endpoints are retired', async () => {
    const { createApp } = await loadAppModule('social_gallery');

    await withServer(createApp(), async (baseUrl) => {
      for (const path of ['/api/webhooks/stripe', '/api/webhooks/resend', '/api/webhooks/supabase']) {
        const res = await fetch(`${baseUrl}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        expect(res.status, `${path} should not be served`).toBe(404);
        expect((await res.json()).code).toBe('FEATURE_NOT_AVAILABLE_IN_PRODUCT_MODE');
      }
    });
  });

  it('legacy Shopify Billing endpoints are retired (no real subscription can be created)', async () => {
    const { createApp } = await loadAppModule('social_gallery');

    await withServer(createApp(), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/shopify/billing/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'basico' }),
      });
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe('FEATURE_NOT_AVAILABLE_IN_PRODUCT_MODE');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Test 3: social_gallery keeps the essential routes', () => {
  it('health check reports the active product mode', async () => {
    const { createApp } = await loadAppModule('social_gallery');

    await withServer(createApp(), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.productMode).toBe('social_gallery');
    });
  });

  it('Shopify connection, accounts and the compliance webhook stay mounted', async () => {
    const { createApp } = await loadAppModule('social_gallery');

    await withServer(createApp(), async (baseUrl) => {
      // 401 (not 404) proves the router is mounted and its auth guard ran.
      expect((await fetch(`${baseUrl}/api/shopify/connection`)).status).toBe(401);
      expect((await fetch(`${baseUrl}/api/accounts/language`)).status).toBe(401);

      // Mandatory privacy webhook: reachable, and still rejects an unsigned body.
      const compliance = await fetch(`${baseUrl}/api/webhooks/shopify-compliance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Topic': 'shop/redact' },
        body: '{}',
      });
      expect(compliance.status).not.toBe(404);
      expect([400, 401]).toContain(compliance.status);
    });
  });

  it('the catalogue routes are mounted and auth-guarded', async () => {
    const { createApp } = await loadAppModule('social_gallery');

    await withServer(createApp(), async (baseUrl) => {
      // 401 (not 404) proves the router is mounted behind requireAuth.
      expect((await fetch(`${baseUrl}/api/catalog/status`)).status).toBe(401);
      expect((await fetch(`${baseUrl}/api/catalog/collections`)).status).toBe(401);
      expect((await fetch(`${baseUrl}/api/catalog/sync`, { method: 'POST' })).status).toBe(401);
    });
  });

  it('the gallery admin routes are mounted and auth-guarded', async () => {
    const { createApp } = await loadAppModule('social_gallery');

    await withServer(createApp(), async (baseUrl) => {
      expect((await fetch(`${baseUrl}/api/gallery`)).status).toBe(401);
      expect((await fetch(`${baseUrl}/api/gallery/preview`)).status).toBe(401);
      expect((await fetch(`${baseUrl}/api/gallery/publish`, { method: 'POST' })).status).toBe(401);
      expect((await fetch(`${baseUrl}/api/gallery/disable`, { method: 'POST' })).status).toBe(401);
      expect((await fetch(`${baseUrl}/api/performance`)).status).toBe(401);
      expect((await fetch(`${baseUrl}/api/subscription`)).status).toBe(401);
    });
  });

  it('Shopify OAuth entry point is still available', async () => {
    const { createApp } = await loadAppModule('social_gallery');

    await withServer(createApp(), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/shopify/auth`, { redirect: 'manual' });
      expect(res.status).not.toBe(404);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Test 4: legacy keeps the previous behaviour', () => {
  it('legacy routes are served (auth-guarded, not retired)', async () => {
    const { createApp } = await loadAppModule('legacy');

    await withServer(createApp(), async (baseUrl) => {
      for (const path of ['/api/tower', '/api/alerts', '/api/actions']) {
        const res = await fetch(`${baseUrl}${path}`);
        expect(res.status, `${path} should still be served in legacy`).toBe(401);
      }
      const health = await fetch(`${baseUrl}/health`);
      expect((await health.json()).productMode).toBe('legacy');
    });
  });

  it('the new /api/plans and /api/catalog routes are not exposed in legacy', async () => {
    const { createApp } = await loadAppModule('legacy');

    await withServer(createApp(), async (baseUrl) => {
      for (const path of [
        '/api/plans',
        '/api/catalog/status',
        '/api/catalog/collections',
        '/api/gallery',
        '/api/public/gallery/anything.myshopify.com',
        '/api/performance',
        '/api/subscription',
      ]) {
        const res = await fetch(`${baseUrl}${path}`);
        expect(res.status, path).toBe(404);
        expect((await res.json()).code).toBe('FEATURE_NOT_AVAILABLE_IN_PRODUCT_MODE');
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Test 5: legacy background jobs', () => {
  async function loadScheduler(mode: 'legacy' | 'social_gallery') {
    vi.resetModules();
    const schedule = vi.fn();
    vi.doMock('../config/env.js', () => ({ env: envFor(mode) }));
    vi.doMock('node-cron', () => ({ default: { schedule }, schedule }));
    vi.doMock('../services/shopifyWebhooks.js', () => ({
      verifyAllWebhooks: vi.fn().mockResolvedValue(undefined),
      processShopifyWebhook: vi.fn().mockResolvedValue(undefined),
    }));
    const scheduler = await import('../services/scheduler.js');
    const auditor = await import('../services/auditor.js');
    return { schedule, scheduler, auditor };
  }

  afterEach(() => {
    vi.doUnmock('node-cron');
    vi.doUnmock('../services/shopifyWebhooks.js');
  });

  it('social_gallery registers no legacy cron job at all', async () => {
    const { schedule, scheduler, auditor } = await loadScheduler('social_gallery');

    scheduler.startScheduler();
    auditor.startAuditor();

    expect(schedule).not.toHaveBeenCalled();
  });

  it('the new product cron jobs run only in social_gallery', async () => {
    const sg = await loadScheduler('social_gallery');
    const sgCatalog = await import('../services/catalog/catalogScheduler.js');
    sgCatalog.startCatalogScheduler();

    // Nightly catalogue reconciliation and expired-preview cleanup.
    const schedules = sg.schedule.mock.calls.map((call) => call[0]);
    expect(schedules).toEqual(['20 4 * * *', '50 3 * * *']);

    const legacy = await loadScheduler('legacy');
    const legacyCatalog = await import('../services/catalog/catalogScheduler.js');
    legacyCatalog.startCatalogScheduler();
    expect(legacy.schedule).not.toHaveBeenCalled();
  });

  it('legacy still registers the scheduler and auditor cron jobs', async () => {
    const { schedule, scheduler, auditor } = await loadScheduler('legacy');

    scheduler.startScheduler();
    const afterScheduler = schedule.mock.calls.length;
    auditor.startAuditor();

    expect(afterScheduler).toBeGreaterThan(0);
    expect(schedule.mock.calls.length).toBeGreaterThan(afterScheduler);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Test 6: new product plan configuration', () => {
  it('returns Basic at $29 and Growth at $79 as the available plans', async () => {
    const { getAvailableSocialGalleryPlans } = await import('../config/socialGalleryPlans.js');

    const available = getAvailableSocialGalleryPlans();
    expect(available.map((p) => p.id)).toEqual(['basic', 'growth']);
    expect(available.find((p) => p.id === 'basic')?.priceUsd).toBe(29);
    expect(available.find((p) => p.id === 'growth')?.priceUsd).toBe(79);
    for (const plan of available) {
      expect(plan.currency).toBe('USD');
      expect(plan.interval).toBe('month');
    }
  });

  it('keeps Pro at $149 but not subscribable', async () => {
    const { SOCIAL_GALLERY_PLANS, getAvailableSocialGalleryPlans } = await import(
      '../config/socialGalleryPlans.js'
    );

    expect(SOCIAL_GALLERY_PLANS.pro.priceUsd).toBe(149);
    expect(SOCIAL_GALLERY_PLANS.pro.status).toBe('coming_soon');
    // "coming soon" must never leak into the subscribable set.
    expect(getAvailableSocialGalleryPlans().map((p) => p.id)).not.toContain('pro');
    // No trial is offered for a plan nobody can start.
    expect(SOCIAL_GALLERY_PLANS.pro.trialDays).toBe(0);
  });

  it('bills through Shopify Billing, never Stripe', async () => {
    const { SOCIAL_GALLERY_BILLING_PROVIDER } = await import('../config/socialGalleryPlans.js');
    expect(SOCIAL_GALLERY_BILLING_PROVIDER).toBe('shopify_billing');
  });

  it('serves the same configuration over GET /api/plans in social_gallery', async () => {
    const { createApp } = await loadAppModule('social_gallery');

    await withServer(createApp(), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/plans`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.billingProvider).toBe('shopify_billing');
      expect(body.plans.map((p: { id: string }) => p.id)).toEqual(['basic', 'growth']);
      expect(body.plans.map((p: { priceUsd: number }) => p.priceUsd)).toEqual([29, 79]);
      expect(body.upcomingPlans.map((p: { id: string }) => p.id)).toEqual(['pro']);
      expect(body.upcomingPlans[0].priceUsd).toBe(149);
      expect(body.upcomingPlans[0].status).toBe('coming_soon');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Test 7: environment requirements per mode', () => {
  const REQUIRED_ALWAYS = {
    FRONTEND_URL: 'http://localhost:5173',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
    SHOPIFY_API_KEY: 'test-shopify-key',
    SHOPIFY_API_SECRET: 'test-shopify-secret',
    SHOPIFY_APP_URL: 'https://example.test',
  };

  it('defaults to legacy when PRODUCT_MODE is unset', async () => {
    const { parseEnv } = await import('../config/envSchema.js');

    const result = parseEnv({ ...REQUIRED_ALWAYS, ...LEGACY_CREDENTIALS });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.PRODUCT_MODE).toBe('legacy');
  });

  it('rejects an unknown PRODUCT_MODE', async () => {
    const { parseEnv } = await import('../config/envSchema.js');

    const result = parseEnv({ ...REQUIRED_ALWAYS, ...LEGACY_CREDENTIALS, PRODUCT_MODE: 'galeria' });
    expect(result.success).toBe(false);
  });

  it('social_gallery boots without OpenAI, Resend, Postiz, Tavily, VAPID or Stripe', async () => {
    const { parseEnv } = await import('../config/envSchema.js');

    const result = parseEnv({ ...REQUIRED_ALWAYS, PRODUCT_MODE: 'social_gallery' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.OPENAI_API_KEY).toBeUndefined();
      expect(result.data.RESEND_API_KEY).toBeUndefined();
      expect(result.data.STRIPE_SECRET_KEY).toBeUndefined();
      expect(result.data.POSTIZ_API_KEY).toBeUndefined();
      expect(result.data.TAVILY_API_KEY).toBeUndefined();
      expect(result.data.VAPID_PUBLIC_KEY).toBeUndefined();
    }
  });

  it('legacy still requires OpenAI and Resend', async () => {
    const { parseEnv } = await import('../config/envSchema.js');

    const result = parseEnv({ ...REQUIRED_ALWAYS, PRODUCT_MODE: 'legacy' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.flatten().fieldErrors;
      expect(fields.OPENAI_API_KEY).toBeDefined();
      expect(fields.RESEND_API_KEY).toBeDefined();
    }
  });

  it('Shopify, Supabase and the frontend URL stay required in every mode', async () => {
    const { parseEnv } = await import('../config/envSchema.js');

    for (const mode of ['legacy', 'social_gallery'] as const) {
      const result = parseEnv({ PRODUCT_MODE: mode, ...LEGACY_CREDENTIALS });
      expect(result.success).toBe(false);
      if (!result.success) {
        const fields = result.error.flatten().fieldErrors;
        for (const key of Object.keys(REQUIRED_ALWAYS)) {
          expect(fields[key], `${key} must stay required in ${mode}`).toBeDefined();
        }
      }
    }
  });
});
