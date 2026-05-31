/**
 * Tests for lib/plans.ts — plan loading, feature gating, limit checks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase mock ──────────────────────────────────────────────────────────

const mockMaybeSingle = vi.fn();
const mockSingle = vi.fn();

const mockChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  maybeSingle: mockMaybeSingle,
  single: mockSingle,
};

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({ ...mockChain })),
  },
}));

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Plans helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the internal cache between tests
    vi.resetModules();
  });

  it('getPlan returns starter defaults when no subscription found', async () => {
    const { getPlan } = await import('../lib/plans.js');

    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const plan = await getPlan('no-sub-account');
    expect(plan.plan_id).toBe('starter');
    expect(plan.features.daily_brief).toBe(true);
    expect(plan.features.cart_recovery).toBeUndefined();
    expect(plan.limits.emails_per_month).toBe(0);
  });

  it('getPlan returns correct plan data for subscribed account', async () => {
    const { getPlan } = await import('../lib/plans.js');

    // First call: account_subscriptions
    mockMaybeSingle.mockResolvedValueOnce({
      data: { plan_id: 'crecimiento', is_beta: false },
      error: null,
    });

    // Second call: subscription_plans
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'crecimiento',
        name: 'Crecimiento',
        price_usd: 29,
        features: { daily_brief: true, cart_recovery: true, welcome_emails: true, weekly_brief: true },
        limits: { emails_per_month: 100, actions_per_day: 5 },
      },
      error: null,
    });

    const plan = await getPlan('growth-account');
    expect(plan.plan_id).toBe('crecimiento');
    expect(plan.name).toBe('Crecimiento');
    expect(plan.features.cart_recovery).toBe(true);
    expect(plan.features.reactivation).toBeUndefined();
    expect(plan.limits.emails_per_month).toBe(100);
  });

  it('hasFeature returns true for included features', async () => {
    const { hasFeature, invalidatePlanCache } = await import('../lib/plans.js');
    invalidatePlanCache('test-account');

    mockMaybeSingle.mockResolvedValueOnce({
      data: { plan_id: 'pro', is_beta: false },
      error: null,
    });
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'pro', name: 'Pro', price_usd: 59,
        features: { cart_recovery: true, reactivation: true, auto_discounts: true },
        limits: { emails_per_month: -1 },
      },
      error: null,
    });

    expect(await hasFeature('test-account', 'cart_recovery')).toBe(true);
    expect(await hasFeature('test-account', 'reactivation')).toBe(true);
    expect(await hasFeature('test-account', 'auto_discounts')).toBe(true);
  });

  it('hasFeature returns false for features not in plan', async () => {
    const { hasFeature, invalidatePlanCache } = await import('../lib/plans.js');
    invalidatePlanCache('starter-account');

    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    // Starter has no cart_recovery
    expect(await hasFeature('starter-account', 'cart_recovery')).toBe(false);
    expect(await hasFeature('starter-account', 'reactivation')).toBe(false);
    expect(await hasFeature('starter-account', 'weekly_brief')).toBe(false);
  });

  it('checkLimit allows when under limit', async () => {
    const { checkLimit, invalidatePlanCache } = await import('../lib/plans.js');
    invalidatePlanCache('limited-account');

    mockMaybeSingle.mockResolvedValueOnce({
      data: { plan_id: 'crecimiento', is_beta: false },
      error: null,
    });
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'crecimiento', name: 'Crecimiento', price_usd: 39,
        features: {},
        limits: { emails_per_month: 100 },
      },
      error: null,
    });

    const result = await checkLimit('limited-account', 'emails_per_month', 50);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(50);
    expect(result.limit).toBe(100);
  });

  it('checkLimit blocks when at limit', async () => {
    const { checkLimit, invalidatePlanCache } = await import('../lib/plans.js');
    invalidatePlanCache('maxed-account');

    mockMaybeSingle.mockResolvedValueOnce({
      data: { plan_id: 'crecimiento', is_beta: false },
      error: null,
    });
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'crecimiento', name: 'Crecimiento', price_usd: 39,
        features: {},
        limits: { emails_per_month: 100 },
      },
      error: null,
    });

    const result = await checkLimit('maxed-account', 'emails_per_month', 100);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('checkLimit allows unlimited (-1)', async () => {
    const { checkLimit, invalidatePlanCache } = await import('../lib/plans.js');
    invalidatePlanCache('pro-account');

    mockMaybeSingle.mockResolvedValueOnce({
      data: { plan_id: 'pro', is_beta: false },
      error: null,
    });
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'pro', name: 'Pro', price_usd: 59,
        features: {},
        limits: { emails_per_month: -1 },
      },
      error: null,
    });

    const result = await checkLimit('pro-account', 'emails_per_month', 9999);
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(-1);
  });

  it('getPlan fails open with full access when tables missing', async () => {
    const { getPlan, invalidatePlanCache } = await import('../lib/plans.js');
    invalidatePlanCache('error-account');

    mockMaybeSingle.mockRejectedValueOnce(new Error('relation "account_subscriptions" does not exist'));

    const plan = await getPlan('error-account');
    // Should fail open with pro-level access
    expect(plan.features.cart_recovery).toBe(true);
    expect(plan.features.welcome_emails).toBe(true);
    expect(plan.limits.emails_per_month).toBe(-1);
  });
});
