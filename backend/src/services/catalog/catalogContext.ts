import { supabase } from '../../lib/supabase.js';
import { ensureTokenFresh } from '../../lib/shopify.js';
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

/**
 * Refreshes the shop's token if it is close to expiring, then re-reads it.
 *
 * Shopify no longer accepts non-expiring offline tokens, so every social
 * gallery token now lasts an hour. `ensureTokenFresh` was only ever called from
 * the legacy scheduler, auditor and health workflows — all of which are off in
 * social_gallery — so an hour after install every catalogue sync, webhook fetch
 * and billing call answered 401 with nothing to recover it.
 */
async function withFreshToken(row: {
  account_id: string;
  id: string;
  shop_domain: string;
  access_token: string;
}): Promise<ResolvedShop> {
  const shopDomain = row.shop_domain;
  let accessToken = row.access_token;

  // Half the lifetime, so a sync that starts fresh does not expire mid-run.
  if (await ensureTokenFresh(shopDomain, 30 * 60 * 1000)) {
    const { data } = await supabase
      .from('shopify_connections')
      .select('access_token')
      .eq('shop_domain', shopDomain)
      .maybeSingle();
    if (data?.access_token) accessToken = data.access_token as string;
  }

  return {
    accountId: row.account_id,
    connectionId: row.id,
    shopDomain,
    accessToken,
  };
}

export async function resolveShopByDomain(shopDomain: string): Promise<ResolvedShop | null> {
  const { data, error } = await supabase
    .from('shopify_connections')
    .select('id, account_id, shop_domain, access_token')
    .eq('shop_domain', shopDomain)
    .maybeSingle();

  if (error || !data) return null;

  return withFreshToken(data as never);
}

export async function resolveShopByAccount(accountId: string): Promise<ResolvedShop | null> {
  const { data, error } = await supabase
    .from('shopify_connections')
    .select('id, account_id, shop_domain, access_token')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error || !data) return null;

  return withFreshToken(data as never);
}

/** Every shop we should keep a catalogue for. */
export async function listActiveShops(): Promise<ResolvedShop[]> {
  // Uninstall writes 'disconnected'. Listing by the statuses that mean "still
  // ours" rather than excluding one value keeps an uninstalled shop out however
  // it was marked. `in` is also NULL-safe, unlike `neq`, which silently drops
  // rows whose sync_status was never set.
  const { data, error } = await supabase
    .from('shopify_connections')
    .select('id, account_id, shop_domain, access_token, sync_status')
    .or('sync_status.is.null,sync_status.in.(pending,active,error)');

  if (error || !data) return [];

  return Promise.all(data.map((row) => withFreshToken(row as never)));
}
