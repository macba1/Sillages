import { supabase } from '../lib/supabase.js';
import { shopifyClient } from '../lib/shopify.js';
import type { ShopifyAbandonedCheckout } from '../lib/shopify.js';

const LOG = '[abandonedCartsSync]';

/**
 * Syncs abandoned carts from Shopify into the `abandoned_carts` table.
 * Fetches open (non-completed) checkouts and upserts them keyed on shopify_checkout_id.
 * Enriches products with image URLs from Shopify product catalog.
 */
export async function syncAbandonedCarts(accountId: string): Promise<void> {
  // Load connection
  const { data: conn, error: connError } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token')
    .eq('account_id', accountId)
    .single();

  if (connError || !conn) {
    console.log(`${LOG} No Shopify connection for account ${accountId} — skipping`);
    return;
  }

  const client = shopifyClient(conn.shop_domain, conn.access_token);

  // Fetch abandoned checkouts from the last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const now = new Date().toISOString();

  let checkouts: ShopifyAbandonedCheckout[];
  try {
    checkouts = await client.getAbandonedCheckouts({
      created_at_min: sevenDaysAgo,
      created_at_max: now,
      limit: 50,
    });
  } catch (err) {
    // Scope might not be available — fail gracefully
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${LOG} Could not fetch abandoned checkouts for ${conn.shop_domain} — scope may not be available: ${message}`);
    return;
  }

  if (checkouts.length === 0) {
    console.log(`${LOG} No abandoned checkouts found for ${conn.shop_domain}`);
    return;
  }

  // Filter to checkouts that have line items (skip empty carts)
  const validCheckouts = checkouts.filter(c => c.line_items && c.line_items.length > 0);

  // Build a product image map from Shopify catalog
  const imageMap = await buildProductImageMap(client);

  let upsertedCount = 0;

  for (const checkout of validCheckouts) {
    const customerName = checkout.customer
      ? `${checkout.customer.first_name ?? ''} ${checkout.customer.last_name ?? ''}`.trim() || 'Visitante'
      : 'Visitante';
    const customerEmail = checkout.customer?.email ?? null;
    const customerPhone = (checkout as unknown as Record<string, unknown>).phone as string | null ?? null;

    const products = checkout.line_items.map(li => ({
      title: li.title,
      quantity: li.quantity,
      price: parseFloat(li.price),
      image_url: (li.product_id ? imageMap.get(li.product_id) : undefined) ?? undefined,
    }));

    const totalPrice = parseFloat(checkout.total_price);
    const currency = (checkout as unknown as Record<string, unknown>).currency as string | undefined ?? 'USD';

    const row = {
      account_id: accountId,
      shopify_checkout_id: String(checkout.id),
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      products,
      total_price: totalPrice,
      currency,
      abandoned_at: checkout.created_at,
      checkout_url: checkout.abandoned_checkout_url ?? null,
    };

    const { error: upsertError } = await supabase
      .from('abandoned_carts')
      .upsert(row, { onConflict: 'account_id,shopify_checkout_id' });

    if (upsertError) {
      // Table might not exist yet — log and continue
      if (upsertError.message.includes('relation') || upsertError.message.includes('does not exist')) {
        console.warn(`${LOG} abandoned_carts table does not exist yet — skipping sync`);
        return;
      }
      console.warn(`${LOG} Failed to upsert checkout ${checkout.id}: ${upsertError.message}`);
    } else {
      upsertedCount++;
    }
  }

  console.log(`${LOG} Synced ${upsertedCount} abandoned carts for ${conn.shop_domain} (${validCheckouts.length} valid of ${checkouts.length} total)`);
}

/**
 * Fetches products from Shopify and builds a map of product_id → first image URL.
 * Used to enrich abandoned cart line items with product images.
 */
async function buildProductImageMap(client: ReturnType<typeof shopifyClient>): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    const products = await client.getProducts({ limit: 50, fields: 'id,images' });
    for (const p of products) {
      const id = p.id as number;
      const images = p.images as Array<{ src: string }> | undefined;
      if (images && images.length > 0 && images[0].src) {
        map.set(id, images[0].src);
      }
    }
  } catch (err) {
    console.warn(`${LOG} Could not fetch product images: ${(err as Error).message}`);
  }
  return map;
}
