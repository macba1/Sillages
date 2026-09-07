import type {
  ShopSubscription,
  SubscriptionStatus,
  SubscriptionStore,
} from '../../services/billing/entitlements.js';
import type { ShopContext } from '../../services/catalog/catalogStore.js';
import type { SocialGalleryPlanId } from '../../config/socialGalleryPlans.js';

/** In-memory `SubscriptionStore`, keyed by connection like the real table. */
export class MemorySubscriptionStore implements SubscriptionStore {
  rows = new Map<string, ShopSubscription>();

  /** A shop paying for a plan right now. */
  setLive(ctx: ShopContext, planId: SocialGalleryPlanId, options: { isTest?: boolean } = {}): void {
    this.rows.set(ctx.connectionId, {
      connectionId: ctx.connectionId,
      accountId: ctx.accountId,
      shopifyGid: 'gid://shopify/AppSubscription/1',
      planId,
      status: 'active',
      isTest: options.isTest ?? false,
      trialEndsAt: null,
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
    });
  }

  setStatus(ctx: ShopContext, status: SubscriptionStatus): void {
    const existing = this.rows.get(ctx.connectionId);
    this.rows.set(ctx.connectionId, {
      ...(existing ?? {
        connectionId: ctx.connectionId,
        accountId: ctx.accountId,
        shopifyGid: null,
        planId: null,
        isTest: false,
        trialEndsAt: null,
        currentPeriodEnd: null,
      }),
      status,
    });
  }

  async get(connectionId: string): Promise<ShopSubscription | null> {
    return this.rows.get(connectionId) ?? null;
  }

  async upsert(subscription: ShopSubscription): Promise<void> {
    this.rows.set(subscription.connectionId, subscription);
  }

  async clear(connectionId: string, status: SubscriptionStatus): Promise<void> {
    const existing = this.rows.get(connectionId);
    if (existing) this.rows.set(connectionId, { ...existing, status, shopifyGid: null });
  }
}
