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

      // Fire-and-forget initial sync — gives the user real data immediately
      // without waiting for the nightly scheduler. Errors are caught explicitly
      // so a sync failure never crashes the server or blocks the redirect.
      void (async () => {
        try {
          await syncYesterdayForAccount(accountId);
        } catch (err) {
          console.error(
            `[shopify/callback] Initial sync failed for account ${accountId}:`,
            (err as Error).message,
          );
        }
      })();

      // Redirect back to frontend onboarding complete page
      res.redirect(`${env.FRONTEND_URL}/onboarding?connected=true&shop=${encodeURIComponent(shopInfo.name)}`);
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /api/shopify/connection ──────────────────────────────────────────────
// Returns the current Shopify connection status for the authed account.
router.get(
  '/connection',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { data, error } = await supabase
        .from('shopify_connections')
        .select('shop_domain, shop_name, shop_currency, sync_status, last_synced_at')
        .eq('account_id', req.accountId!)
        .maybeSingle();

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

export default router;
