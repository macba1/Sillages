import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  buildInstallUrl,
  generateState,
  validateHmac,
  validateHmacMultiApp,
  validateShopDomain,
  exchangeCodeForToken,
  shopifyClient,
  resolveShopifyCredentials,
  createAppSubscription,
  getAppSubscriptionStatus,
} from '../lib/shopify.js';
import { supabase } from '../lib/supabase.js';
import { requireAuth, resolveAuthToken } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';
import { syncYesterdayForAccount } from '../services/shopifySync.js';
import { generateBrief } from '../services/briefGenerator.js';

const router = Router();

// ── GET /api/shopify/auth ────────────────────────────────────────────────────
// Initiates OAuth flow.  Two modes:
//   1. Shopify-initiated install (App Store) → no auth token, just ?shop=
//      → generate OAuth URL and redirect immediately (no account_id needed yet)
//   2. Sillages-initiated (dashboard) → JWT via Authorization header or ?token=
//      → store state linked to account_id for the callback to resolve
router.get('/auth', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shop = req.query.shop as string;
    if (!shop || !validateShopDomain(shop)) {
      throw new AppError(400, 'Invalid or missing shop domain');
    }

    // Resolve credentials — ?app=beta selects Sillages Beta
    const appParam = req.query.app as string | undefined;
    const clientIdHint = appParam === 'beta' ? env.SHOPIFY_BETA_API_KEY : (req.query.client_id as string | undefined);
    const credentials = resolveShopifyCredentials(clientIdHint);

    const state = generateState();

    // Try to resolve the authenticated user (optional — won't fail the request)
    const headerToken = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null;
    const token = headerToken ?? (req.query.token as string | undefined);

    let accountId: string | null = null;
    if (token) {
      try {
        const resolved = await resolveAuthToken(token);
        accountId = resolved.accountId;
      } catch {
        // Token invalid or expired — continue without account_id
        console.log(`[shopify/auth] Token provided but invalid — continuing as Shopify-initiated install for ${shop}`);
      }
    }

    if (accountId) {
      // Sillages-initiated: store state linked to account
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const { error: insertError } = await supabase
        .from('shopify_oauth_states')
        .insert({ state, account_id: accountId, expires_at: expiresAt });

      if (insertError) {
        throw new AppError(500, `Failed to store OAuth state: ${insertError.message}`);
      }
      console.log(`[shopify/auth] Sillages-initiated install for ${shop} — account_id=${accountId}`);
    } else {
      // Shopify-initiated: no account yet — state is not stored.
      // The callback handles this case by looking up shop_domain or redirecting to signup.
      console.log(`[shopify/auth] Shopify-initiated install for ${shop} — no auth token, skipping state storage`);
    }

    const installUrl = buildInstallUrl(shop, state, credentials);
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

      // Validate HMAC — try all known app credentials (Shopify doesn't send client_id in callback)
      if (!hmac) {
        throw new AppError(400, 'Missing HMAC');
      }
      const credentials = validateHmacMultiApp(query);
      if (!credentials) {
        throw new AppError(400, 'Invalid HMAC signature');
      }
      console.log(`[shopify/callback] HMAC matched app client_id=${credentials.clientId}`);

      // Resolve account — two paths:
      // 1. State exists in our DB → install initiated from Sillages dashboard (our /auth flow)
      // 2. State NOT in our DB → Shopify-initiated install (custom distribution), look up by shop_domain
      let accountId: string;

      if (state) {
        // Garbage-collect expired states
        await supabase
          .from('shopify_oauth_states')
          .delete()
          .lt('expires_at', new Date().toISOString());

        const { data: stateRow, error: stateError } = await supabase
          .from('shopify_oauth_states')
          .select('account_id')
          .eq('state', state)
          .maybeSingle();

        if (stateError) {
          throw new AppError(500, `State lookup failed: ${stateError.message}`);
        }

        if (stateRow) {
          // Path 1: state found — Sillages-initiated install
          await supabase.from('shopify_oauth_states').delete().eq('state', state);
          accountId = stateRow.account_id;
          console.log(`[shopify/callback] resolved account from state: ${accountId}`);
        } else {
          // Path 2: state not in our DB — Shopify-initiated install (custom distribution)
          // Look up existing connection by shop_domain, or create a new account
          const { data: existingConn } = await supabase
            .from('shopify_connections')
            .select('account_id')
            .eq('shop_domain', shop)
            .maybeSingle();

          if (existingConn) {
            accountId = existingConn.account_id;
            console.log(`[shopify/callback] Shopify-initiated install — found existing account by shop_domain: ${accountId}`);
          } else {
            // No state in our DB and no existing connection — redirect to sign-up flow
            console.warn(`[shopify/callback] Shopify-initiated install for unknown shop ${shop} — no account to link`);
            res.redirect(`${env.FRONTEND_URL}/signup?shop=${encodeURIComponent(shop)}&source=shopify`);
            return;
          }
        }
      } else {
        throw new AppError(400, 'Missing state parameter');
      }

      // ── DEBUG ─────────────────────────────────────────────────────────────
      console.log(`[shopify/callback] shop=${shop} state=${state} accountId=${accountId}`);

      // Exchange code for token
      const tokenData = await exchangeCodeForToken(shop, code, credentials);

      // 1) Verify token exchange
      console.log(`[shopify/callback] token exchange ok — scope=${tokenData.scope} token_prefix=${tokenData.access_token.slice(0, 8)}...`);

      // Fetch shop info
      const client = shopifyClient(shop, tokenData.access_token);
      const shopInfo = await client.getShop();
      console.log(`[shopify/callback] shop info ok — name="${shopInfo.name}" currency=${shopInfo.currency}`);

      // 2) Confirm the accountId that will be written
      console.log(`[shopify/callback] upserting shopify_connections for account_id=${accountId}`);

      // Upsert connection — also reset token health on reconnection
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
            app_client_id: credentials.clientId,
            sync_status: 'active',
            sync_error: null,
            token_status: 'active',
            token_failing_since: null,
            token_retry_count: 0,
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

      // Check if this is a reconnection (existing account with subscription)
      const { data: existingAccount } = await supabase
        .from('accounts')
        .select('subscription_status')
        .eq('id', accountId)
        .single();

      const isReconnection = existingAccount?.subscription_status &&
        ['active', 'trialing', 'beta'].includes(existingAccount.subscription_status);

      if (isReconnection) {
        // Reconnection — skip billing, sync fresh data, go straight to dashboard
        console.log(`[shopify/callback] Reconnection detected — skipping billing, syncing data`);

        // Fire-and-forget: sync + brief with fresh data
        void (async () => {
          try {
            await syncYesterdayForAccount(accountId);
            const snap = await supabase
              .from('shopify_daily_snapshots')
              .select('snapshot_date')
              .eq('account_id', accountId)
              .order('snapshot_date', { ascending: false })
              .limit(1)
              .single();
            if (snap.data) {
              await generateBrief({ accountId, briefDate: snap.data.snapshot_date });
              console.log(`[shopify/callback] Reconnection brief generated for ${accountId}`);
            }
          } catch (err) {
            console.error(`[shopify/callback] Reconnection sync/brief failed (non-fatal):`, err instanceof Error ? err.message : err);
          }
        })();

        res.redirect(`${env.FRONTEND_URL}/dashboard?reconnected=true`);
      } else {
        // First install — generate brief and set up billing
        void generateFirstBrief(accountId);

        try {
          const billingReturnUrl = `${env.SHOPIFY_APP_URL}/api/shopify/billing-callback?shop=${encodeURIComponent(shop)}&account_id=${encodeURIComponent(accountId)}`;
          const { confirmationUrl, subscriptionId } = await createAppSubscription(
            shop,
            tokenData.access_token,
            'starter', // default plan
            billingReturnUrl,
          );

          await supabase
            .from('accounts')
            .update({
              stripe_subscription_id: subscriptionId,
              subscription_status: 'trialing',
              trial_ends_at: new Date(Date.now() + 14 * 86400000).toISOString(),
            })
            .eq('id', accountId);

          console.log(`[shopify/callback] Billing subscription created — redirecting merchant to approve: ${subscriptionId}`);
          res.redirect(confirmationUrl);
        } catch (billingErr) {
          console.error(`[shopify/callback] Billing creation failed (non-blocking): ${(billingErr as Error).message}`);
          res.redirect(`${env.FRONTEND_URL}/dashboard?connected=true`);
        }
      }
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /api/shopify/billing-callback ─────────────────────────────────────────
// Shopify redirects here after the merchant approves (or declines) the charge.
// Query params: charge_id (from Shopify), shop, account_id (from our returnUrl).
router.get(
  '/billing-callback',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const chargeId = req.query.charge_id as string | undefined;
      const shop = req.query.shop as string | undefined;
      const accountId = req.query.account_id as string | undefined;

      console.log(`[shopify/billing-callback] charge_id=${chargeId} shop=${shop} account_id=${accountId}`);

      if (!accountId) {
        throw new AppError(400, 'Missing account_id');
      }

      // Fetch connection to get access token
      const { data: conn } = await supabase
        .from('shopify_connections')
        .select('shop_domain, access_token')
        .eq('account_id', accountId)
        .maybeSingle();

      if (!conn) {
        throw new AppError(400, 'No Shopify connection found for this account');
      }

      // Fetch the subscription ID we stored during OAuth callback
      const { data: account } = await supabase
        .from('accounts')
        .select('stripe_subscription_id')
        .eq('id', accountId)
        .single();

      const subscriptionGid = account?.stripe_subscription_id;

      if (subscriptionGid) {
        // Check the subscription status on Shopify
        try {
          const { status, trialEndsOn } = await getAppSubscriptionStatus(
            conn.shop_domain,
            conn.access_token,
            subscriptionGid,
          );

          console.log(`[shopify/billing-callback] Subscription ${subscriptionGid} status=${status}`);

          // Map Shopify subscription status to our DB status
          const mappedStatus = status === 'ACTIVE' ? 'active'
            : status === 'PENDING' ? 'trialing'
            : status === 'DECLINED' ? 'canceled'
            : status === 'EXPIRED' ? 'canceled'
            : 'trialing';

          await supabase
            .from('accounts')
            .update({
              subscription_status: mappedStatus,
              trial_ends_at: trialEndsOn,
              updated_at: new Date().toISOString(),
            })
            .eq('id', accountId);

          console.log(`[shopify/billing-callback] Account ${accountId} subscription_status=${mappedStatus}`);
        } catch (statusErr) {
          console.error(`[shopify/billing-callback] Failed to check subscription status: ${(statusErr as Error).message}`);
        }
      }

      res.redirect(`${env.FRONTEND_URL}/dashboard?connected=true&billing=approved`);
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /api/shopify/reconnect ───────────────────────────────────────────────
// Quick reconnection — looks up the merchant's existing shop_domain and redirects
// straight to Shopify OAuth. No need to re-enter the shop domain.
// Accepts token as ?token= query param (like /auth) since it's a redirect, not an API call.
router.get('/reconnect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Resolve auth from query param or header
    const headerToken = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7) : null;
    const token = headerToken ?? (req.query.token as string | undefined);

    if (!token) {
      res.redirect(`${env.FRONTEND_URL}/login?redirect=/reconnect`);
      return;
    }

    let accountId: string;
    try {
      const resolved = await resolveAuthToken(token);
      accountId = resolved.accountId;
    } catch {
      res.redirect(`${env.FRONTEND_URL}/login?redirect=/reconnect`);
      return;
    }

    const { data: conn } = await supabase
      .from('shopify_connections')
      .select('shop_domain, app_client_id')
      .eq('account_id', accountId)
      .maybeSingle();

    if (!conn?.shop_domain) {
      // No existing connection — redirect to onboarding
      res.redirect(`${env.FRONTEND_URL}/onboarding`);
      return;
    }

    const state = generateState();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await supabase.from('shopify_oauth_states').insert({ state, account_id: accountId, expires_at: expiresAt });

    // Use the app that originally connected the store.
    // If no app_client_id saved, try beta first (legacy connections used beta),
    // fall back to primary.
    let credentials: import('../lib/shopify.js').ShopifyCredentials;
    if (conn.app_client_id) {
      credentials = resolveShopifyCredentials(conn.app_client_id);
      console.log(`[shopify/reconnect] Using saved app_client_id: ${conn.app_client_id.slice(0, 8)}...`);
    } else if (env.SHOPIFY_BETA_API_KEY) {
      credentials = resolveShopifyCredentials(env.SHOPIFY_BETA_API_KEY);
      console.log(`[shopify/reconnect] No saved app_client_id — trying beta app first`);
    } else {
      credentials = resolveShopifyCredentials();
      console.log(`[shopify/reconnect] No saved app_client_id, no beta — using primary app`);
    }

    const installUrl = buildInstallUrl(conn.shop_domain, state, credentials);

    console.log(`[shopify/reconnect] Redirecting ${accountId} to OAuth for ${conn.shop_domain} (client_id=${credentials.clientId.slice(0, 8)}...)`);
    res.redirect(installUrl);
  } catch (err) {
    next(err);
  }
});

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

  // Fetch account language so we can confirm it reaches briefGenerator correctly
  const { data: accountRow } = await supabase
    .from('accounts')
    .select('language')
    .eq('id', accountId)
    .single();
  console.log(`[generateFirstBrief] account ${accountId} language=${accountRow?.language ?? 'undefined (column may be missing)'}`);

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
