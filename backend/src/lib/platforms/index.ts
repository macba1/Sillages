import { supabase } from '../supabase.js';
import { ensureTokenFresh } from '../shopify.js';
import { ShopifyConnector } from './shopify.js';
import type { PlatformConnector, PlatformConnection, PlatformType } from './types.js';

export type { PlatformConnector, PlatformType, PlatformConnection };
export * from './types.js';

const LOG = '[platforms]';

// ═══════════════════════════════════════════════════════════════════════════
// PLATFORM FACTORY
//
// Returns the correct PlatformConnector for a given account.
// Reads the platform type from the DB and instantiates the right connector.
//
// Currently supports: Shopify
// Coming soon: WooCommerce, BigCommerce
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the connection info for an account from the DB.
 * Reads from shopify_connections (to be renamed to platform_connections later).
 */
export async function getConnectionInfo(accountId: string): Promise<PlatformConnection | null> {
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token, shop_name, shop_currency, token_status')
    .eq('account_id', accountId)
    .maybeSingle();

  if (!conn || !conn.shop_domain) return null;

  return {
    accountId,
    platform: 'shopify', // TODO: read from platform column when added
    shopDomain: conn.shop_domain,
    accessToken: conn.access_token,
    shopName: conn.shop_name,
    shopCurrency: conn.shop_currency,
    tokenStatus: conn.token_status,
  };
}

/**
 * Get a PlatformConnector for a given account.
 * Reads connection info from DB, ensures token is fresh, returns the connector.
 *
 * Returns null if account has no connection or token is invalid.
 */
export async function getConnector(accountId: string): Promise<PlatformConnector | null> {
  const conn = await getConnectionInfo(accountId);
  if (!conn) {
    console.warn(`${LOG} No connection found for account ${accountId}`);
    return null;
  }

  if (conn.tokenStatus === 'invalid') {
    console.warn(`${LOG} Token invalid for account ${accountId}`);
    return null;
  }

  switch (conn.platform) {
    case 'shopify': {
      if (!conn.shopDomain || !conn.accessToken) return null;
      // Ensure token is fresh before creating connector
      try {
        await ensureTokenFresh(conn.shopDomain);
      } catch (err) {
        console.warn(`${LOG} Token refresh failed for ${conn.shopDomain}: ${(err as Error).message}`);
      }
      return new ShopifyConnector(conn.shopDomain, conn.accessToken);
    }

    case 'woocommerce': {
      // TODO: implement in Fase 3
      console.warn(`${LOG} WooCommerce connector not yet implemented`);
      return null;
    }

    default:
      console.warn(`${LOG} Unknown platform: ${conn.platform}`);
      return null;
  }
}

/**
 * Get a PlatformConnector directly from known credentials (no DB lookup).
 * Useful for cases where we already have the connection info.
 */
export function getConnectorDirect(
  platform: PlatformType,
  credentials: { shopDomain?: string; accessToken?: string; storeUrl?: string; consumerKey?: string; consumerSecret?: string },
): PlatformConnector | null {
  switch (platform) {
    case 'shopify':
      if (!credentials.shopDomain || !credentials.accessToken) return null;
      return new ShopifyConnector(credentials.shopDomain, credentials.accessToken);

    case 'woocommerce':
      // TODO: implement in Fase 3
      return null;

    default:
      return null;
  }
}
