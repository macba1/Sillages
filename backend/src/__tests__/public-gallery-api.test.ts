/**
 * Sprint 2 — the public storefront API.
 *
 * This is the product's only unauthenticated, cross-origin surface, so it gets
 * its own suite: it boots the real Express app and issues real HTTP requests.
 *
 * Acceptance criteria covered here:
 *   B6 the storefront can read it without blocking or authenticating
 *   B7 a disabled gallery returns nothing to render
 *   B8 an unknown shop is indistinguishable from one with nothing published
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';

const BASE_ENV = {
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

const ACTIVE_GALLERY = {
  shop: 'alpha.myshopify.com',
  active: true,
  version: 4,
  style: 'warm',
  heading: 'Shop the look',
  showStories: true,
  showQuickBuy: true,
  stories: [{ id: 1, title: 'Summer', handle: 'summer', url: '/collections/summer', imageUrl: null }],
  posts: [
    {
      id: 10,
      handle: 'candle',
      title: 'Candle',
      url: '/products/candle',
      image: { url: 'https://cdn/x.jpg', altText: null, width: 800, height: 800 },
      images: [],
      priceMin: '20.00',
      priceMax: '20.00',
      available: true,
      variants: [{ id: 99, title: 'Default', price: '20.00', compareAtPrice: null, available: true, options: [] }],
    },
  ],
};

async function loadApp(compose: (shop: string) => Promise<unknown>) {
  vi.resetModules();
  vi.doMock('../config/env.js', () => ({ env: BASE_ENV }));
  vi.doMock('../services/gallery/galleryService.js', async () => {
    const actual = await vi.importActual<typeof import('../services/gallery/galleryService.js')>(
      '../services/gallery/galleryService.js',
    );
    return { ...actual, composePublicGallery: compose };
  });
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
  vi.doUnmock('../config/env.js');
  vi.doUnmock('../services/gallery/galleryService.js');
  vi.resetModules();
});

describe('GET /api/public/gallery/:shopDomain', () => {
  it('serves a published gallery without any authentication', async () => {
    const { createApp } = await loadApp(async () => ACTIVE_GALLERY);

    await withServer(createApp(), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/public/gallery/alpha.myshopify.com`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.active).toBe(true);
      expect(body.style).toBe('warm');
      expect(body.posts[0].variants[0].id).toBe(99);
    });
  });

  it('allows any storefront origin to read it, for GET only', async () => {
    const { createApp } = await loadApp(async () => ACTIVE_GALLERY);

    await withServer(createApp(), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/public/gallery/alpha.myshopify.com`, {
        headers: { Origin: 'https://alpha.myshopify.com' },
      });
      expect(res.headers.get('access-control-allow-origin')).toBe('*');

      const preflight = await fetch(`${baseUrl}/api/public/gallery/alpha.myshopify.com`, { method: 'OPTIONS' });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');

      // The surface is read-only: nothing accepts a write.
      const post = await fetch(`${baseUrl}/api/public/gallery/alpha.myshopify.com`, { method: 'POST' });
      expect(post.status).toBe(404);
    });
  });

  it('is cacheable, so it never becomes the slow part of a page', async () => {
    const { createApp } = await loadApp(async () => ACTIVE_GALLERY);

    await withServer(createApp(), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/public/gallery/alpha.myshopify.com`);
      expect(res.headers.get('cache-control')).toContain('max-age=60');
      expect(res.headers.get('cache-control')).toContain('stale-while-revalidate');
    });
  });

  it('returns an inactive gallery for an unknown or malformed shop', async () => {
    const { createApp } = await loadApp(async (shop: string) => ({
      shop, active: false, version: 0, style: 'original', heading: null,
      showStories: false, showQuickBuy: false, stories: [], posts: [],
    }));

    await withServer(createApp(), async (baseUrl) => {
      for (const shop of ['nobody.myshopify.com', 'not-a-domain', '../etc/passwd']) {
        const res = await fetch(`${baseUrl}/api/public/gallery/${encodeURIComponent(shop)}`);
        expect(res.status, shop).toBe(200);
        const body = await res.json();
        // Same answer either way, so this cannot be used to discover which
        // stores have Sillages installed.
        expect(body.active).toBe(false);
        expect(body.posts).toEqual([]);
      }
    });
  });

  it('is not throttled by the admin rate limiter', async () => {
    const { createApp } = await loadApp(async () => ACTIVE_GALLERY);

    await withServer(createApp(), async (baseUrl) => {
      // The admin limiter allows 100 requests per 15 minutes; a single shopper
      // reloading a page must not hit it.
      const statuses = [];
      for (let i = 0; i < 105; i += 1) {
        statuses.push((await fetch(`${baseUrl}/api/public/gallery/alpha.myshopify.com`)).status);
      }
      expect(statuses.every((s) => s === 200)).toBe(true);

      // The admin surface is still limited.
      let limited = false;
      for (let i = 0; i < 120 && !limited; i += 1) {
        limited = (await fetch(`${baseUrl}/api/catalog/status`)).status === 429;
      }
      expect(limited).toBe(true);
    });
  }, 60_000);

  it('is not exposed at all in legacy mode', async () => {
    vi.resetModules();
    vi.doMock('../config/env.js', () => ({
      env: { ...BASE_ENV, PRODUCT_MODE: 'legacy', OPENAI_API_KEY: 'x', RESEND_API_KEY: 'x' },
    }));
    const { createApp } = await import('../app.js');

    await withServer(createApp(), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/public/gallery/alpha.myshopify.com`);
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe('FEATURE_NOT_AVAILABLE_IN_PRODUCT_MODE');
    });
  });
});
