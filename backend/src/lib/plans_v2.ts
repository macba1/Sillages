import { supabase } from './supabase.js';

const LOG = '[plans_v2]';

// ═══════════════════════════════════════════════════════════════════════════
// PLAN HELPER v2 — For WooCommerce merchants
//
// Simple plan gating. Fail open if no plan assigned (defaults to wc_free).
// Cache 5 minutes per account.
// ═══════════════════════════════════════════════════════════════════════════

interface PlanData {
  plan_id: string;
  name: string;
  price_usd: number;
  features: Record<string, boolean>;
  limits: Record<string, number>;
}

const DEFAULT_PLAN: PlanData = {
  plan_id: 'wc_free',
  name: 'Free',
  price_usd: 0,
  features: { dashboard: true, daily_brief: true, cart_recovery: true, welcome_emails: false },
  limits: { cart_recoveries_per_month: 10, welcome_emails_per_month: 0 },
};

// ── Cache ─────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { data: PlanData; expiresAt: number }>();

function getCached(accountId: string): PlanData | null {
  const entry = cache.get(accountId);
  if (!entry || Date.now() > entry.expiresAt) { cache.delete(accountId); return null; }
  return entry.data;
}

function setCache(accountId: string, data: PlanData): void {
  cache.set(accountId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function invalidatePlanCache(accountId: string): void {
  cache.delete(accountId);
}

// ── Core ──────────────────────────────────────────────────────────────────

export async function getPlan(accountId: string): Promise<PlanData> {
  const cached = getCached(accountId);
  if (cached) return cached;

  try {
    const { data: sub } = await supabase
      .from('account_subscriptions')
      .select('plan_id')
      .eq('account_id', accountId)
      .eq('status', 'active')
      .maybeSingle();

    if (!sub) { setCache(accountId, DEFAULT_PLAN); return DEFAULT_PLAN; }

    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('id, name, price_usd, features, limits')
      .eq('id', sub.plan_id)
      .single();

    if (!plan) { setCache(accountId, DEFAULT_PLAN); return DEFAULT_PLAN; }

    const result: PlanData = {
      plan_id: plan.id,
      name: plan.name,
      price_usd: plan.price_usd,
      features: (plan.features ?? {}) as Record<string, boolean>,
      limits: (plan.limits ?? {}) as Record<string, number>,
    };
    setCache(accountId, result);
    return result;
  } catch (err) {
    console.warn(`${LOG} Failed to load plan for ${accountId}: ${(err as Error).message} — using free defaults`);
    setCache(accountId, DEFAULT_PLAN);
    return DEFAULT_PLAN;
  }
}

export async function hasFeature(accountId: string, featureName: string): Promise<boolean> {
  const plan = await getPlan(accountId);
  return plan.features[featureName] === true;
}

export async function checkLimit(
  accountId: string,
  limitName: string,
  currentUsage: number,
): Promise<{ allowed: boolean; remaining: number; limit: number }> {
  const plan = await getPlan(accountId);
  const limit = plan.limits[limitName] ?? 0;
  if (limit === -1) return { allowed: true, remaining: Infinity, limit: -1 };
  const remaining = Math.max(0, limit - currentUsage);
  return { allowed: currentUsage < limit, remaining, limit };
}
