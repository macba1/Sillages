import { supabase } from './supabase.js';

const LOG = '[plans]';

// ═══════════════════════════════════════════════════════════════════════════
// PLAN & FEATURE GATING
//
// Every account has a plan (via account_subscriptions → subscription_plans).
// Features and limits are defined in the plan's JSONB columns.
// Accounts without a subscription default to 'starter' (free tier).
//
// Cache: 5 minutes per account to avoid hitting Supabase on every check.
// ═══════════════════════════════════════════════════════════════════════════

interface PlanData {
  plan_id: string;
  name: string;
  price_usd: number;
  features: Record<string, boolean>;
  limits: Record<string, number | string>;
  is_beta: boolean;
}

const DEFAULT_PLAN: PlanData = {
  plan_id: 'starter',
  name: 'Starter',
  price_usd: 0,
  features: { daily_brief: true, dashboard: true, manual_actions: true },
  limits: { emails_per_month: 0, manual_actions_per_month: 1 },
  is_beta: false,
};

// ── Cache ─────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const cache = new Map<string, { data: PlanData; expiresAt: number }>();

function getCached(accountId: string): PlanData | null {
  const entry = cache.get(accountId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(accountId);
    return null;
  }
  return entry.data;
}

function setCache(accountId: string, data: PlanData): void {
  cache.set(accountId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Clear cache for an account (e.g. after plan change). */
export function invalidatePlanCache(accountId: string): void {
  cache.delete(accountId);
}

// ── Core functions ────────────────────────────────────────────────────────

/**
 * Get the full plan data for an account.
 * Returns starter defaults if no subscription found.
 */
export async function getPlan(accountId: string): Promise<PlanData> {
  const cached = getCached(accountId);
  if (cached) return cached;

  try {
    const { data: sub } = await supabase
      .from('account_subscriptions')
      .select('plan_id, is_beta')
      .eq('account_id', accountId)
      .eq('status', 'active')
      .maybeSingle();

    if (!sub) {
      setCache(accountId, DEFAULT_PLAN);
      return DEFAULT_PLAN;
    }

    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('id, name, price_usd, features, limits')
      .eq('id', sub.plan_id)
      .single();

    if (!plan) {
      console.warn(`${LOG} Plan '${sub.plan_id}' not found for account ${accountId} — using starter`);
      setCache(accountId, DEFAULT_PLAN);
      return DEFAULT_PLAN;
    }

    const result: PlanData = {
      plan_id: plan.id,
      name: plan.name,
      price_usd: plan.price_usd,
      features: (plan.features ?? {}) as Record<string, boolean>,
      limits: (plan.limits ?? {}) as Record<string, number | string>,
      is_beta: sub.is_beta ?? false,
    };

    setCache(accountId, result);
    return result;
  } catch (err) {
    // If tables don't exist yet (migration not run), fail open with full access
    // This prevents breaking existing functionality during rollout
    console.warn(`${LOG} Failed to load plan for ${accountId}: ${(err as Error).message} — granting full access`);
    const fullAccess: PlanData = {
      ...DEFAULT_PLAN,
      plan_id: 'scale',
      name: 'Scale (fallback)',
      features: { ...DEFAULT_PLAN.features, cart_recovery: true, welcome_emails: true, reactivation: true, weekly_brief: true, push_notifications: true, auto_discounts: true, auto_seo: true, auto_merchandising: true },
      limits: { emails_per_month: -1, actions_per_day: -1 },
    };
    setCache(accountId, fullAccess);
    return fullAccess;
  }
}

/**
 * Check if an account has a specific feature enabled.
 */
export async function hasFeature(accountId: string, featureName: string): Promise<boolean> {
  const plan = await getPlan(accountId);
  return plan.features[featureName] === true;
}

/**
 * Check if an account is within a specific limit.
 * Returns { allowed, remaining, limit }.
 * limit = -1 means unlimited.
 */
export async function checkLimit(
  accountId: string,
  limitName: string,
  currentUsage: number,
): Promise<{ allowed: boolean; remaining: number; limit: number }> {
  const plan = await getPlan(accountId);
  const rawLimit = plan.limits[limitName];
  const limit = typeof rawLimit === 'number' ? rawLimit : 0;

  // -1 = unlimited
  if (limit === -1) {
    return { allowed: true, remaining: Infinity, limit: -1 };
  }

  const remaining = Math.max(0, limit - currentUsage);
  return { allowed: currentUsage < limit, remaining, limit };
}

/**
 * Get the current month's email count for an account.
 */
export async function getMonthlyEmailCount(accountId: string): Promise<number> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  try {
    const { count } = await supabase
      .from('email_log')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('channel', 'email')
      .eq('status', 'sent')
      .gte('sent_at', monthStart.toISOString());

    return count ?? 0;
  } catch {
    return 0;
  }
}
