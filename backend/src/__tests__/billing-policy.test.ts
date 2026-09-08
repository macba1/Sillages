/**
 * Billing policy.
 *
 * A decision, written down as executable assertions rather than as a comment
 * someone can miss: **Shopify Billing is the only way Sillages charges for the
 * social-gallery product.** In development, only Shopify test charges. No real
 * charges, no Stripe, no change to the app's distribution or to production.
 *
 * These tests exist so the decision survives the next person, including a
 * future me, who is looking for the quickest way to make a payment work.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

// The modules under test import the env, which exits the process when it cannot
// parse. Nothing here needs a real environment.
vi.mock('../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PRODUCT_MODE: 'social_gallery',
    SHOPIFY_APP_URL: 'https://example.test',
    SHOPIFY_API_SECRET: 'test-shopify-secret',
    FRONTEND_URL: 'http://localhost:5173',
  },
}));
vi.mock('../lib/supabase.js', () => ({ supabase: { from: () => { throw new Error('no db in tests'); } } }));
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const backendSrc = resolve(__dirname, '..');
const repoRoot = resolve(__dirname, '../../..');

/** Every file that belongs to the social-gallery product. */
function socialGalleryFiles(): string[] {
  const roots = [
    'services/billing', 'services/gallery', 'services/catalog',
    'services/events', 'services/preview', 'config',
  ].map((r) => join(backendSrc, r));
  roots.push(
    join(backendSrc, 'routes/subscription.ts'),
    join(backendSrc, 'routes/gallery.ts'),
    join(backendSrc, 'routes/catalog.ts'),
    join(backendSrc, 'routes/performance.ts'),
    join(backendSrc, 'routes/plans.ts'),
    join(backendSrc, 'routes/publicGallery.ts'),
    join(backendSrc, 'routes/publicPreview.ts'),
  );

  const out: string[] = [];
  const walk = (path: string) => {
    if (!existsSync(path)) return;
    if (statSync(path).isFile()) {
      if (path.endsWith('.ts')) out.push(path);
      return;
    }
    for (const entry of readdirSync(path)) walk(join(path, entry));
  };
  roots.forEach(walk);
  return out;
}

afterEach(() => {
  delete process.env.SHOPIFY_BILLING_LIVE;
});

describe('Shopify Billing is the only way we charge', () => {
  it('no file in the social-gallery product imports or calls Stripe', async () => {
    // Mentions in prose are fine, and several files say explicitly that Stripe
    // is not involved. What must not exist is a reference that could execute:
    // an import of the client, a construction, or a call on it.
    const forbidden = [
      /from\s+['"][^'"]*stripe[^'"]*['"]/i,   // importing the client or lib/stripe
      /require\(\s*['"][^'"]*stripe/i,
      /\bnew\s+Stripe\s*\(/,
      /\bstripe\.[a-zA-Z]/,                   // calling something on it
    ];

    // Strip comments first. Prose about Stripe is not a reference to it, and
    // several files mention `lib/stripe.ts` precisely to say they do not use it.
    const stripComments = (source: string) =>
      source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, ''))
        .join('\n');

    const offenders = socialGalleryFiles().filter((file) => {
      const code = stripComments(readFileSync(file, 'utf8'));
      return forbidden.some((pattern) => pattern.test(code));
    });

    expect(offenders.map((f) => f.replace(backendSrc, ''))).toEqual([]);
  });

  it('the Stripe environment variables stay optional, so their absence never blocks a boot', async () => {
    // They are still declared, because PRODUCT_MODE=legacy must remain
    // recoverable. They must never become required.
    const { parseEnv } = await import('../config/envSchema.js');
    const result = parseEnv({
      PRODUCT_MODE: 'social_gallery',
      FRONTEND_URL: 'http://localhost:5173',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      SHOPIFY_API_KEY: 'k',
      SHOPIFY_API_SECRET: 's',
      SHOPIFY_APP_URL: 'https://example.test',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.STRIPE_SECRET_KEY).toBeUndefined();
  });

  it('the plan configuration names Shopify Billing as the provider', async () => {
    const { SOCIAL_GALLERY_BILLING_PROVIDER } = await import('../config/socialGalleryPlans.js');
    expect(SOCIAL_GALLERY_BILLING_PROVIDER).toBe('shopify_billing');
  });

  it('the legacy Stripe routes are reachable only in legacy mode', async () => {
    const app = readFileSync(join(backendSrc, 'app.ts'), 'utf8');
    // The manifest entry for /api/billing — the Stripe surface — must be
    // legacy-only. If it ever becomes BOTH, Stripe is live in the new product.
    const line = app.split('\n').find((l) => l.includes("'/api/billing'"));
    expect(line).toBeDefined();
    expect(line).toContain('LEGACY_ONLY');
  });

  it('the Shopify Billing endpoints of the legacy app are also retired in the new product', () => {
    const shopify = readFileSync(join(backendSrc, 'routes/shopify.ts'), 'utf8');
    for (const route of ['/billing/subscribe', '/billing/callback', '/billing/status', '/billing-callback']) {
      const line = shopify.split('\n').find((l) => l.includes(`'${route}'`));
      expect(line, route).toContain('legacyOnly');
    }
  });
});

describe('development can only ever create a test charge', () => {
  it('billing is live only when the switch is exactly the string "true"', async () => {
    const { isLiveBilling } = await import('../services/billing/shopifyBilling.js');

    delete process.env.SHOPIFY_BILLING_LIVE;
    expect(isLiveBilling()).toBe(false);

    // Every near-miss spelling stays in test mode. A typo must not start
    // charging real money.
    for (const value of ['', 'false', 'TRUE', 'True', '1', 'yes', 'on', ' true', 'true ']) {
      process.env.SHOPIFY_BILLING_LIVE = value;
      expect(isLiveBilling(), JSON.stringify(value)).toBe(false);
    }

    process.env.SHOPIFY_BILLING_LIVE = 'true';
    expect(isLiveBilling()).toBe(true);
  });

  it('a subscription created without the switch is marked as a test charge', async () => {
    delete process.env.SHOPIFY_BILLING_LIVE;
    const { startSubscription } = await import('../services/billing/shopifyBilling.js');

    const calls: Record<string, unknown>[] = [];
    const client = {
      request: async (_q: string, variables: Record<string, unknown>) => {
        calls.push(variables);
        return {
          appSubscriptionCreate: {
            confirmationUrl: 'https://shop.myshopify.com/admin/charges/1/confirm',
            appSubscription: { id: 'gid://shopify/AppSubscription/1', status: 'PENDING' },
            userErrors: [],
          },
        };
      },
    };

    const result = await startSubscription('shop.myshopify.com', 'token', 'basic', {
      createClient: () => client as never,
    });

    expect(result).toMatchObject({ ok: true, test: true });
    // The flag Shopify itself uses to decide whether money moves.
    expect(calls[0].test).toBe(true);
  });

  it('a test charge unlocks features in development and nothing in production', async () => {
    const { entitlementsFor } = await import('../services/billing/entitlements.js');
    const testCharge = {
      connectionId: 'c', accountId: 'a', shopifyGid: 'gid://1', planId: 'basic' as const,
      status: 'active' as const, isTest: true, trialEndsAt: null,
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
    };

    delete process.env.SHOPIFY_BILLING_LIVE;
    expect(entitlementsFor(testCharge).canPublish).toBe(true);

    process.env.SHOPIFY_BILLING_LIVE = 'true';
    const inProduction = entitlementsFor(testCharge);
    expect(inProduction.canPublish).toBe(false);
    expect(inProduction.reason).toMatch(/test charge/i);
  });

  it('the development environment file does not enable live billing', () => {
    // Gitignored, so it may not exist — but if it does, it must not be the
    // thing that starts charging people.
    const envFile = join(repoRoot, 'backend/.env.dev');
    if (!existsSync(envFile)) return;

    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) continue;
      expect(trimmed).not.toMatch(/^SHOPIFY_BILLING_LIVE\s*=\s*true/);
    }
  });
});

describe('the public application is not touched', () => {
  it('the production configuration keeps its own identity and scopes', () => {
    const production = readFileSync(join(repoRoot, 'shopify.app.toml'), 'utf8');
    // Distribution is permanent once chosen, and the public app already has
    // one. Nothing in this branch may rewrite this file.
    expect(production).toContain('client_id = "35582656e15f06c81e7e4a9b0f828614"');
    expect(production).toContain('sillages-production.up.railway.app');
  });

  it('the development configuration declares no distribution at all', () => {
    const development = readFileSync(join(repoRoot, 'shopify.app.dev.toml'), 'utf8');
    // An app with no distribution chosen still installs on a development store
    // and still supports test charges. Choosing one is irreversible, so the
    // file must not do it silently.
    expect(development).not.toMatch(/^\s*distribution\s*=/m);
    expect(development).not.toContain('35582656e15f06c81e7e4a9b0f828614');
  });
});
