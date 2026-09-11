/**
 * Final review — the whole unauthenticated surface, over real HTTP.
 *
 * The service-level suites cover the logic. This one boots the real Express app
 * and exercises the paths a browser actually takes, including CORS preflight,
 * which is where a working service and a broken product diverge.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';

const ENV = {
  NODE_ENV: 'test',
  PORT: 3001,
  PRODUCT_MODE: 'social_gallery',
  FRONTEND_URL: 'http://localhost:5173',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
  SHOPIFY_API_KEY: 'test-shopify-key',
  SHOPIFY_API_SECRET: 'test-shopify-secret',
  SHOPIFY_SCOPES: 'read_products',
  SHOPIFY_APP_URL: 'https://example.test',
  VAPID_EMAIL: 'mailto:support@sillages.app',
};

/**
 * Every module this file stubs. `vi.resetModules()` clears the module registry
 * but NOT the mock registrations, so without unmocking these between tests a
 * stub leaks into the next one — which is exactly how a "the generator refuses
 * a private address" test can silently pass on a mocked success.
 */
const MOCKED = [
  '../config/env.js',
  '../services/events/eventIngestion.js',
  '../services/preview/previewService.js',
  '../services/preview/previewStore.js',
];

async function loadApp(mocks: () => void = () => {}) {
  vi.resetModules();
  vi.doMock('../config/env.js', () => ({ env: ENV }));
  mocks();
  return import('../app.js');
}

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

afterEach(() => {
  for (const path of MOCKED) vi.doUnmock(path);
  vi.resetModules();
});

describe('the storefront can actually talk to the event endpoint', () => {
  it('answers the CORS preflight a JSON POST triggers', async () => {
    const { createApp } = await loadApp();

    await withServer(createApp(), async (baseUrl) => {
      const preflight = await fetch(`${baseUrl}/api/public/events`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://alpha.myshopify.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      });

      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
      // Without POST here, every browser would refuse to send the batch.
      expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
      expect(preflight.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('content-type');
    });
  });

  it('accepts a well-formed batch and rejects a forged token, with CORS headers on both', async () => {
    const accepted = { ok: true, accepted: 1, stored: 1 } as const;
    const { createApp } = await loadApp(() => {
      vi.doMock('../services/events/eventIngestion.js', () => ({
        ingestEventBatch: async (body: { token?: string }) =>
          body?.token === 'good-token-aaaaaaaaaaaaaaaa'
            ? accepted
            : { ok: false, status: 401, reason: 'invalid_or_expired_token' },
        ingestPurchase: async () => ({ ok: true, outcome: { attributed: false, reason: 'no_match' } }),
      }));
    });

    await withServer(createApp(), async (baseUrl) => {
      const good = await fetch(`${baseUrl}/api/public/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://alpha.myshopify.com' },
        body: JSON.stringify({ token: 'good-token-aaaaaaaaaaaaaaaa', sessionId: 'sess-1234abcd', events: [] }),
      });
      expect(good.status).toBe(202);
      expect(good.headers.get('access-control-allow-origin')).toBe('*');
      expect(await good.json()).toEqual({ accepted: 1, stored: 1 });

      const forged = await fetch(`${baseUrl}/api/public/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'forged', sessionId: 'sess-1234abcd', events: [] }),
      });
      expect(forged.status).toBe(401);
      // The refusal says nothing about which shops exist.
      expect(await forged.json()).toEqual({ error: 'invalid_or_expired_token' });
    });
  });

  it('has no purchase endpoint for anyone to post revenue to', async () => {
    // It used to exist behind a flag. The flag is gone with it: the only
    // credential this surface can check is the gallery ingest token, and that
    // is handed to every visitor of a published gallery, so no configuration
    // made the endpoint safe. Revenue comes from Shopify's signed
    // orders/create webhook instead.
    const { createApp } = await loadApp();

    await withServer(createApp(), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/public/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: 999, amount: 100000, currency: 'EUR' }),
      });

      expect(res.status).toBe(404);
      // Not the old "not_enabled": there is nothing to enable.
      expect(await res.json()).not.toMatchObject({ error: 'not_enabled' });
    });
  });
});

describe('the before/after generator over HTTP', () => {
  it('builds a preview, and marks it noindex so it never reaches a search engine', async () => {
    const { createApp } = await loadApp(() => {
      vi.doMock('../services/preview/previewService.js', async () => {
        const actual = await vi.importActual<typeof import('../services/preview/previewService.js')>(
          '../services/preview/previewService.js',
        );
        return {
          ...actual,
          createPreview: async () => ({
            ok: true,
            url: 'https://sillages.app/demo/tok',
            project: {
              publicToken: 'tok', shopDomain: 'alpha.myshopify.com', productCount: 12,
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
            },
          }),
        };
      });
    });

    await withServer(createApp(), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/public/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'alpha.myshopify.com' }),
      });

      expect(res.status).toBe(201);
      expect(res.headers.get('x-robots-tag')).toContain('noindex');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect((await res.json()).token).toBe('tok');
    });
  });

  it('refuses a store address that points at a private network, over HTTP', async () => {
    const { createApp } = await loadApp();

    await withServer(createApp(), async (baseUrl) => {
      for (const url of ['http://169.254.169.254/latest/meta-data/', 'https://127.0.0.1/', 'file:///etc/passwd']) {
        const res = await fetch(`${baseUrl}/api/public/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        expect([400, 502], url).toContain(res.status);
        const body = await res.json();
        // A readable message, and never the internal reason.
        expect(typeof body.message).toBe('string');
        expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|EAI_AGAIN|stack/i);
      }
    });
  }, 30_000);

  it('says a demo is gone rather than leaking whether the token ever existed', async () => {
    const { createApp } = await loadApp(() => {
      vi.doMock('../services/preview/previewStore.js', () => ({
        supabasePreviewStore: { getByToken: async () => null },
        PREVIEW_TTL_DAYS: 14,
        CLAIM_TTL_MINUTES: 60,
      }));
    });

    await withServer(createApp(), async (baseUrl) => {
      for (const token of ['short', 'a'.repeat(40)]) {
        const res = await fetch(`${baseUrl}/api/public/preview/${token}`);
        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe('not_found');
      }
    });
  });
});

describe('nothing of the new product exists in legacy mode', () => {
  it('every new endpoint answers with the retired-feature code', async () => {
    vi.resetModules();
    vi.doMock('../config/env.js', () => ({
      env: { ...ENV, PRODUCT_MODE: 'legacy', OPENAI_API_KEY: 'x', RESEND_API_KEY: 'x' },
    }));
    const { createApp } = await import('../app.js');

    await withServer(createApp(), async (baseUrl) => {
      const paths: [string, string][] = [
        ['GET', '/api/public/gallery/alpha.myshopify.com'],
        ['POST', '/api/public/events'],
        ['POST', '/api/public/purchase'],
        ['POST', '/api/public/preview'],
        ['GET', '/api/gallery'],
        ['GET', '/api/catalog/status'],
        ['GET', '/api/performance'],
        ['GET', '/api/subscription'],
        ['GET', '/api/plans'],
      ];

      for (const [method, path] of paths) {
        const res = await fetch(`${baseUrl}${path}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: method === 'POST' ? '{}' : undefined,
        });
        expect(res.status, `${method} ${path}`).toBe(404);
        expect((await res.json()).code, `${method} ${path}`).toBe('FEATURE_NOT_AVAILABLE_IN_PRODUCT_MODE');
      }
    });
  });
});
