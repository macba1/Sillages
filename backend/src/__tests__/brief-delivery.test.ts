/**
 * Brief delivery tests — eligibility, email gating, and loud logging.
 * Guards the 2026-06-03 fix where daily briefs sent but never logged, test
 * stores were not excluded, and unsubscribe was not enforced on briefs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Table-aware supabase mock ───────────────────────────────────────────────
// Each table gets { list, single, insert }. The builder is awaitable (returns
// `list`), maybeSingle/single return `single`, and insert returns `insert`
// while capturing the inserted row.

interface TableFixture { list?: any; single?: any; insert?: any }
let fixtures: Record<string, TableFixture> = {};
const inserted: Record<string, any[]> = {};

function makeBuilder(table: string): any {
  const fx = fixtures[table] ?? {};
  const builder: any = {
    select: () => builder,
    or: () => builder,
    eq: () => builder,
    gte: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    update: () => builder,
    delete: () => builder,
    maybeSingle: () => Promise.resolve(fx.single ?? { data: null, error: null }),
    single: () => Promise.resolve(fx.single ?? { data: null, error: null }),
    insert: (row: any) => {
      (inserted[table] ??= []).push(row);
      return Promise.resolve(fx.insert ?? { data: null, error: null });
    },
    then: (resolve: any) => resolve(fx.list ?? { data: [], error: null }),
  };
  return builder;
}

vi.mock('../lib/supabase.js', () => ({
  supabase: { from: (table: string) => makeBuilder(table) },
}));

vi.mock('../lib/resend.js', () => ({
  resend: { emails: { send: vi.fn().mockResolvedValue({ data: { id: 'm1' }, error: null }) } },
}));

vi.mock('../config/env.js', () => ({
  env: { RESEND_FROM_EMAIL: 'test@sillages.app', FRONTEND_URL: 'https://test.sillages.app', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_EMAIL: 'test@sillages.app' },
}));

vi.mock('../services/pushNotifier.js', () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/weeklyEmailSender.js', () => ({ sendWeeklyBriefEmail: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  fixtures = {};
  for (const k of Object.keys(inserted)) delete inserted[k];
  vi.clearAllMocks();
});

// ── getEligibleMerchants ─────────────────────────────────────────────────────

describe('getEligibleMerchants', () => {
  function baseFixtures() {
    fixtures.accounts = {
      list: {
        data: [
          { id: 'andrea', email: 'marketing@nicolina.es', is_test: false },
          { id: 'devacct', email: 'tony@richmondpartner.com', is_test: false },
          { id: 'tester', email: 'purposeapp.tester7@shopify.com', is_test: false },
          { id: 'reviewer', email: 'reviewer@sillages.app', is_test: false },
        ],
        error: null,
      },
    };
    fixtures.shopify_connections = {
      list: {
        data: [
          { account_id: 'andrea', shop_domain: 'taart-madrid.myshopify.com', shop_name: 'NICOLINA', token_status: 'active' },
          { account_id: 'devacct', shop_domain: 'sillagesdev.myshopify.com', shop_name: 'sillagesdev', token_status: 'active' },
          { account_id: 'devacct', shop_domain: 'etw0qb-0c.myshopify.com', shop_name: 'Sillages', token_status: 'active' },
          { account_id: 'tester', shop_domain: 'tester7.myshopify.com', shop_name: 't7', token_status: 'active' },
          { account_id: 'reviewer', shop_domain: 'rev.myshopify.com', shop_name: 'rev', token_status: 'active' },
        ],
        error: null,
      },
    };
    fixtures.email_blacklist = { list: { data: [], error: null } };
    fixtures.email_unsubscribes = { list: { data: [], error: null } };
  }

  it('includes a real merchant (Andrea) and excludes test stores + ghosts', async () => {
    baseFixtures();
    const { getEligibleMerchants } = await import('../services/eligibleMerchants.js');
    const result = await getEligibleMerchants();
    const ids = result.map(m => m.account_id);

    expect(ids).toContain('andrea');
    expect(ids).not.toContain('devacct');   // both domains are test domains
    expect(ids).not.toContain('tester');    // @shopify.com ghost
    expect(ids).not.toContain('reviewer');  // reviewer@sillages.app ghost
    expect(result.find(m => m.account_id === 'andrea')?.shop).toBe('NICOLINA');
  });

  it('excludes an account marked is_test even with a real-looking domain', async () => {
    baseFixtures();
    fixtures.accounts!.list.data.push({ id: 'flagged', email: 'flagged@realshop.com', is_test: true });
    fixtures.shopify_connections!.list.data.push({ account_id: 'flagged', shop_domain: 'realshop.myshopify.com', shop_name: 'Real', token_status: 'active' });
    const { getEligibleMerchants } = await import('../services/eligibleMerchants.js');
    const ids = (await getEligibleMerchants()).map(m => m.account_id);
    expect(ids).not.toContain('flagged');
  });

  it('excludes an unsubscribed merchant', async () => {
    baseFixtures();
    fixtures.email_unsubscribes = { list: { data: [{ email: 'marketing@nicolina.es' }], error: null } };
    const { getEligibleMerchants } = await import('../services/eligibleMerchants.js');
    const ids = (await getEligibleMerchants()).map(m => m.account_id);
    expect(ids).not.toContain('andrea');
  });

  it('excludes a merchant with no live connection (uninstalled / invalid token)', async () => {
    baseFixtures();
    fixtures.shopify_connections!.list.data = fixtures.shopify_connections!.list.data.map((c: any) =>
      c.account_id === 'andrea' ? { ...c, token_status: 'invalid' } : c);
    const { getEligibleMerchants } = await import('../services/eligibleMerchants.js');
    const ids = (await getEligibleMerchants()).map(m => m.account_id);
    expect(ids).not.toContain('andrea');
  });
});

// ── canEmailMerchant ─────────────────────────────────────────────────────────

describe('canEmailMerchant', () => {
  it('returns false when unsubscribed', async () => {
    fixtures.email_unsubscribes = { single: { data: { email: 'x@y.com' }, error: null } };
    fixtures.email_blacklist = { single: { data: null, error: null } };
    const { canEmailMerchant } = await import('../services/commsGate.js');
    expect(await canEmailMerchant('x@y.com')).toBe(false);
  });

  it('returns false when blacklisted', async () => {
    fixtures.email_unsubscribes = { single: { data: null, error: null } };
    fixtures.email_blacklist = { single: { data: { email: 'x@y.com' }, error: null } };
    const { canEmailMerchant } = await import('../services/commsGate.js');
    expect(await canEmailMerchant('x@y.com')).toBe(false);
  });

  it('returns true for a clean address, false for empty', async () => {
    fixtures.email_unsubscribes = { single: { data: null, error: null } };
    fixtures.email_blacklist = { single: { data: null, error: null } };
    const { canEmailMerchant } = await import('../services/commsGate.js');
    expect(await canEmailMerchant('clean@shop.com')).toBe(true);
    expect(await canEmailMerchant('')).toBe(false);
  });
});

// ── logCommunication: loud on failure ────────────────────────────────────────

describe('logCommunication', () => {
  it('returns true and records the row on success', async () => {
    fixtures.email_log = { insert: { error: null } };
    const { logCommunication } = await import('../services/commLog.js');
    const ok = await logCommunication({ account_id: 'a', channel: 'daily_brief', status: 'sent', message_id: 'm1' });
    expect(ok).toBe(true);
    expect(inserted.email_log?.[0]).toMatchObject({ channel: 'daily_brief', status: 'sent', message_id: 'm1' });
  });

  it('returns false and logs loudly when the insert is rejected (constraint)', async () => {
    fixtures.email_log = { insert: { error: { message: 'violates check constraint "email_log_channel_check"' } } };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { logCommunication } = await import('../services/commLog.js');
    const ok = await logCommunication({ account_id: 'a', channel: 'daily_brief', status: 'sent' });
    expect(ok).toBe(false);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
