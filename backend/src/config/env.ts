import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),

  // Frontend
  FRONTEND_URL: z.string().url(),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // OpenAI
  OPENAI_API_KEY: z.string().min(1),

  // Resend
  RESEND_API_KEY: z.string().min(1),
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

  // Web Push (VAPID)
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_EMAIL: z.string().default('mailto:support@sillages.app'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('[env] Missing or invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
