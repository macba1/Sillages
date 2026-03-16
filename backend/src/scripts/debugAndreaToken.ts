import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

async function main() {
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token, refresh_token, token_expires_at, scopes, app_client_id, token_status')
    .eq('account_id', 'e77572ee-83df-43e8-8f69-f143a227fe56')
    .single();

  if (!conn) { console.log('No connection found'); return; }

  const tokenPrefix = conn.access_token?.slice(0, 10);
  const isOnline = conn.access_token?.startsWith('shpca_') || conn.access_token?.startsWith('shpua_');
  const isOffline = conn.access_token?.startsWith('shpat_');

  console.log('=== ANDREA TOKEN DEBUG ===');
  console.log('shop_domain:', conn.shop_domain);
  console.log('token_prefix:', tokenPrefix);
  console.log('token_type:', isOnline ? 'ONLINE (shpca/shpua)' : isOffline ? 'OFFLINE (shpat)' : 'UNKNOWN');
  console.log('token_status:', conn.token_status);
  console.log('has_refresh_token:', !!conn.refresh_token);
  console.log('token_expires_at:', conn.token_expires_at);
  console.log('app_client_id:', conn.app_client_id);
  console.log('');

  // Parse scopes
  const currentScopes = (conn.scopes ?? '').split(',').map(s => s.trim()).sort();
  const requiredScopes = 'read_all_orders,read_products,write_products,read_customers,write_customers,read_analytics,read_inventory,read_reports,read_pixels,write_discounts,read_checkouts,write_marketing_events'.split(',').sort();

  console.log('=== SCOPE COMPARISON ===');
  console.log('Current scopes:', currentScopes.join(', '));
  console.log('');

  const missing = requiredScopes.filter(s => !currentScopes.includes(s));
  const extra = currentScopes.filter(s => !requiredScopes.includes(s));

  if (missing.length > 0) {
    console.log('MISSING SCOPES:', missing.join(', '));
  } else {
    console.log('All required scopes present!');
  }

  if (extra.length > 0) {
    console.log('Extra scopes (not required):', extra.join(', '));
  }

  // Check if token is expired
  if (conn.token_expires_at) {
    const expiresAt = new Date(conn.token_expires_at);
    const now = new Date();
    const hoursUntilExpiry = (expiresAt.getTime() - now.getTime()) / 3600000;
    console.log(`\nToken expires: ${conn.token_expires_at} (${hoursUntilExpiry > 0 ? `in ${hoursUntilExpiry.toFixed(1)}h` : `EXPIRED ${(-hoursUntilExpiry).toFixed(1)}h ago`})`);
  }

  // Explanation
  console.log('\n=== ROOT CAUSE ANALYSIS ===');
  if (isOnline) {
    console.log('Token is ONLINE (shpca_). This happens because:');
    console.log('  - The app is configured as "Custom Distribution" in Shopify Partners');
    console.log('  - Custom Distribution apps ALWAYS get online tokens, regardless of OAuth params');
    console.log('  - Online tokens from Custom Distribution DO support refresh_token');
    console.log('');
    console.log('The scopes issue is SEPARATE from the token type issue.');
    console.log('Scopes are determined by what the app requests in the OAuth URL');
    console.log('AND what the app is configured to have access to in Partner Dashboard.');
    console.log('');
    console.log('If scopes are missing, it means EITHER:');
    console.log('  1. The scopes were not configured in the Partner Dashboard for this app');
    console.log('  2. The OAuth URL did not request them (unlikely - code requests all)');
    console.log('  3. The merchant installed BEFORE the scopes were added and never re-authorized');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
