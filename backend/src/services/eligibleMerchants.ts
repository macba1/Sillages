/**
 * Shared merchant-eligibility helper — single source of truth for "who gets emails".
 *
 * Used by the scheduler (daily + weekly brief sends) AND the health monitor
 * (fail-loud delivery check). Keeping ONE definition prevents drift where the
 * sender and the monitor disagree on the audience.
 *
 * A merchant is eligible if ALL of:
 *   1. App installed/active — has a non-test Shopify connection whose token
 *      is not 'invalid' (invalid == revoked/uninstalled).
 *   2. NOT a test store — excluded by is_test flag, by ghost email
 *      (@shopify.com testers, reviewer@sillages.app), AND by an explicit
 *      domain allowlist (second barrier — never trust a single match).
 *   3. Has a valid contact email not in email_blacklist / email_unsubscribes.
 */

import { supabase } from '../lib/supabase.js';

export interface EligibleMerchant {
  account_id: string;
  shop: string;
  email: string;
}

// Second barrier: explicit test-store domains. Both currently map to the same
// dev account (de866762 — sillagesdev + sillages2 share an account_id, P1-3),
// so excluding by domain here never blocks a real merchant.
export const TEST_SHOP_DOMAINS = new Set<string>([
  'sillagesdev.myshopify.com',
  'etw0qb-0c.myshopify.com', // "sillages2" / "Sillages"
]);

const GHOST_DOMAINS = ['@shopify.com'];
const GHOST_EMAILS = new Set<string>(['reviewer@sillages.app']);

// token_status values that mean "still installed". 'invalid' == revoked/uninstalled.
const LIVE_TOKEN_STATUSES = new Set<string>(['active', 'failing', 'healthy']);

interface AccountRow { id: string; email: string | null; is_test?: boolean | null }
interface ConnRow { account_id: string; shop_domain: string | null; shop_name: string | null; token_status: string | null }

export function isGhostEmail(email: string): boolean {
  if (GHOST_EMAILS.has(email)) return true;
  return GHOST_DOMAINS.some(d => email.endsWith(d));
}

/**
 * Returns the list of merchants eligible to receive brief emails.
 * Pure read — never sends anything.
 */
export async function getEligibleMerchants(): Promise<EligibleMerchant[]> {
  // select('*') so the query keeps working before the is_test migration is applied.
  const { data: accountsRaw, error: accErr } = await supabase
    .from('accounts')
    .select('*')
    .or('subscription_status.in.(active,trialing,beta),subscription_status.is.null');

  if (accErr || !accountsRaw) {
    console.error('[eligibleMerchants] Failed to load accounts:', accErr?.message);
    return [];
  }
  const accounts = accountsRaw as AccountRow[];

  const [{ data: connsRaw }, { data: blacklist }, { data: unsubs }] = await Promise.all([
    supabase.from('shopify_connections').select('account_id, shop_domain, shop_name, token_status'),
    supabase.from('email_blacklist').select('email'),
    supabase.from('email_unsubscribes').select('email'),
  ]);

  const conns = (connsRaw ?? []) as ConnRow[];
  const blockedEmails = new Set<string>([
    ...((blacklist ?? []).map(b => (b.email ?? '').toLowerCase())),
    ...((unsubs ?? []).map(u => (u.email ?? '').toLowerCase())),
  ]);

  // Group live, non-test connections per account.
  const liveConnsByAccount = new Map<string, ConnRow[]>();
  for (const c of conns) {
    const domain = (c.shop_domain ?? '').toLowerCase();
    if (!domain || TEST_SHOP_DOMAINS.has(domain)) continue;
    if (!LIVE_TOKEN_STATUSES.has(c.token_status ?? '')) continue;
    const arr = liveConnsByAccount.get(c.account_id) ?? [];
    arr.push(c);
    liveConnsByAccount.set(c.account_id, arr);
  }

  const eligible: EligibleMerchant[] = [];
  for (const a of accounts) {
    const email = (a.email ?? '').trim();
    if (!email) continue;
    if (a.is_test === true) continue;
    if (isGhostEmail(email)) continue;
    if (blockedEmails.has(email.toLowerCase())) continue;

    const liveConns = liveConnsByAccount.get(a.id);
    if (!liveConns || liveConns.length === 0) continue; // not installed / no real store

    // Pick a stable shop label (first non-empty shop_name, else domain).
    const labelConn = liveConns.find(c => c.shop_name) ?? liveConns[0];
    eligible.push({
      account_id: a.id,
      shop: labelConn.shop_name ?? labelConn.shop_domain ?? 'unknown',
      email,
    });
  }

  return eligible;
}
