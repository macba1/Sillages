import { z } from 'zod';

/**
 * The event contract.
 *
 * Strict by construction: `.strict()` rejects any field we did not ask for, so
 * a storefront cannot smuggle an email, a customer id or a user agent into our
 * database by adding it to the payload. Nothing here identifies a person.
 */

export const GALLERY_EVENT_TYPES = [
  'gallery_view',
  'post_view',
  'post_open',
  'variant_select',
  'save',
  'unsave',
  'share',
  'add_to_cart',
  'checkout_started',
  'purchase',
] as const;

export type GalleryEventType = (typeof GALLERY_EVENT_TYPES)[number];

/** Events the storefront may report. Money and orders are not among them. */
export const CLIENT_REPORTABLE_TYPES: readonly GalleryEventType[] = [
  'gallery_view',
  'post_view',
  'post_open',
  'variant_select',
  'save',
  'unsave',
  'share',
  'add_to_cart',
  'checkout_started',
];

export const SHARE_CHANNELS = ['link', 'whatsapp', 'native', 'other'] as const;

/** The only extras we keep, each bounded. */
const metaSchema = z
  .object({
    channel: z.enum(SHARE_CHANNELS).optional(),
    style: z.enum(['original', 'warm', 'film']).optional(),
    position: z.number().int().min(0).max(1000).optional(),
  })
  .strict()
  .default({});

const shopifyId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const clientEventSchema = z
  .object({
    type: z.enum(GALLERY_EVENT_TYPES),
    /** Client-supplied idempotency key, so a retried batch writes once. */
    id: z.string().min(8).max(64),
    occurredAt: z.string().datetime(),
    productId: shopifyId.optional(),
    variantId: shopifyId.optional(),
    meta: metaSchema.optional(),
  })
  .strict();

export const eventBatchSchema = z
  .object({
    token: z.string().min(16).max(512),
    /** Random, browser-generated. Never a customer identifier. */
    sessionId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
    events: z.array(clientEventSchema).min(1).max(50),
  })
  .strict();

/**
 * Purchases reported by the Web Pixel.
 *
 * The amount is reported by the browser, not verified against Shopify: reading
 * an order server-side would need the `read_orders` scope, which the product
 * deliberately does not request yet. It is deduplicated by order id, so a
 * purchase can be counted at most once per shop, and every consumer of this
 * number must present it as pixel-reported.
 */
export const purchaseReportSchema = z
  .object({
    token: z.string().min(16).max(512),
    sessionId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
    orderId: shopifyId,
    amount: z.number().nonnegative().max(1_000_000).optional(),
    currency: z.string().length(3).optional(),
    variantIds: z.array(shopifyId).max(200).default([]),
    occurredAt: z.string().datetime(),
  })
  .strict();

export type ClientEvent = z.infer<typeof clientEventSchema>;
export type EventBatch = z.infer<typeof eventBatchSchema>;
export type PurchaseReport = z.infer<typeof purchaseReportSchema>;

/** Fields that must never reach us. Rejected loudly rather than dropped quietly. */
export const FORBIDDEN_FIELDS = [
  'email',
  'customerId',
  'customer_id',
  'phone',
  'name',
  'ip',
  'userAgent',
  'user_agent',
  'address',
] as const;

export function containsForbiddenField(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const seen = new Set<string>();
  const walk = (node: unknown, depth: number): string | null => {
    if (depth > 4 || !node || typeof node !== 'object') return null;
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const normalised = key.toLowerCase();
      if ((FORBIDDEN_FIELDS as readonly string[]).some((f) => f.toLowerCase() === normalised)) return key;
      if (typeof child === 'object' && child !== null && !seen.has(key)) {
        seen.add(key);
        const found = walk(child, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(value, 0);
}
