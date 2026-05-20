import Stripe from 'stripe';
import { env } from '../config/env.js';

export const stripe = new Stripe(env.STRIPE_SECRET_KEY ?? 'sk_placeholder_not_active', {
  apiVersion: '2024-06-20',
  typescript: true,
});

// ── Plan definitions (legacy — Shopify Billing is primary) ───────────────────

export type PlanKey = 'starter' | 'basico' | 'crecimiento' | 'pro';

export const PLANS: Record<PlanKey, { name: string; priceId: () => string; amount: number }> = {
  starter: {
    name: 'Starter',
    priceId: () => env.STRIPE_PRICE_ID_STARTER ?? '',
    amount: 0,
  },
  basico: {
    name: 'Básico',
    priceId: () => env.STRIPE_PRICE_ID_GROWTH ?? '',
    amount: 1900,
  },
  crecimiento: {
    name: 'Crecimiento',
    priceId: () => env.STRIPE_PRICE_ID_SCALE ?? '',
    amount: 3900,
  },
  pro: {
    name: 'Pro',
    priceId: () => '',
    amount: 5900,
  },
};

export function getPriceId(plan: PlanKey): string {
  return PLANS[plan].priceId();
}

export function isPlanKey(value: unknown): value is PlanKey {
  return value === 'starter' || value === 'basico' || value === 'crecimiento' || value === 'pro';
}
