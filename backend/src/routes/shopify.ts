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

// In-memory nonce store (use Redis in production for multi-instance)
const pendingStates = new Map<string, { accountId: string; expiresAt: number }>();

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
    pendingStates.set(state, {
      accountId,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 min
    });

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

      // Validate state nonce
      if (!state || !pendingStates.has(state)) {
        throw new AppError(400, 'Invalid or expired state parameter');
      }

      const pendingEntry = pendingStates.get(state)!;
      pendingStates.delete(state);

      if (Date.now() > pendingEntry.expiresAt) {
        throw new AppError(400, 'OAuth state expired — please try connecting again');
      }

      const accountId = pendingEntry.accountId;

      // Exchange code for token
      const tokenData = await exchangeCodeForToken(shop, code);

      // Fetch shop info
      const client = shopifyClient(shop, tokenData.access_token);
      const shopInfo = await client.getShop();

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
          { onConflict: 'account_id' },
        );

      if (upsertError) {
        throw new AppError(500, `Failed to save Shopify connection: ${upsertError.message}`);
      }

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
      // without waiting for the nightly scheduler.
      syncYesterdayForAccount(accountId).catch((err) =>
        console.error(`[shopify/callback] Initial sync failed for account ${accountId}:`, (err as Error).message),
      );

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
