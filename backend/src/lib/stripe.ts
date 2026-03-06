import Stripe from 'stripe';
import { env } from '../config/env.js';

export const stripe = new Stripe(env.STRIPE_SECRET_KEY ?? 'sk_placeholder_not_active', {
  apiVersion: '2024-06-20',
  typescript: true,
});

// ── Plan definitions ──────────────────────────────────────────────────────────

export type PlanKey = 'starter' | 'growth' | 'scale';

export const PLANS: Record<PlanKey, { name: string; priceId: () => string; amount: number }> = {
  starter: {
    name: 'Starter',
    priceId: () => env.STRIPE_PRICE_ID_STARTER ?? '',
    amount: 2900,
  },
  growth: {
    name: 'Growth',
    priceId: () => env.STRIPE_PRICE_ID_GROWTH ?? '',
    amount: 7900,
  },
  scale: {
    name: 'Scale',
    priceId: () => env.STRIPE_PRICE_ID_SCALE ?? '',
    amount: 14900,
  },
};

export function getPriceId(plan: PlanKey): string {
  return PLANS[plan].priceId();
}

export function isPlanKey(value: unknown): value is PlanKey {
  return value === 'starter' || value === 'growth' || value === 'scale';
}
