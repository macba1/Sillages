import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  buildInstallUrl,
  generateState,
  validateHmac,
  validateShopDomain,
  exchangeCodeForToken,
  shopifyClient,
} from '../lib/shopify.js';
import { supabase } from '../lib/supabase.js';
import { requireAuth, resolveAuthToken } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';
import { syncYesterdayForAccount } from '../services/shopifySync.js';
import { generateBrief } from '../services/briefGenerator.js';

const router = Router();

// ── GET /api/shopify/auth ────────────────────────────────────────────────────
// Initiates OAuth flow. Requires the user to be authenticated with Sillages.
// Accepts the JWT from the Authorization header (AJAX) or ?token= query param
// (browser navigation, where custom headers cannot be set).
router.get('/auth', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const headerToken = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null;
    const token = headerToken ?? (req.query.token as string | undefined);

    if (!token) {
      throw new AppError(401, 'Missing authorization');
    }

    const { accountId } = await resolveAuthToken(token);

    const shop = req.query.shop as string;
    if (!shop || !validateShopDomain(shop)) {
      throw new AppError(400, 'Invalid or missing shop domain');
    }

    const state = generateState();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

    const { error: insertError } = await supabase
      .from('shopify_oauth_states')
      .insert({ state, account_id: accountId, expires_at: expiresAt });

    if (insertError) {
      throw new AppError(500, `Failed to store OAuth state: ${insertError.message}`);
    }

    const installUrl = buildInstallUrl(shop, state);
    res.redirect(installUrl);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/shopify/callback ────────────────────────────────────────────────
// Shopify redirects here after the merchant approves the app.
router.get(
  '/callback',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = req.query as Record<string, string>;
      const { shop, code, state, hmac } = query;

      // Validate shop domain
      if (!shop || !validateShopDomain(shop)) {
        throw new AppError(400, 'Invalid shop domain');
      }

      // Validate HMAC
      if (!hmac || !validateHmac(query)) {
        throw new AppError(400, 'Invalid HMAC signature');
      }

      // Validate state nonce — clean up expired rows first, then look up
      if (!state) {
        throw new AppError(400, 'Missing state parameter');
      }

      // Garbage-collect any expired states
      await supabase
        .from('shopify_oauth_states')
        .delete()
        .lt('expires_at', new Date().toISOString());

      // Look up and immediately delete the state (one-time use)
      const { data: stateRow, error: stateError } = await supabase
        .from('shopify_oauth_states')
        .select('account_id')
        .eq('state', state)
        .maybeSingle();

      if (stateError) {
        throw new AppError(500, `State lookup failed: ${stateError.message}`);
      }
      if (!stateRow) {
        throw new AppError(400, 'Invalid or expired state parameter — please try connecting again');
      }

      await supabase.from('shopify_oauth_states').delete().eq('state', state);

      const accountId = stateRow.account_id;

      // ── DEBUG ─────────────────────────────────────────────────────────────
      console.log(`[shopify/callback] shop=${shop} state=${state} accountId=${accountId}`);

      // Exchange code for token
      const tokenData = await exchangeCodeForToken(shop, code);

      // 1) Verify token exchange
      console.log(`[shopify/callback] token exchange ok — scope=${tokenData.scope} token_prefix=${tokenData.access_token.slice(0, 8)}...`);

      // Fetch shop info
      const client = shopifyClient(shop, tokenData.access_token);
      const shopInfo = await client.getShop();
      console.log(`[shopify/callback] shop info ok — name="${shopInfo.name}" currency=${shopInfo.currency}`);

      // 2) Confirm the accountId that will be written
      console.log(`[shopify/callback] upserting shopify_connections for account_id=${accountId}`);

      // Upsert connection
      const { error: upsertError } = await supabase
        .from('shopify_connections')
        .upsert(
          {
            account_id: accountId,
            shop_domain: shop,
            shop_name: shopInfo.name,
            shop_email: shopInfo.email,
            shop_currency: shopInfo.currency,
            shop_timezone: shopInfo.timezone,
            access_token: tokenData.access_token,
            scopes: tokenData.scope,
            sync_status: 'active',
            sync_error: null,
          },
          { onConflict: 'shop_domain' },
        );

      // 3) Check upsert result
      if (upsertError) {
        console.error(`[shopify/callback] upsert FAILED — code=${upsertError.code} message=${upsertError.message} details=${upsertError.details} hint=${upsertError.hint}`);
        throw new AppError(500, `Failed to save Shopify connection: ${upsertError.message}`);
      }

      // Verify the row actually landed — a silent failure would show null here
      const { data: savedRow, error: verifyError } = await supabase
        .from('shopify_connections')
        .select('id, account_id, shop_domain, sync_status')
        .eq('account_id', accountId)
        .maybeSingle();

      console.log(`[shopify/callback] post-upsert verify — row=${JSON.stringify(savedRow)} verifyError=${verifyError?.message ?? 'none'}`);
      // ── END DEBUG ──────────────────────────────────────────────────────────

      // Register mandatory GDPR webhooks required by Shopify
      const webhookBase = `${env.SHOPIFY_APP_URL}/api/webhooks/shopify`;
      try {
        await Promise.all([
          client.registerWebhook('customers/data_request', `${webhookBase}/customers-data-request`),
          client.registerWebhook('customers/redact', `${webhookBase}/customers-redact`),
          client.registerWebhook('shop/redact', `${webhookBase}/shop-redact`),
        ]);
      } catch {
        // GDPR webhooks failing shouldn't block the install
        console.warn(`[shopify] GDPR webhook registration warning for ${shop}`);
      }

      // Fire-and-forget: generate the first brief immediately.
      // Tries real Shopify data first; falls back to seed data on any sync failure
      // (e.g. 403 scope issues). Never blocks the redirect.
      void generateFirstBrief(accountId);

      res.redirect(`${env.FRONTEND_URL}/dashboard?connected=true`);
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /api/shopify/connection ──────────────────────────────────────────────
// Returns the current Shopify connection status for the authed account.
router.get(
  '/connection',
  (req: Request, _res: Response, next: NextFunction) => {
    console.log(`[shopify/connection] Authorization header: ${req.headers.authorization ?? 'MISSING'}`);
    next();
  },
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { data, error } = await supabase
        .from('shopify_connections')
        .select('shop_domain, shop_name, shop_currency, sync_status, last_synced_at')
        .eq('account_id', req.accountId!)
        .maybeSingle();

      console.log(`[shopify/connection] accountId=${req.accountId} data=${JSON.stringify(data)} error=${error?.message ?? 'none'}`);

      if (error) throw new AppError(500, error.message);

      res.json({ connection: data ?? null });
    } catch (err) {
      next(err);
    }
  },
);

// ── DELETE /api/shopify/disconnect ───────────────────────────────────────────
// Removes the Shopify connection for the authed account.
router.delete(
  '/disconnect',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { data: connection, error: fetchError } = await supabase
        .from('shopify_connections')
        .select('id, shop_domain, access_token, webhook_id')
        .eq('account_id', req.accountId!)
        .maybeSingle();

      if (fetchError) throw new AppError(500, fetchError.message);
      if (!connection) {
        res.json({ message: 'No connection to remove' });
        return;
      }

      // Best-effort: delete the webhook from Shopify
      if (connection.webhook_id) {
        try {
          const client = shopifyClient(connection.shop_domain, connection.access_token);
          await client.deleteWebhook(connection.webhook_id);
        } catch {
          console.warn(`[shopify] Could not delete webhook for ${connection.shop_domain}`);
        }
      }

      const { error: deleteError } = await supabase
        .from('shopify_connections')
        .delete()
        .eq('id', connection.id);

      if (deleteError) throw new AppError(500, deleteError.message);

      res.json({ message: 'Shopify store disconnected' });
    } catch (err) {
      next(err);
    }
  },
);

// ── generateFirstBrief ────────────────────────────────────────────────────────
// Tries a real Shopify sync. If that fails for any reason (missing scopes, 403,
// etc.) it seeds realistic test data so the user always gets a first brief.

async function generateFirstBrief(accountId: string): Promise<void> {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const snapshotDate = yesterday.toISOString().slice(0, 10);

  try {
    const { snapshotDate: syncDate } = await syncYesterdayForAccount(accountId);
    await generateBrief({ accountId, briefDate: syncDate });
    console.log(`[shopify/callback] First brief generated for account ${accountId}`);
    return;
  } catch (syncErr) {
    console.warn(
      `[shopify/callback] Real sync failed, falling back to seed data for account ${accountId}: ${(syncErr as Error).message}`,
    );
  }

  try {
    const topProducts = [
      {
        product_id: 'seed-001',
        title: 'Vitamin C Brightening Serum',
        quantity_sold: 18,
        revenue: 2160.0,
        variant_breakdown: [{ variant_id: 'seed-001-v1', title: '30ml', quantity: 18 }],
      },
      {
        product_id: 'seed-002',
        title: 'Hyaluronic Acid Moisturizer',
        quantity_sold: 12,
        revenue: 1080.0,
        variant_breakdown: [{ variant_id: 'seed-002-v1', title: '50ml', quantity: 12 }],
      },
      {
        product_id: 'seed-003',
        title: 'Retinol Night Repair Cream',
        quantity_sold: 8,
        revenue: 960.0,
        variant_breakdown: [{ variant_id: 'seed-003-v1', title: '30ml', quantity: 8 }],
      },
    ];

    const { error: upsertError } = await supabase
      .from('shopify_daily_snapshots')
      .upsert(
        {
          account_id: accountId,
          snapshot_date: snapshotDate,
          total_revenue: 4820.0,
          net_revenue: 4675.0,
          total_orders: 38,
          average_order_value: 126.84,
          sessions: 1118,
          conversion_rate: 0.034,
          returning_customer_rate: 0.4211,
          new_customers: 22,
          returning_customers: 16,
          total_customers: 38,
          top_products: topProducts,
          total_refunds: 145.0,
          cancelled_orders: 2,
          wow_revenue_pct: 12.3,
          wow_orders_pct: 8.1,
          wow_aov_pct: 3.7,
          wow_conversion_pct: null,
          wow_new_customers_pct: 15.2,
          raw_shopify_payload: { seeded: true },
        },
        { onConflict: 'account_id,snapshot_date' },
      );

    if (upsertError) {
      throw new Error(`Seed upsert failed: ${upsertError.message}`);
    }

    await generateBrief({ accountId, briefDate: snapshotDate });
    console.log(`[shopify/callback] First brief generated from seed data for account ${accountId}`);
  } catch (seedErr) {
    console.error(
      `[shopify/callback] First brief generation failed entirely for account ${accountId}: ${(seedErr as Error).message}`,
    );
  }
}

export default router;
