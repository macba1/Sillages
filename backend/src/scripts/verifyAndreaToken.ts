import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { shopifyClient } from '../lib/shopify.js';

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

async function main() {
  // 1. Token info from DB
  console.log('=== 1. TOKEN INFO FROM DB ===');
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('*')
    .eq('account_id', ANDREA_ID)
    .single();

  if (!conn) { console.log('No connection found!'); return; }

  console.log(`shop_domain: ${conn.shop_domain}`);
  console.log(`token_status: ${conn.token_status}`);
  console.log(`token_failing_since: ${conn.token_failing_since ?? 'null'}`);
  console.log(`token_retry_count: ${conn.token_retry_count ?? 0}`);

  const token = conn.access_token ?? '';
  const prefix = token.slice(0, 6);
  const isPermament = token.startsWith('shpat_');
  const isTemporary = token.startsWith('shpca_');
  console.log(`\ntoken_prefix: ${prefix}...`);
  console.log(`token_type: ${isPermament ? 'PERMANENT (shpat_)' : isTemporary ? 'TEMPORARY (shpca_)' : 'UNKNOWN'}`);
  console.log(`token_length: ${token.length}`);

  // Check refresh_token
  const hasRefresh = !!(conn as Record<string, unknown>).refresh_token;
  console.log(`refresh_token: ${hasRefresh ? 'YES' : 'NO / not stored'}`);

  // 2. Verify token works + check scopes
  console.log('\n=== 2. TOKEN VALIDATION & SCOPES ===');
  try {
    const client = shopifyClient(conn.shop_domain, token);
    const shop = await client.getShop();
    console.log(`Token is VALID - shop: ${shop.name}`);

    // Check scopes via API
    const axios = (await import('axios')).default;
    const scopeRes = await axios.get(
      `https://${conn.shop_domain}/admin/oauth/access_scopes.json`,
      { headers: { 'X-Shopify-Access-Token': token } }
    );
    const scopes = (scopeRes.data.access_scopes as Array<{ handle: string }>).map(s => s.handle);
    console.log(`\nScopes (${scopes.length}):`);
    scopes.forEach(s => console.log(`  ✓ ${s}`));

    // Check required scopes
    const required = ['read_all_orders', 'write_discounts', 'write_products', 'write_customers', 'read_checkouts', 'write_marketing_events'];
    console.log('\nRequired scope check:');
    for (const req of required) {
      const has = scopes.includes(req);
      console.log(`  ${has ? '✓' : '✗'} ${req}`);
    }
  } catch (err) {
    console.log(`Token INVALID: ${(err as Error).message}`);
  }

  // 3. Check history sync
  console.log('\n=== 3. HISTORY SYNC STATUS ===');
  const { count: snapshotCount } = await supabase
    .from('shopify_daily_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', ANDREA_ID);
  console.log(`Daily snapshots: ${snapshotCount ?? 0}`);

  const { data: latestSnap } = await supabase
    .from('shopify_daily_snapshots')
    .select('snapshot_date, total_orders, total_revenue')
    .eq('account_id', ANDREA_ID)
    .order('snapshot_date', { ascending: false })
    .limit(3);
  if (latestSnap) {
    console.log('Latest snapshots:');
    latestSnap.forEach(s => console.log(`  ${s.snapshot_date}: ${s.total_orders} orders, €${s.total_revenue}`));
  }

  // 4. Abandoned carts
  console.log('\n=== 4. ABANDONED CARTS ===');
  const { data: carts, count: cartCount } = await supabase
    .from('abandoned_carts')
    .select('customer_name, customer_email, total_price, abandoned_at, products', { count: 'exact' })
    .eq('account_id', ANDREA_ID)
    .order('abandoned_at', { ascending: false })
    .limit(5);
  console.log(`Total abandoned carts: ${cartCount ?? 0}`);
  if (carts) {
    carts.forEach(c => {
      const prods = (c.products as Array<{ title: string }>)?.map(p => p.title).join(', ') ?? '';
      console.log(`  ${c.customer_name} <${c.customer_email}> — €${c.total_price} — ${c.abandoned_at} — ${prods}`);
    });
  }

  // 5. Pending actions
  console.log('\n=== 5. PENDING ACTIONS ===');
  const { data: actions } = await supabase
    .from('pending_actions')
    .select('id, type, title, status, created_at')
    .eq('account_id', ANDREA_ID)
    .order('created_at', { ascending: false })
    .limit(15);

  if (actions) {
    console.log(`Found ${actions.length} actions:`);
    actions.forEach(a => {
      console.log(`  [${a.status}] ${a.type}: ${a.title} — created ${a.created_at}`);
    });
  }

  // Check if there are actions from different timestamps (old vs new)
  const { data: allActions } = await supabase
    .from('pending_actions')
    .select('id, type, created_at')
    .eq('account_id', ANDREA_ID)
    .order('created_at', { ascending: true });
  if (allActions && allActions.length > 0) {
    const first = allActions[0].created_at;
    const last = allActions[allActions.length - 1].created_at;
    console.log(`\nAction date range: ${first} → ${last}`);
    console.log(`All from same batch: ${first.slice(0, 16) === last.slice(0, 16) ? 'YES' : 'NO — different timestamps'}`);
  }

  // 6. Event log
  console.log('\n=== 6. EVENT LOG ===');
  const { data: events } = await supabase
    .from('event_log')
    .select('event_type, event_key, detected_at, push_sent')
    .eq('account_id', ANDREA_ID)
    .order('detected_at', { ascending: false })
    .limit(15);
  if (events) {
    console.log(`Recent events (${events.length}):`);
    events.forEach(e => console.log(`  ${e.event_type}: ${e.event_key} — ${e.detected_at} — push: ${e.push_sent}`));
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
