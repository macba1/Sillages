import { z } from 'zod';

/**
 * Product mode.
 *
 * - `legacy`         — the original Sillages product (briefs, alerts, actions,
 *                      chat, push, Tower, Stripe, growth agents…). Default, so
 *                      an unset PRODUCT_MODE never changes production behaviour.
 * - `social_gallery` — the new product (Shopify catalogue → shoppable social
 *                      gallery). Legacy cron jobs and legacy routes are not
 *                      started or mounted in this mode.
 *
 * Read it through `config/productMode.ts`, never by comparing strings inline.
 */
export const PRODUCT_MODES = ['legacy', 'social_gallery'] as const;
export type ProductMode = (typeof PRODUCT_MODES)[number];

/**
 * Vars that are only needed by the legacy product. They stay required in
 * `legacy` (enforced in the superRefine below) and become optional in
 * `social_gallery`, so the new product boots without OpenAI/Resend credentials.
 */
const LEGACY_ONLY_REQUIRED_VARS = ['OPENAI_API_KEY', 'RESEND_API_KEY'] as const;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),

  // Product mode — `legacy` is the safe default.
  PRODUCT_MODE: z.enum(PRODUCT_MODES).default('legacy'),

  // Frontend
  FRONTEND_URL: z.string().url(),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // OpenAI — required in `legacy` only (see superRefine below)
  OPENAI_API_KEY: z.string().min(1).optional(),

  // Resend — required in `legacy` only (see superRefine below)
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().email().default('briefs@sillages.co'),

  // Stripe (price IDs optional during beta — billing not yet active)
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRICE_ID_STARTER: z.string().min(1).optional(),
  STRIPE_PRICE_ID_GROWTH: z.string().min(1).optional(),
  STRIPE_PRICE_ID_SCALE: z.string().min(1).optional(),

  // Supabase webhook
  SUPABASE_WEBHOOK_SECRET: z.string().min(1).optional(),

  // Shopify OAuth — primary app
  SHOPIFY_API_KEY: z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1),
  SHOPIFY_SCOPES: z.string().default('read_all_orders,read_products,write_products,read_customers,write_customers,read_analytics,read_inventory,read_reports,read_pixels,write_discounts,read_checkouts,write_marketing_events'),
  SHOPIFY_APP_URL: z.string().url(),

  // Shopify OAuth — beta app (custom distribution)
  SHOPIFY_BETA_API_KEY: z.string().min(1).optional(),
  SHOPIFY_BETA_API_SECRET: z.string().min(1).optional(),

  // Dynamic workflow flags
  USE_DYNAMIC_BRIEF: z.string().optional().transform(v => v === 'true'),
  USE_DYNAMIC_RECOVERY: z.string().optional().transform(v => v === 'true'),
  USE_DYNAMIC_HEALTH: z.string().optional().transform(v => v === 'true'),
  USE_DYNAMIC_LEADS: z.string().optional().transform(v => v === 'true'),
  USE_DYNAMIC_OUTREACH: z.string().optional().transform(v => v === 'true'),
  USE_DYNAMIC_NURTURE: z.string().optional().transform(v => v === 'true'),
  USE_DYNAMIC_INBOX: z.string().optional().transform(v => v === 'true'),
  USE_DYNAMIC_CONTENT: z.string().optional().transform(v => v === 'true'),
  OUTREACH_DAILY_CAP: z.coerce.number().default(20),

  // Postiz (self-hosted social publishing). Optional until deployed.
  POSTIZ_API_URL: z.string().optional(),            // e.g. https://postiz.sillages.app
  POSTIZ_API_KEY: z.string().optional(),
  POSTIZ_INTEGRATION_ID: z.string().optional(),     // Instagram integration id (auto-resolved if absent)

  // Tavily Search API (free tier: 1,000 searches/month)
  TAVILY_API_KEY: z.string().min(1).optional(),

  // Resend webhook
  RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),

  // Web Push (VAPID)
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_EMAIL: z.string().default('mailto:support@sillages.app'),
}).superRefine((value, ctx) => {
  // In `legacy` the old product still needs its own credentials to boot.
  // In `social_gallery` they are unused, so their absence must not block start-up.
  if (value.PRODUCT_MODE !== 'legacy') return;

  for (const key of LEGACY_ONLY_REQUIRED_VARS) {
    if (!value[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `Required when PRODUCT_MODE=legacy`,
      });
    }
  }
});

/**
 * Pure parse helper. Exported so the per-mode requirements can be tested
 * without importing this module for its `process.exit(1)` side effect.
 */
export function parseEnv(source: NodeJS.ProcessEnv | Record<string, unknown>) {
  return envSchema.safeParse(source);
}
