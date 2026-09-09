import { supabase } from '../../lib/supabase.js';
import { isSocialGalleryPlanId, type SocialGalleryPlanId } from '../../config/socialGalleryPlans.js';

const LOG = '[entitlements]';

/**
 * What a shop is allowed to do, derived from its subscription.
 *
 * Publishing a gallery is the paid feature. Without this, a cancellation, a
 * declined payment or an expired trial changed nothing: the gallery kept
 * serving and the merchant kept every premium feature indefinitely.
 */

/** Shopify statuses that mean the merchant is currently paying (or trialling). */
const LIVE_STATUSES = new Set(['active']);

/** Statuses that mean the plan is over. Anything here revokes access. */
const DEAD_STATUSES = new Set(['declined', 'expired', 'frozen', 'cancelled', 'none']);

/** Whether a status means the plan is over. */
export function isDeadStatus(status: SubscriptionStatus): boolean {
  return DEAD_STATUSES.has(status);
}

export type SubscriptionStatus =
  | 'none' | 'pending' | 'active' | 'declined' | 'expired' | 'frozen' | 'cancelled';

export interface ShopSubscription {
  connectionId: string;
  accountId: string;
  shopifyGid: string | null;
  planId: SocialGalleryPlanId | null;
  status: SubscriptionStatus;
  isTest: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
}

export interface Entitlements {
  /** May the shop publish, and may a published gallery keep serving? */
  canPublish: boolean;
  /** Growth-only features. */
  canUseMultipleGalleries: boolean;
  canUseAttribution: boolean;
  planId: SocialGalleryPlanId | null;
  status: SubscriptionStatus;
  isTest: boolean;
  /** Why access is denied, in words a merchant can act on. */
  reason: string | null;
}

/**
 * Whether test charges unlock paid features.
 *
 * They must, in development — the whole point of a test charge is exercising
 * the flow. They must not in production, or a merchant could unlock everything
 * with a charge nobody pays. Tied to the same switch that governs live billing.
 */
export function testChargesGrantAccess(): boolean {
  return process.env.SHOPIFY_BILLING_LIVE !== 'true';
}

export const NO_SUBSCRIPTION: ShopSubscription = {
  connectionId: '',
  accountId: '',
  shopifyGid: null,
  planId: null,
  status: 'none',
  isTest: true,
  trialEndsAt: null,
  currentPeriodEnd: null,
};

/**
 * Derives what a shop may do. Deliberately closed by default: an unknown or
 * unreadable subscription grants nothing.
 */
export function entitlementsFor(
  subscription: ShopSubscription | null,
  now: () => number = Date.now,
): Entitlements {
  const sub = subscription ?? NO_SUBSCRIPTION;

  if (DEAD_STATUSES.has(sub.status)) {
    return denied(sub, sub.status === 'none'
      ? 'Choose a plan to publish your gallery.'
      : 'Your plan is no longer active, so your gallery is not being served. Choose a plan to bring it back.');
  }

  if (!LIVE_STATUSES.has(sub.status)) {
    return denied(sub, 'Your plan has not been approved in Shopify yet.');
  }

  if (sub.isTest && !testChargesGrantAccess()) {
    return denied(sub, 'This is a Shopify test charge, which does not activate a paid plan.');
  }

  // Shopify keeps a subscription 'active' through its trial, so the period end
  // is the only thing that says whether it has actually lapsed.
  if (sub.currentPeriodEnd && Date.parse(sub.currentPeriodEnd) < now()) {
    return denied(sub, 'Your billing period has ended. Shopify will renew it, or you can choose a plan again.');
  }

  const planId = isSocialGalleryPlanId(String(sub.planId)) ? sub.planId : null;

  return {
    canPublish: true,
    canUseMultipleGalleries: planId === 'growth',
    canUseAttribution: planId === 'growth',
    planId,
    status: sub.status,
    isTest: sub.isTest,
    reason: null,
  };
}

function denied(sub: ShopSubscription, reason: string): Entitlements {
  return {
    canPublish: false,
    canUseMultipleGalleries: false,
    canUseAttribution: false,
    planId: isSocialGalleryPlanId(String(sub.planId)) ? sub.planId : null,
    status: sub.status,
    isTest: sub.isTest,
    reason,
  };
}

// ── Persistence ─────────────────────────────────────────────────────────────

export interface SubscriptionStore {
  get(connectionId: string): Promise<ShopSubscription | null>;
  upsert(subscription: ShopSubscription): Promise<void>;
  /** Marks a shop as having no plan, on uninstall or cancellation. */
  clear(connectionId: string, status: SubscriptionStatus): Promise<void>;
}

export const supabaseSubscriptionStore: SubscriptionStore = {
  async get(connectionId: string): Promise<ShopSubscription | null> {
    const { data, error } = await supabase
      .from('shop_subscriptions')
      .select('*')
      .eq('connection_id', connectionId)
      .maybeSingle();

    if (error || !data) return null;
    return {
      connectionId: data.connection_id as string,
      accountId: data.account_id as string,
      shopifyGid: (data.shopify_gid as string | null) ?? null,
      planId: (data.plan_id as SocialGalleryPlanId | null) ?? null,
      status: data.status as SubscriptionStatus,
      isTest: Boolean(data.is_test),
      trialEndsAt: (data.trial_ends_at as string | null) ?? null,
      currentPeriodEnd: (data.current_period_end as string | null) ?? null,
    };
  },

  async upsert(subscription: ShopSubscription): Promise<void> {
    const { error } = await supabase.from('shop_subscriptions').upsert(
      {
        connection_id: subscription.connectionId,
        account_id: subscription.accountId,
        shopify_gid: subscription.shopifyGid,
        plan_id: subscription.planId,
        status: subscription.status,
        is_test: subscription.isTest,
        trial_ends_at: subscription.trialEndsAt,
        current_period_end: subscription.currentPeriodEnd,
      },
      { onConflict: 'connection_id' },
    );
    if (error) throw new Error(`saving the subscription failed: ${error.message}`);
  },

  async clear(connectionId: string, status: SubscriptionStatus): Promise<void> {
    const { error } = await supabase
      .from('shop_subscriptions')
      .update({ status, shopify_gid: null })
      .eq('connection_id', connectionId);
    if (error) console.warn(`${LOG} could not clear ${connectionId}: ${error.message}`);
  },
};
