import { supabase } from '../../supabase.js';
import { WooCommerceConnector } from './connector.js';

export { WooCommerceConnector } from './connector.js';
export type { WCProduct, WCOrder, WCCustomer, WCStoreInfo, WCAbandonedCart } from './connector.js';

const LOG = '[wc]';

// ═══════════════════════════════════════════════════════════════════════════
// WOOCOMMERCE HELPERS
//
// Get connector from DB, list active accounts, etc.
// ═══════════════════════════════════════════════════════════════════════════

export interface WCConnection {
  id: string;
  accountId: string;
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  shopName: string | null;
  shopCurrency: string;
  status: string;
  lastSyncAt: string | null;
}

/**
 * Get WooCommerce connector for an account. Returns null if no connection.
 */
export async function getWCConnector(accountId: string): Promise<WooCommerceConnector | null> {
  const conn = await getWCConnection(accountId);
  if (!conn) return null;
  return new WooCommerceConnector(conn.storeUrl, conn.consumerKey, conn.consumerSecret);
}

/**
 * Get WooCommerce connection info from DB.
 */
export async function getWCConnection(accountId: string): Promise<WCConnection | null> {
  try {
    const { data } = await supabase
      .from('platform_connections_v2')
      .select('id, account_id, store_url, consumer_key, consumer_secret, shop_name, shop_currency, status, last_sync_at')
      .eq('account_id', accountId)
      .eq('platform', 'woocommerce')
      .eq('status', 'active')
      .maybeSingle();

    if (!data) return null;

    return {
      id: data.id,
      accountId: data.account_id,
      storeUrl: data.store_url,
      consumerKey: data.consumer_key,
      consumerSecret: data.consumer_secret,
      shopName: data.shop_name,
      shopCurrency: data.shop_currency ?? 'EUR',
      status: data.status,
      lastSyncAt: data.last_sync_at,
    };
  } catch (err) {
    console.error(`${LOG} Failed to get WC connection for ${accountId}: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Get all active WooCommerce accounts.
 */
export async function getActiveWCAccounts(): Promise<WCConnection[]> {
  try {
    const { data } = await supabase
      .from('platform_connections_v2')
      .select('id, account_id, store_url, consumer_key, consumer_secret, shop_name, shop_currency, status, last_sync_at')
      .eq('platform', 'woocommerce')
      .eq('status', 'active');

    if (!data) return [];

    return data.map(d => ({
      id: d.id,
      accountId: d.account_id,
      storeUrl: d.store_url,
      consumerKey: d.consumer_key,
      consumerSecret: d.consumer_secret,
      shopName: d.shop_name,
      shopCurrency: d.shop_currency ?? 'EUR',
      status: d.status,
      lastSyncAt: d.last_sync_at,
    }));
  } catch (err) {
    console.error(`${LOG} Failed to list WC accounts: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Update last_sync_at timestamp for a connection.
 */
export async function markSynced(connectionId: string): Promise<void> {
  await supabase
    .from('platform_connections_v2')
    .update({ last_sync_at: new Date().toISOString() })
    .eq('id', connectionId);
}
