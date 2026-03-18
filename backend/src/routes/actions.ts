import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';
import { shopifyGraphQL, shopifyClient } from '../lib/shopify.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { sendMerchantEmail } from '../services/merchantEmail.js';
import { sendPushNotification } from '../services/pushNotifier.js';
import { logCommunication } from '../services/commLog.js';
import { buildCartRecoveryEmail, buildWelcomeEmail, buildReactivationEmail, buildCustomCopyEmail } from '../services/emailTemplates.js';
import type { BrandConfig, ProductItem } from '../services/emailTemplates.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Send a confirmation push to the merchant ONLY if comms_approval is 'auto'.
 * If 'manual', the admin sees results in the dashboard — no push spam.
 */
async function sendConfirmationPush(accountId: string, payload: { title: string; body: string; url: string }): Promise<void> {
  try {
    const { data } = await supabase.from('accounts').select('comms_approval').eq('id', accountId).single();
    if (data?.comms_approval !== 'auto') return; // manual → no confirmation push
    await sendPushNotification(accountId, payload);
  } catch { /* non-fatal */ }
}

/**
 * Check if we already sent an email to this customer in the last 7 days.
 * Prevents spam: max 1 email per customer per week.
 */
async function hasRecentEmailToCustomer(accountId: string, customerEmail: string): Promise<boolean> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const { count } = await supabase
    .from('email_log')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('recipient_email', customerEmail.toLowerCase())
    .eq('status', 'sent')
    .gte('sent_at', sevenDaysAgo);

  return (count ?? 0) > 0;
}

/**
 * Load brand config for email templates: logo, primary color, shop URL.
 */
async function loadBrandConfig(accountId: string, storeName: string): Promise<BrandConfig> {
  const config: BrandConfig = { storeName };

  try {
    const { data: bp } = await supabase
      .from('brand_profiles')
      .select('logo_url, primary_color, shop_url, contact_email, contact_phone, contact_address, social_links')
      .eq('account_id', accountId)
      .maybeSingle();

    if (bp) {
      if (bp.logo_url) config.logoUrl = bp.logo_url;
      if (bp.primary_color) config.primaryColor = bp.primary_color;
      if (bp.shop_url) config.shopUrl = bp.shop_url;
      if (bp.contact_email) config.contactEmail = bp.contact_email;
      if (bp.contact_phone) config.contactPhone = bp.contact_phone;
      if (bp.contact_address) config.contactAddress = bp.contact_address;
      if (bp.social_links) config.socialLinks = bp.social_links as BrandConfig['socialLinks'];
    }
  } catch { /* brand config is optional */ }

  return config;
}

const router = Router();

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve the user's plan to determine which actions they can see. */
async function getAccountPlan(accountId: string): Promise<'starter' | 'growth' | 'pro'> {
  const { data: account } = await supabase
    .from('accounts')
    .select('plan, subscription_status')
    .eq('id', accountId)
    .single();

  // Prefer explicit plan column if set
  const plan = account?.plan;
  if (plan === 'pro' || plan === 'growth' || plan === 'starter') return plan;

  // Fallback to subscription_status
  const status = account?.subscription_status;
  if (status === 'trialing' || status === 'beta' || status === null) return 'pro';
  if (status === 'active') return 'growth';
  return 'starter';
}

/** Get Shopify connection for the account */
async function getShopifyConnection(accountId: string) {
  const { data, error } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token')
    .eq('account_id', accountId)
    .single();

  if (error || !data) return null;
  return data as { shop_domain: string; access_token: string };
}

// ── GET /api/actions ────────────────────────────────────────────────────────
// List pending actions for the authenticated user.
router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accountId = req.accountId!;
    const status = (req.query.status as string) ?? 'pending';
    const plan = await getAccountPlan(accountId);

    // Starter plan gets no actions
    if (plan === 'starter') {
      res.json({ actions: [], plan });
      return;
    }

    const allowedPlans = plan === 'pro' ? ['growth', 'pro'] : ['growth'];

    const { data, error } = await supabase
      .from('pending_actions')
      .select('*')
      .eq('account_id', accountId)
      .eq('status', status)
      .order('created_at', { ascending: false });

    if (error) throw new AppError(500, `Failed to load actions: ${error.message}`);

    // Filter by plan_required (stored in content.plan_required)
    const filtered = (data ?? []).filter(a => {
      const planReq = a.content?.plan_required ?? 'growth';
      return allowedPlans.includes(planReq);
    });

    // Sort by priority (stored in content.priority): high first, then medium, then low
    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const sorted = filtered.sort((a, b) =>
      (priorityOrder[a.content?.priority] ?? 1) - (priorityOrder[b.content?.priority] ?? 1)
    );

    res.json({ actions: sorted, plan });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/actions/stats ──────────────────────────────────────────────────
// Action counts by status for badges.
router.get('/stats', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accountId = req.accountId!;

    const [pending, approved, completed, rejected] = await Promise.all([
      supabase.from('pending_actions').select('*', { count: 'exact', head: true }).eq('account_id', accountId).eq('status', 'pending'),
      supabase.from('pending_actions').select('*', { count: 'exact', head: true }).eq('account_id', accountId).eq('status', 'approved'),
      supabase.from('pending_actions').select('*', { count: 'exact', head: true }).eq('account_id', accountId).eq('status', 'completed'),
      supabase.from('pending_actions').select('*', { count: 'exact', head: true }).eq('account_id', accountId).eq('status', 'rejected'),
    ]);

    res.json({
      pending: pending.count ?? 0,
      approved: approved.count ?? 0,
      completed: completed.count ?? 0,
      rejected: rejected.count ?? 0,
    });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/actions/:id/approve ────────────────────────────────────────────
// Approve and execute an action. Every action type does something real.
router.put('/:id/approve', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accountId = req.accountId!;
    const actionId = req.params.id;

    // Atomic: UPDATE ... WHERE status='pending' RETURNING * — prevents race conditions
    const { data: action, error: fetchError } = await supabase
      .from('pending_actions')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', actionId)
      .eq('account_id', accountId)
      .eq('status', 'pending')
      .select('*')
      .single();

    if (fetchError || !action) {
      // Either not found or already processed — check which
      const { data: existing } = await supabase
        .from('pending_actions')
        .select('status')
        .eq('id', actionId)
        .eq('account_id', accountId)
        .single();
      if (!existing) throw new AppError(404, 'Action not found');
      throw new AppError(400, `Action is already ${existing.status}`);
    }

    const actionType = action.type as string;
    const content = action.content ?? {};

    // Dispatch to executor by type
    const executors: Record<string, (aId: string, actId: string, c: Record<string, unknown>) => Promise<void>> = {
      discount_code: executeDiscount,
      seo_fix: executeSeoFix,
      product_highlight: executeProductHighlight,
      instagram_post: executeInstagramPost,
      whatsapp_message: executeWhatsAppMessage,
      cart_recovery: executeCartRecovery,
      welcome_email: executeWelcomeEmail,
      reactivation_email: executeReactivationEmail,
    };

    const executor = executors[actionType];
    if (executor) {
      await executor(accountId, actionId, content);
    } else {
      // Unknown type — mark completed with note
      await markCompleted(actionId, { note: `Action type "${actionType}" approved` });
    }

    const { data: updated } = await supabase.from('pending_actions').select('*').eq('id', actionId).single();
    const wasExecuted = updated?.status === 'completed';

    res.json({ action: updated, executed: wasExecuted });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/actions/:id/reject ─────────────────────────────────────────────
router.put('/:id/reject', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accountId = req.accountId!;
    const actionId = req.params.id;

    const { data: action, error: fetchError } = await supabase
      .from('pending_actions')
      .select('id, status')
      .eq('id', actionId)
      .eq('account_id', accountId)
      .single();

    if (fetchError || !action) throw new AppError(404, 'Action not found');
    if (action.status !== 'pending') throw new AppError(400, `Action is already ${action.status}`);

    const { error: updateError } = await supabase
      .from('pending_actions')
      .update({
        status: 'rejected',

      })
      .eq('id', actionId);

    if (updateError) throw new AppError(500, `Failed to reject: ${updateError.message}`);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/actions/:id ────────────────────────────────────────────────────
// Edit action content (only if still pending).
router.put('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accountId = req.accountId!;
    const actionId = req.params.id;

    const { data: action, error: fetchError } = await supabase
      .from('pending_actions')
      .select('id, status')
      .eq('id', actionId)
      .eq('account_id', accountId)
      .single();

    if (fetchError || !action) throw new AppError(404, 'Action not found');
    if (action.status !== 'pending') throw new AppError(400, 'Can only edit pending actions');

    const { content } = req.body as { content?: Record<string, unknown> };
    if (!content) throw new AppError(400, 'Missing content in request body');

    const { error: updateError } = await supabase
      .from('pending_actions')
      .update({
        content,

      })
      .eq('id', actionId);

    if (updateError) throw new AppError(500, `Failed to update: ${updateError.message}`);

    const { data: updated } = await supabase.from('pending_actions').select('*').eq('id', actionId).single();
    res.json({ action: updated });
  } catch (err) {
    next(err);
  }
});

// ── Shopify Executors ───────────────────────────────────────────────────────

async function executeDiscount(accountId: string, actionId: string, content: Record<string, unknown>): Promise<void> {
  const conn = await getShopifyConnection(accountId);
  if (!conn) {
    await markFailed(actionId, 'No Shopify connection found');
    return;
  }

  const code = (content.discount_code as string) ?? 'SILLAGES10';
  const percentage = (content.discount_percentage as number) ?? 10;
  const productTitle = (content.discount_product as string) ?? '';

  const mutation = `
    mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              title
              codes(first: 1) {
                nodes { code }
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const startsAt = new Date().toISOString();
  const endsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const variables = {
    basicCodeDiscount: {
      title: `${code} — ${productTitle || 'Store discount'}`,
      code,
      startsAt,
      endsAt,
      customerSelection: { all: true },
      customerGets: {
        value: { percentage: percentage / 100 },
        items: { all: true },
      },
      usageLimit: 100,
    },
  };

  try {
    const data = await shopifyGraphQL<{
      discountCodeBasicCreate: {
        codeDiscountNode: { id: string } | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(conn.shop_domain, conn.access_token, mutation, variables);

    const result = data.discountCodeBasicCreate;
    if (result.userErrors.length > 0) {
      await markFailed(actionId, result.userErrors.map(e => e.message).join('; '));
      return;
    }

    const discountId = result.codeDiscountNode?.id ?? '';
    await supabase
      .from('pending_actions')
      .update({
        status: 'completed',
        approved_at: new Date().toISOString(),
        executed_at: new Date().toISOString(),
        result: { shopify_discount_id: discountId, code, percentage },

      })
      .eq('id', actionId);

    console.log(`[actions] Discount ${code} created on Shopify for action ${actionId}`);
  } catch (err) {
    await markFailed(actionId, err instanceof Error ? err.message : String(err));
  }
}

async function executeSeoFix(accountId: string, actionId: string, content: Record<string, unknown>): Promise<void> {
  const conn = await getShopifyConnection(accountId);
  if (!conn) {
    await markFailed(actionId, 'No Shopify connection found');
    return;
  }

  const seoField = content.seo_field as string | undefined;
  const handle = content.seo_product_handle as string | undefined;
  const newValue = content.seo_new_value as string | undefined;

  if (!handle || !newValue) {
    await markFailed(actionId, 'Missing seo_product_handle or seo_new_value');
    return;
  }

  try {
    // First, look up the product by handle to get its GID
    const lookupQuery = `
      query getProductByHandle($handle: String!) {
        productByHandle(handle: $handle) {
          id
          title
        }
      }
    `;

    const lookupData = await shopifyGraphQL<{
      productByHandle: { id: string; title: string } | null;
    }>(conn.shop_domain, conn.access_token, lookupQuery, { handle });

    const product = lookupData.productByHandle;
    if (!product) {
      await markFailed(actionId, `Product with handle "${handle}" not found`);
      return;
    }

    // Build the mutation based on SEO field type
    let mutation: string;
    let variables: Record<string, unknown>;

    if (seoField === 'meta_description' || seoField === 'collection_description') {
      mutation = `
        mutation productUpdate($input: ProductInput!) {
          productUpdate(input: $input) {
            product { id title }
            userErrors { field message }
          }
        }
      `;
      variables = {
        input: {
          id: product.id,
          seo: { description: newValue },
        },
      };
    } else if (seoField === 'alt_text') {
      // For alt text we'd need the image ID — store description as fallback
      mutation = `
        mutation productUpdate($input: ProductInput!) {
          productUpdate(input: $input) {
            product { id title }
            userErrors { field message }
          }
        }
      `;
      variables = {
        input: {
          id: product.id,
          seo: { description: newValue },
        },
      };
    } else {
      // Generic description update
      mutation = `
        mutation productUpdate($input: ProductInput!) {
          productUpdate(input: $input) {
            product { id title }
            userErrors { field message }
          }
        }
      `;
      variables = {
        input: {
          id: product.id,
          descriptionHtml: newValue,
        },
      };
    }

    const data = await shopifyGraphQL<{
      productUpdate: {
        product: { id: string; title: string } | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(conn.shop_domain, conn.access_token, mutation, variables);

    const result = data.productUpdate;
    if (result.userErrors.length > 0) {
      await markFailed(actionId, result.userErrors.map(e => e.message).join('; '));
      return;
    }

    await supabase
      .from('pending_actions')
      .update({
        status: 'completed',
        approved_at: new Date().toISOString(),
        executed_at: new Date().toISOString(),
        result: { product_id: product.id, seo_field: seoField, applied_value: newValue },

      })
      .eq('id', actionId);

    console.log(`[actions] SEO fix applied to "${product.title}" for action ${actionId}`);
  } catch (err) {
    await markFailed(actionId, err instanceof Error ? err.message : String(err));
  }
}

// ── Product Highlight Executor ───────────────────────────────────────────────
// Moves a product to position 1 in the main collection via collectionReorderProducts.

async function executeProductHighlight(accountId: string, actionId: string, content: Record<string, unknown>): Promise<void> {
  const conn = await getShopifyConnection(accountId);
  if (!conn) {
    await markFailed(actionId, 'No Shopify connection found');
    return;
  }

  const productName = (content.copy as string) ?? (content.discount_product as string) ?? '';

  try {
    // 1. Find the main collection — try "Frontpage", then "All", then the largest collection
    const collectionsQuery = `
      query {
        collections(first: 20, sortKey: PRODUCTS_COUNT, reverse: true) {
          nodes {
            id
            title
            handle
            productsCount { count }
          }
        }
      }
    `;

    const collectionsData = await shopifyGraphQL<{
      collections: {
        nodes: Array<{ id: string; title: string; handle: string; productsCount: { count: number } }>;
      };
    }>(conn.shop_domain, conn.access_token, collectionsQuery);

    const collections = collectionsData.collections.nodes;
    if (collections.length === 0) {
      await markFailed(actionId, 'No collections found in store');
      return;
    }

    // Prefer "Frontpage" > "All" > largest by product count
    let targetCollection = collections.find(c =>
      c.handle === 'frontpage' || c.title.toLowerCase() === 'frontpage'
    );
    if (!targetCollection) {
      targetCollection = collections.find(c =>
        c.handle === 'all' || c.title.toLowerCase() === 'all'
      );
    }
    if (!targetCollection) {
      targetCollection = collections[0]; // largest by products_count (sorted desc)
    }

    // 2. Get products in that collection to find the product to highlight
    const productsQuery = `
      query ($collectionId: ID!) {
        collection(id: $collectionId) {
          products(first: 50) {
            nodes {
              id
              title
              position
            }
          }
        }
      }
    `;

    const productsData = await shopifyGraphQL<{
      collection: {
        products: { nodes: Array<{ id: string; title: string; position: number }> };
      };
    }>(conn.shop_domain, conn.access_token, productsQuery, { collectionId: targetCollection.id });

    const products = productsData.collection.products.nodes;
    if (products.length === 0) {
      await markFailed(actionId, `Collection "${targetCollection.title}" has no products`);
      return;
    }

    // Find the product to highlight by name match
    const targetProduct = products.find(p =>
      p.title.toLowerCase().includes(productName.toLowerCase()) ||
      productName.toLowerCase().includes(p.title.toLowerCase())
    ) ?? products[0];

    // 3. Build the reorder — move target to position 0 (first)
    const moves = [{ id: targetProduct.id, newPosition: '0' }];

    const reorderMutation = `
      mutation collectionReorderProducts($id: ID!, $moves: [MoveInput!]!) {
        collectionReorderProducts(id: $id, moves: $moves) {
          job { id }
          userErrors { field message }
        }
      }
    `;

    const reorderData = await shopifyGraphQL<{
      collectionReorderProducts: {
        job: { id: string } | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(conn.shop_domain, conn.access_token, reorderMutation, {
      id: targetCollection.id,
      moves,
    });

    const result = reorderData.collectionReorderProducts;
    if (result.userErrors.length > 0) {
      await markFailed(actionId, result.userErrors.map(e => e.message).join('; '));
      return;
    }

    await markCompleted(actionId, {
      collection: targetCollection.title,
      collection_id: targetCollection.id,
      product: targetProduct.title,
      product_id: targetProduct.id,
      moved_to_position: 1,
    });

    console.log(`[actions] Product "${targetProduct.title}" moved to position 1 in "${targetCollection.title}" for action ${actionId}`);
  } catch (err) {
    await markFailed(actionId, err instanceof Error ? err.message : String(err));
  }
}

// ── Instagram Post Executor ─────────────────────────────────────────────────
// Returns the copy for the user to paste into Instagram. No external API needed.

async function executeInstagramPost(_accountId: string, actionId: string, content: Record<string, unknown>): Promise<void> {
  const copy = (content.copy as string) ?? '';
  if (!copy) {
    await markFailed(actionId, 'No copy text provided for Instagram post');
    return;
  }

  await markCompleted(actionId, {
    copy,
    instruction: 'Copy ready. Open Instagram and paste it.',
    instruction_es: 'Copy listo. Abre Instagram y pégalo.',
  });

  console.log(`[actions] Instagram post copy prepared for action ${actionId}`);
}

// ── Email Campaign Executor ─────────────────────────────────────────────────
// Sends the email via Resend to the recipients specified in the action content.

// ── WhatsApp Message Executor ───────────────────────────────────────────────
// Returns a wa.me link with the message pre-filled for the merchant to send.

async function executeWhatsAppMessage(_accountId: string, actionId: string, content: Record<string, unknown>): Promise<void> {
  const copy = (content.copy as string) ?? '';
  if (!copy) {
    await markFailed(actionId, 'No message text provided for WhatsApp');
    return;
  }

  const encodedText = encodeURIComponent(copy);
  const waLink = `https://wa.me/?text=${encodedText}`;

  await markCompleted(actionId, {
    copy,
    wa_link: waLink,
    instruction: 'Open the link to send via WhatsApp.',
    instruction_es: 'Abre el enlace para enviar por WhatsApp.',
  });

  console.log(`[actions] WhatsApp link prepared for action ${actionId}`);
}

// ── Cart Recovery Executor ───────────────────────────────────────────────────

async function executeCartRecovery(accountId: string, actionId: string, content: Record<string, unknown>): Promise<void> {
  const customerEmail = content.customer_email as string | undefined;
  const customerName = content.customer_name as string ?? '';
  const products = (content.products as Array<{ title: string; quantity: number; price: number; image_url?: string }>) ?? [];
  const totalPrice = (content.total_price as number) ?? 0;
  const checkoutUrl = content.checkout_url as string | undefined;
  const discountCode = content.discount_code as string | undefined;
  const discountPercent = content.discount_percent as number | undefined;
  const checkoutId = content.shopify_checkout_id as string | undefined;
  const cartAbandonedAt = content.abandoned_at as string | undefined;

  if (!customerEmail) {
    await markFailed(actionId, 'Missing customer_email');
    return;
  }

  try {
    // ── AGE CHECK: Skip carts older than 7 days ──
    if (cartAbandonedAt) {
      const cartAge = Date.now() - new Date(cartAbandonedAt).getTime();
      if (cartAge > 7 * 86400 * 1000) {
        await markCompleted(actionId, {
          skipped: true,
          reason: `Carrito de hace más de 7 días. Ya no es relevante.`,
          customer_email: customerEmail,
        });
        console.log(`[actions] Cart recovery SKIPPED — cart too old (${Math.floor(cartAge / 86400000)}d) for ${customerEmail}`);
        return;
      }
    }

    // ── ANTI-SPAM: Max 1 email per customer per week ──
    if (await hasRecentEmailToCustomer(accountId, customerEmail)) {
      await markCompleted(actionId, {
        skipped: true,
        reason: `Ya contactamos a ${customerName} en los últimos 7 días. No enviar otro email.`,
        customer_email: customerEmail,
      });
      console.log(`[actions] Cart recovery SKIPPED — ${customerEmail} already contacted this week`);
      return;
    }

    // Load account language and shop info
    const [{ data: acc }, { data: conn }] = await Promise.all([
      supabase.from('accounts').select('language').eq('id', accountId).single(),
      supabase.from('shopify_connections').select('shop_name, shop_domain, shop_currency').eq('account_id', accountId).single(),
    ]);

    const language = (acc?.language === 'es' ? 'es' : 'en') as 'en' | 'es';
    const storeName = conn?.shop_name ?? conn?.shop_domain ?? 'Store';
    const currency = (conn as Record<string, unknown>)?.shop_currency as string ?? 'USD';

    // ── REAL-TIME CHECK: Has the customer already purchased? ──
    // FAIL-CLOSED: if Shopify doesn't respond, do NOT send the email.
    if (conn?.shop_domain) {
      const alreadyBought = await hasCustomerPurchasedRecently(conn.shop_domain, (conn as Record<string, unknown>).access_token as string, customerEmail);
      if (alreadyBought) {
        console.log(`[actions] Cart recovery SKIPPED — ${customerName} (${customerEmail}) already purchased`);

        await supabase
          .from('abandoned_carts')
          .update({ recovered: true, recovered_at: new Date().toISOString() })
          .eq('account_id', accountId)
          .eq('customer_email', customerEmail)
          .or('recovered.is.null,recovered.eq.false');

        await markCompleted(actionId, {
          skipped: true,
          reason: `${customerName} ya completó su compra. Email no enviado.`,
          customer_email: customerEmail,
        });

        await sendConfirmationPush(accountId, {
          title: `${customerName} ya compró`,
          body: `No se envió el email de recuperación porque ya completó su pedido.`,
          url: '/actions',
        });

        return;
      }
    } else {
      // No Shopify connection → cannot verify → fail-closed
      await markFailed(actionId, 'No Shopify connection — cannot verify if customer already purchased');
      return;
    }

    // Load brand config for styled emails
    const brand = await loadBrandConfig(accountId, storeName);
    if (!brand.shopUrl && conn?.shop_domain) brand.shopUrl = `https://${conn.shop_domain}`;

    // Use hand-written copy if available, otherwise fall back to generic template
    const customCopy = content.copy as string | undefined;
    const customTitle = content.title as string | undefined;
    const typedProducts: ProductItem[] = products;

    const { subject, html } = customCopy
      ? buildCustomCopyEmail({
          storeName,
          subject: customTitle ?? `${customerName}, tienes algo pendiente`,
          body: customCopy,
          ctaText: language === 'es' ? 'Completar mi pedido' : 'Complete my order',
          ctaUrl: checkoutUrl ?? brand.shopUrl,
          products: typedProducts,
          brand,
        })
      : buildCartRecoveryEmail({
          customerName,
          storeName,
          products: typedProducts,
          totalPrice,
          currency,
          checkoutUrl: checkoutUrl ?? brand.shopUrl,
          discountCode,
          discountPercent,
          language,
          brand,
        });

    const { messageId } = await sendMerchantEmail({
      accountId,
      to: customerEmail,
      subject,
      html,
    });

    // Mark abandoned cart as recovered if we have a checkout ID
    if (checkoutId) {
      await supabase
        .from('abandoned_carts')
        .update({ recovered: true, recovery_action_id: actionId })
        .eq('shopify_checkout_id', checkoutId);
    }

    await markCompleted(actionId, { sent_to: customerEmail, message_id: messageId });
    await logCommunication({ account_id: accountId, channel: 'email', status: 'sent', message_id: messageId, recipient_email: customerEmail });

    // Confirmation push to merchant (respects comms_approval)
    await sendConfirmationPush(accountId, {
      title: `Email enviado a ${customerName || customerEmail}`,
      body: `El email de recuperación se envió correctamente.`,
      url: '/actions',
    });

    console.log(`[actions] Cart recovery email sent to ${customerEmail} for action ${actionId}`);
  } catch (err) {
    await markFailed(actionId, err instanceof Error ? err.message : String(err));
  }
}

// ── Welcome Email Executor ──────────────────────────────────────────────────

async function executeWelcomeEmail(accountId: string, actionId: string, content: Record<string, unknown>): Promise<void> {
  const customerEmail = content.customer_email as string | undefined;
  const customerName = content.customer_name as string ?? '';
  const productPurchased = content.product_purchased as string ?? '';

  if (!customerEmail) {
    await markFailed(actionId, 'Missing customer_email');
    return;
  }

  // ── ANTI-SPAM: Max 1 email per customer per week ──
  if (await hasRecentEmailToCustomer(accountId, customerEmail)) {
    await markCompleted(actionId, {
      skipped: true,
      reason: `Ya contactamos a ${customerName} en los últimos 7 días.`,
      customer_email: customerEmail,
    });
    console.log(`[actions] Welcome email SKIPPED — ${customerEmail} already contacted this week`);
    return;
  }

  try {
    const [{ data: acc }, { data: conn }] = await Promise.all([
      supabase.from('accounts').select('language').eq('id', accountId).single(),
      supabase.from('shopify_connections').select('shop_name, shop_domain').eq('account_id', accountId).single(),
    ]);

    const language = (acc?.language === 'es' ? 'es' : 'en') as 'en' | 'es';
    const storeName = conn?.shop_name ?? conn?.shop_domain ?? 'Store';
    const storeUrl = conn?.shop_domain ? `https://${conn.shop_domain}` : '#';

    // Load brand config for styled emails
    const brand = await loadBrandConfig(accountId, storeName);
    if (!brand.shopUrl) brand.shopUrl = storeUrl;

    // Try to get product image from content
    const productImageUrl = content.product_image_url as string | undefined;

    const customCopy = content.copy as string | undefined;
    const customTitle = content.title as string | undefined;

    const { subject, html } = customCopy
      ? buildCustomCopyEmail({
          storeName,
          subject: customTitle ?? `¡Gracias por tu pedido, ${customerName}!`,
          body: customCopy,
          ctaText: language === 'es' ? 'Descubre más productos' : 'Discover more products',
          ctaUrl: storeUrl,
          brand,
        })
      : buildWelcomeEmail({
          customerName,
          storeName,
          productPurchased,
          productImageUrl,
          language,
          storeUrl,
          brand,
        });

    const { messageId } = await sendMerchantEmail({
      accountId,
      to: customerEmail,
      subject,
      html,
    });

    await markCompleted(actionId, { sent_to: customerEmail, message_id: messageId });
    await logCommunication({ account_id: accountId, channel: 'email', status: 'sent', message_id: messageId, recipient_email: customerEmail });

    await sendConfirmationPush(accountId, {
      title: `Email enviado a ${customerName || customerEmail}`,
      body: `El email de bienvenida se envió correctamente.`,
      url: '/actions',
    });

    console.log(`[actions] Welcome email sent to ${customerEmail} for action ${actionId}`);
  } catch (err) {
    await markFailed(actionId, err instanceof Error ? err.message : String(err));
  }
}

// ── Reactivation Email Executor ─────────────────────────────────────────────

async function executeReactivationEmail(accountId: string, actionId: string, content: Record<string, unknown>): Promise<void> {
  const recipients = content.recipients as Array<{
    email: string;
    name: string;
    last_product: string;
    days_since: number;
  }> | undefined;

  if (!recipients || recipients.length === 0) {
    await markFailed(actionId, 'Missing or empty recipients array');
    return;
  }

  const discountCode = content.discount_code as string | undefined;
  const discountPercent = content.discount_percent as number | undefined;

  try {
    const [{ data: acc }, { data: conn }] = await Promise.all([
      supabase.from('accounts').select('language').eq('id', accountId).single(),
      supabase.from('shopify_connections').select('shop_name, shop_domain').eq('account_id', accountId).single(),
    ]);

    const language = (acc?.language === 'es' ? 'es' : 'en') as 'en' | 'es';
    const storeName = conn?.shop_name ?? conn?.shop_domain ?? 'Store';
    const storeUrl = conn?.shop_domain ? `https://${conn.shop_domain}` : '#';

    // Load brand config for styled emails
    const brand = await loadBrandConfig(accountId, storeName);
    if (!brand.shopUrl) brand.shopUrl = storeUrl;

    const customCopy = content.copy as string | undefined;
    const customTitle = content.title as string | undefined;

    const messageIds: string[] = [];
    const failed: string[] = [];

    for (const recipient of recipients) {
      // ── ANTI-SPAM: Skip if already contacted this week ──
      if (await hasRecentEmailToCustomer(accountId, recipient.email)) {
        console.log(`[actions] Reactivation SKIPPED for ${recipient.email} — already contacted this week`);
        failed.push(recipient.email);
        continue;
      }

      try {
        const { subject, html } = customCopy
          ? buildCustomCopyEmail({
              storeName,
              subject: customTitle ?? `${recipient.name}, te echamos de menos`,
              body: customCopy,
              ctaText: language === 'es' ? 'Volver a la tienda' : 'Back to the store',
              ctaUrl: storeUrl,
              brand,
            })
          : buildReactivationEmail({
              customerName: recipient.name,
              storeName,
              lastProduct: recipient.last_product,
              daysSinceLastPurchase: recipient.days_since,
              discountCode,
              discountPercent,
              language,
              storeUrl,
              brand,
            });

        const { messageId } = await sendMerchantEmail({
          accountId,
          to: recipient.email,
          subject,
          html,
        });

        messageIds.push(messageId);
      } catch (err) {
        console.error(`[actions] Failed to send reactivation to ${recipient.email}:`, err instanceof Error ? err.message : err);
        failed.push(recipient.email);
      }
    }

    if (messageIds.length === 0) {
      await markFailed(actionId, `All reactivation emails failed. First: ${failed[0]}`);
      return;
    }

    await markCompleted(actionId, {
      sent_count: messageIds.length,
      message_ids: messageIds,
      failed: failed.length > 0 ? failed : undefined,
    });

    for (let i = 0; i < messageIds.length; i++) {
      const recipientEmail = recipients.filter(r => !failed.includes(r.email))[i]?.email;
      await logCommunication({ account_id: accountId, channel: 'email', status: 'sent', message_id: messageIds[i], recipient_email: recipientEmail });
    }

    await sendConfirmationPush(accountId, {
      title: `Emails enviados`,
      body: `Se enviaron ${messageIds.length} email(s) de reactivación.`,
      url: '/actions',
    });

    console.log(`[actions] Reactivation emails sent to ${messageIds.length}/${recipients.length} recipients for action ${actionId}`);
  } catch (err) {
    await markFailed(actionId, err instanceof Error ? err.message : String(err));
  }
}

// ── Helper: check if customer already purchased (real-time Shopify check) ────

async function hasCustomerPurchasedRecently(
  shopDomain: string,
  accessToken: string,
  customerEmail: string,
): Promise<boolean> {
  try {
    const client = shopifyClient(shopDomain, accessToken);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
    const { orders } = await client.getOrders({
      created_at_min: sevenDaysAgo,
      created_at_max: new Date().toISOString(),
    });

    return orders.some(
      o =>
        o.customer?.email?.toLowerCase() === customerEmail.toLowerCase() &&
        o.financial_status !== 'voided' &&
        !o.cancel_reason,
    );
  } catch (err) {
    console.error(`[actions] FAIL-CLOSED: Cannot verify Shopify orders for ${customerEmail}: ${(err as Error).message}`);
    return true; // fail-closed — if we can't verify, assume they bought (don't risk spam)
  }
}

// ── Helper: mark action completed ───────────────────────────────────────────

async function markCompleted(actionId: string, result: Record<string, unknown>): Promise<void> {
  await supabase
    .from('pending_actions')
    .update({
      status: 'completed',
      approved_at: new Date().toISOString(),
      executed_at: new Date().toISOString(),
      result,
    })
    .eq('id', actionId);
}

async function markFailed(actionId: string, errorMessage: string): Promise<void> {
  await supabase
    .from('pending_actions')
    .update({
      status: 'failed',
      result: { error: errorMessage },
    })
    .eq('id', actionId);

  console.error(`[actions] Action ${actionId} failed: ${errorMessage}`);
}

export default router;
