import { supabase } from '../lib/supabase.js';
import { shopifyClient, getAllShopifyCredentials, resolveShopifyCredentials } from '../lib/shopify.js';
import { env } from '../config/env.js';
import { generateEventAction } from './eventActionGenerator.js';
import { gatePush } from './commsGate.js';
import type { DetectedEvent, NewFirstBuyerData, AbandonedCartData } from './eventDetector.js';

const LOG = '[shopifyWebhook]';

// ── Webhook topics we register ──────────────────────────────────────────────

const WEBHOOK_TOPICS = [
  'orders/create',
  'checkouts/create',
  'checkouts/update',
  'app/uninstalled',
] as const;

// ── Idempotency: check if webhook already processed ─────────────────────────

async function isWebhookProcessed(webhookId: string): Promise<boolean> {
  const { error } = await supabase
    .from('shopify_webhook_events')
    .insert({ webhook_id: webhookId, processed_at: new Date().toISOString() });

  if (error) {
    if (error.code === '23505') {
      // Unique constraint violation — already processed
      return true;
    }
    // Table might not exist — proceed anyway
    console.warn(`${LOG} webhook_events insert error (proceeding): ${error.message}`);
    return false;
  }
  return false;
}

// ── Register webhooks for a shop ────────────────────────────────────────────

export async function registerShopifyWebhooks(
  shopDomain: string,
  accessToken: string,
): Promise<{ registered: string[]; failed: string[] }> {
  const client = shopifyClient(shopDomain, accessToken);
  const baseUrl = `${env.SHOPIFY_APP_URL}/api/webhooks/shopify`;
  const registered: string[] = [];
  const failed: string[] = [];

  for (const topic of WEBHOOK_TOPICS) {
    try {
      await client.registerWebhook(topic, baseUrl);
      registered.push(topic);
      console.log(`${LOG} Registered ${topic} for ${shopDomain}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 422 = webhook already exists — that's fine
      if (message.includes('422') || message.includes('already')) {
        registered.push(topic);
        console.log(`${LOG} ${topic} already registered for ${shopDomain}`);
      } else {
        failed.push(topic);
        console.warn(`${LOG} Failed to register ${topic} for ${shopDomain}: ${message}`);
      }
    }
  }

  return { registered, failed };
}

// ── Verify and re-register missing webhooks for all active shops ────────────

export async function verifyAllWebhooks(): Promise<void> {
  const { data: connections } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token, account_id, token_status')
    .eq('token_status', 'active');

  if (!connections || connections.length === 0) {
    console.log(`${LOG} No active connections — skipping webhook verification`);
    return;
  }

  for (const conn of connections) {

    try {
      const client = shopifyClient(conn.shop_domain, conn.access_token);
      // List existing webhooks
      const existingTopics = await listWebhookTopics(client);
      const missing = WEBHOOK_TOPICS.filter(t => !existingTopics.includes(t));

      if (missing.length === 0) {
        console.log(`${LOG} All webhooks OK for ${conn.shop_domain}`);
        continue;
      }

      console.log(`${LOG} Missing webhooks for ${conn.shop_domain}: ${missing.join(', ')}`);
      const baseUrl = `${env.SHOPIFY_APP_URL}/api/webhooks/shopify`;
      for (const topic of missing) {
        try {
          await client.registerWebhook(topic, baseUrl);
          console.log(`${LOG} Re-registered ${topic} for ${conn.shop_domain}`);
        } catch (err) {
          console.warn(`${LOG} Failed to re-register ${topic} for ${conn.shop_domain}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      console.warn(`${LOG} Cannot verify webhooks for ${conn.shop_domain}: ${(err as Error).message}`);
    }
  }
}

async function listWebhookTopics(client: ReturnType<typeof shopifyClient>): Promise<string[]> {
  try {
    const webhooks = await client.listWebhooks();
    return webhooks.map(w => w.topic);
  } catch {
    return [];
  }
}

// ── Process incoming webhook ────────────────────────────────────────────────

export async function processShopifyWebhook(
  topic: string,
  shopDomain: string,
  webhookId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // Idempotency check
  if (await isWebhookProcessed(webhookId)) {
    console.log(`${LOG} Webhook ${webhookId} already processed — skipping`);
    return;
  }

  console.log(`${LOG} Processing ${topic} from ${shopDomain} (id=${webhookId})`);

  switch (topic) {
    case 'orders/create':
      await handleOrderCreated(shopDomain, payload);
      break;
    case 'checkouts/create':
      await handleCheckoutCreated(shopDomain, payload);
      break;
    case 'checkouts/update':
      await handleCheckoutUpdated(shopDomain, payload);
      break;
    case 'app/uninstalled':
      await handleAppUninstalled(shopDomain);
      break;
    default:
      console.log(`${LOG} Unhandled topic: ${topic}`);
  }
}

// ── orders/create ───────────────────────────────────────────────────────────

async function handleOrderCreated(shopDomain: string, payload: Record<string, unknown>): Promise<void> {
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('account_id, shop_name, shop_currency, access_token')
    .eq('shop_domain', shopDomain)
    .maybeSingle();

  if (!conn) {
    console.warn(`${LOG} No connection found for ${shopDomain}`);
    return;
  }

  const customer = payload.customer as Record<string, unknown> | null;
  if (!customer) {
    console.log(`${LOG} Order without customer — skipping`);
    return;
  }

  const email = (customer.email as string)?.toLowerCase();
  const firstName = customer.first_name as string | null;
  const lastName = customer.last_name as string | null;
  const ordersCount = customer.orders_count as number | undefined;
  const customerName = `${firstName ?? ''} ${lastName ?? ''}`.trim() || 'Cliente';

  // ── Check if first buyer ──
  if (ordersCount === 1 && email) {
    console.log(`${LOG} First buyer detected: ${customerName} (${email}) for ${shopDomain}`);

    const lineItems = payload.line_items as Array<Record<string, unknown>> | undefined;
    const productPurchased = lineItems?.[0]?.title as string ?? 'producto';
    const orderTotal = parseFloat(payload.total_price as string ?? '0');

    // Dedup via event_log
    const eventKey = `new_first_buyer:${email}:${payload.id}`;
    const { error: dedupError } = await supabase
      .from('event_log')
      .insert({
        account_id: conn.account_id,
        event_type: 'new_first_buyer',
        event_key: eventKey,
        event_data: { customer_name: customerName, customer_email: email, product_purchased: productPurchased, order_total: orderTotal },
        source: 'webhook',
      });

    if (dedupError?.code === '23505') {
      console.log(`${LOG} Event ${eventKey} already exists — skipping`);
      return;
    }

    // Load account metadata
    const { data: acc } = await supabase
      .from('accounts')
      .select('language')
      .eq('id', conn.account_id)
      .single();

    const lang: 'en' | 'es' = acc?.language === 'es' ? 'es' : 'en';
    const storeName = conn.shop_name ?? 'Tu tienda';
    const currency = conn.shop_currency ?? 'EUR';

    const event: DetectedEvent = {
      type: 'new_first_buyer',
      key: eventKey,
      data: {
        customer_name: customerName,
        customer_email: email,
        product_purchased: productPurchased,
        order_total: orderTotal,
        order_id: String(payload.id),
        order_created_at: payload.created_at as string ?? new Date().toISOString(),
      } satisfies NewFirstBuyerData,
    };

    const actionId = await generateEventAction(conn.account_id, event, lang, storeName, currency);
    if (actionId) {
      // No individual push — commsGate enforces max 1/day. Send grouped notification.
      try {
        await gatePush(conn.account_id, {
          title: storeName,
          body: 'Tienes una nueva acción lista para revisar.',
          url: '/actions',
        }, 'event_push');
        console.log(`${LOG} Grouped push queued for first buyer action`);
      } catch (err) {
        console.warn(`${LOG} Push failed: ${(err as Error).message}`);
      }
    }
  }

  // ── Check if customer had abandoned cart → mark as recovered ──
  if (email) {
    const { data: openCarts } = await supabase
      .from('abandoned_carts')
      .select('id, total_price')
      .eq('account_id', conn.account_id)
      .eq('customer_email', email)
      .or('recovered.is.null,recovered.eq.false');

    if (openCarts && openCarts.length > 0) {
      const { error: updateError } = await supabase
        .from('abandoned_carts')
        .update({
          recovered: true,
          recovered_at: new Date().toISOString(),
          recovery_attribution: 'organic',
        })
        .eq('account_id', conn.account_id)
        .eq('customer_email', email)
        .or('recovered.is.null,recovered.eq.false');

      if (!updateError) {
        console.log(`${LOG} Marked ${openCarts.length} cart(s) as recovered for ${email} (order webhook)`);
      }
    }
  }
}

// ── checkouts/create ────────────────────────────────────────────────────────

async function handleCheckoutCreated(shopDomain: string, payload: Record<string, unknown>): Promise<void> {
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('account_id, shop_currency')
    .eq('shop_domain', shopDomain)
    .maybeSingle();

  if (!conn) return;

  const customer = payload.customer as Record<string, unknown> | null;
  const email = (customer?.email as string)?.toLowerCase() ?? null;
  const firstName = customer?.first_name as string | null;
  const lastName = customer?.last_name as string | null;
  const customerName = `${firstName ?? ''} ${lastName ?? ''}`.trim() || 'Visitante';
  const phone = payload.phone as string | null ?? null;

  const lineItems = payload.line_items as Array<Record<string, unknown>> | undefined;
  if (!lineItems || lineItems.length === 0) return;

  const products = lineItems.map(li => ({
    title: li.title as string,
    quantity: li.quantity as number,
    price: parseFloat(li.price as string ?? '0'),
  }));

  const totalPrice = parseFloat(payload.total_price as string ?? '0');
  const currency = conn.shop_currency ?? 'USD';
  const checkoutUrl = payload.abandoned_checkout_url as string ?? null;

  // Upsert into abandoned_carts — will be checked by scheduler later
  // or by checkouts/update if completed
  const { error } = await supabase
    .from('abandoned_carts')
    .upsert({
      account_id: conn.account_id,
      shopify_checkout_id: String(payload.id),
      customer_name: customerName,
      customer_email: email,
      customer_phone: phone,
      products,
      total_price: totalPrice,
      currency,
      abandoned_at: payload.created_at as string ?? new Date().toISOString(),
      checkout_url: checkoutUrl,
    }, { onConflict: 'account_id,shopify_checkout_id' });

  if (error) {
    console.warn(`${LOG} Failed to upsert checkout ${payload.id}: ${error.message}`);
  } else {
    console.log(`${LOG} Saved checkout ${payload.id} for ${customerName} (${email ?? 'no email'})`);
  }
}

// ── checkouts/update ────────────────────────────────────────────────────────

async function handleCheckoutUpdated(shopDomain: string, payload: Record<string, unknown>): Promise<void> {
  // If checkout is completed, mark the cart as recovered
  const completedAt = payload.completed_at as string | null;
  if (!completedAt) {
    // Not completed yet — update cart data
    await handleCheckoutCreated(shopDomain, payload);
    return;
  }

  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('account_id')
    .eq('shop_domain', shopDomain)
    .maybeSingle();

  if (!conn) return;

  const { error } = await supabase
    .from('abandoned_carts')
    .update({
      recovered: true,
      recovered_at: completedAt,
      recovery_attribution: 'organic',
    })
    .eq('account_id', conn.account_id)
    .eq('shopify_checkout_id', String(payload.id));

  if (!error) {
    console.log(`${LOG} Checkout ${payload.id} completed — marked as recovered`);
  }
}

// ── app/uninstalled ─────────────────────────────────────────────────────────

async function handleAppUninstalled(shopDomain: string): Promise<void> {
  console.log(`${LOG} App uninstalled from ${shopDomain}`);

  // Mark token as invalid and disable sending
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('account_id')
    .eq('shop_domain', shopDomain)
    .maybeSingle();

  if (!conn) {
    console.log(`${LOG} No connection found for ${shopDomain} — nothing to clean up`);
    return;
  }

  const { error } = await supabase
    .from('shopify_connections')
    .update({
      token_status: 'invalid',
      sync_status: 'disabled',
    })
    .eq('shop_domain', shopDomain);

  if (error) {
    console.error(`${LOG} Failed to disable ${shopDomain}: ${error.message}`);
  } else {
    console.log(`${LOG} Disabled ${shopDomain} — token_status=invalid, sync_status=disabled`);
  }

  // Also disable sending in user_intelligence_config
  await supabase
    .from('user_intelligence_config')
    .update({ send_enabled: false })
    .eq('account_id', conn.account_id);

  // Alert admin
  try {
    const { resend } = await import('../lib/resend.js');
    await resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: 'tony@richmondpartner.com',
      subject: `[Sillages] App uninstalled: ${shopDomain}`,
      html: `<p>The merchant at <strong>${shopDomain}</strong> has uninstalled the Sillages app.</p>
             <p>Account ID: ${conn.account_id}</p>
             <p>Token and sending have been disabled automatically.</p>`,
    });
  } catch (err) {
    console.warn(`${LOG} Failed to send uninstall alert email: ${(err as Error).message}`);
  }
}
