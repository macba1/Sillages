import { supabase } from '../../lib/supabase.js';
import type { ShopContext } from './catalogStore.js';

/**
 * Resolves the account/connection a catalogue operation belongs to.
 *
 * Every catalogue write is scoped by `connection_id`, so one shop can never see
 * or overwrite another shop's rows.
 */
export interface ResolvedShop extends ShopContext {
  accessToken: string;
}

export async function resolveShopByDomain(shopDomain: string): Promise<ResolvedShop | null> {
  const { data, error } = await supabase
    .from('shopify_connections')
    .select('id, account_id, shop_domain, access_token')
    .eq('shop_domain', shopDomain)
    .maybeSingle();

  if (error || !data) return null;

  return {
    accountId: data.account_id as string,
    connectionId: data.id as string,
    shopDomain: data.shop_domain as string,
    accessToken: data.access_token as string,
  };
}

export async function resolveShopByAccount(accountId: string): Promise<ResolvedShop | null> {
  const { data, error } = await supabase
    .from('shopify_connections')
    .select('id, account_id, shop_domain, access_token')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    accountId: data.account_id as string,
    connectionId: data.id as string,
    shopDomain: data.shop_domain as string,
    accessToken: data.access_token as string,
  };
}

/** Every shop we should keep a catalogue for. */
export async function listActiveShops(): Promise<ResolvedShop[]> {
  const { data, error } = await supabase
    .from('shopify_connections')
    .select('id, account_id, shop_domain, access_token, sync_status')
    .neq('sync_status', 'disconnected');

  if (error || !data) return [];

  return data.map((row) => ({
    accountId: row.account_id as string,
    connectionId: row.id as string,
    shopDomain: row.shop_domain as string,
    accessToken: row.access_token as string,
  }));
}
