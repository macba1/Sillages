import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';
import { shopifyGraphQL } from '../lib/shopify.js';
import { AppError } from '../middleware/errorHandler.js';

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
// Approve an action. For discount_code and seo_fix, execute immediately on Shopify.
router.put('/:id/approve', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accountId = req.accountId!;
    const actionId = req.params.id;

    // Fetch the action
    const { data: action, error: fetchError } = await supabase
      .from('pending_actions')
      .select('*')
      .eq('id', actionId)
      .eq('account_id', accountId)
      .single();

    if (fetchError || !action) throw new AppError(404, 'Action not found');
    if (action.status !== 'pending') throw new AppError(400, `Action is already ${action.status}`);

    const actionType = action.type;
    const content = action.content ?? {};

    // ── Auto-executable actions ───────────────────────────────────────────
    if (actionType === 'discount_code') {
      await executeDiscount(accountId, actionId, content);
      const { data: updated } = await supabase.from('pending_actions').select('*').eq('id', actionId).single();
      res.json({ action: updated, executed: true });
      return;
    }

    if (actionType === 'seo_fix') {
      await executeSeoFix(accountId, actionId, content);
      const { data: updated } = await supabase.from('pending_actions').select('*').eq('id', actionId).single();
      res.json({ action: updated, executed: true });
      return;
    }

    // ── Manual actions (approve only) ─────────────────────────────────────
    const { error: updateError } = await supabase
      .from('pending_actions')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),

      })
      .eq('id', actionId);

    if (updateError) throw new AppError(500, `Failed to approve: ${updateError.message}`);

    const { data: updated } = await supabase.from('pending_actions').select('*').eq('id', actionId).single();

    res.json({
      action: updated,
      executed: false,
      message: 'Acción aprobada. La ejecución automática estará disponible pronto.',
    });
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
