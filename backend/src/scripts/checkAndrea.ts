import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import axios from 'axios';

async function main() {
  // 1. Check connection status
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('id, account_id, shop_domain, access_token, token_status, token_failing_since, token_retry_count, app_client_id, updated_at')
    .eq('shop_domain', 'taart-madrid.myshopify.com')
    .single();

  if (!conn) { console.log('NO CONNECTION FOUND'); return; }

  console.log('=== 1. CONNECTION STATUS ===');
  const isShpat = conn.access_token?.startsWith('shpat_');
  console.log(`Token prefix: ${conn.access_token?.slice(0, 10)}`);
  console.log(`Token starts with shpat_: ${isShpat ? 'YES' : 'NO (prefix: ' + conn.access_token?.slice(0, 6) + ')'}`);
  console.log(`Token status: ${conn.token_status}`);
  console.log(`app_client_id: ${conn.app_client_id ? conn.app_client_id.slice(0, 10) + '...' : 'NOT SET'}`);
  console.log(`Updated at: ${conn.updated_at}`);

  // 3. Test API call
  console.log('\n=== 2. SHOPIFY API TEST ===');
  try {
    const resp = await axios.get(`https://${conn.shop_domain}/admin/api/2024-04/shop.json`, {
      headers: { 'X-Shopify-Access-Token': conn.access_token },
      timeout: 10000,
    });
    const shop = resp.data.shop;
    console.log(`Shop: ${shop.name} | Plan: ${shop.plan_name} | Currency: ${shop.currency}`);
    console.log('API call: SUCCESS');
  } catch (err: any) {
    console.log(`API call FAILED: ${err.response?.status ?? err.message}`);
    return; // Can't proceed without valid token
  }

  // Existing data
  const { count: snapCount } = await supabase
    .from('shopify_daily_snapshots')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', conn.account_id);

  const { data: latestSnaps } = await supabase
    .from('shopify_daily_snapshots')
    .select('snapshot_date')
    .eq('account_id', conn.account_id)
    .order('snapshot_date', { ascending: false })
    .limit(3);

  const { count: briefCount } = await supabase
    .from('intelligence_briefs')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', conn.account_id);

  const { data: latestBriefs } = await supabase
    .from('intelligence_briefs')
    .select('brief_date, status')
    .eq('account_id', conn.account_id)
    .order('brief_date', { ascending: false })
    .limit(3);

  const { data: actions, count: actionCount } = await supabase
    .from('pending_actions')
    .select('type, title, status', { count: 'exact' })
    .eq('account_id', conn.account_id);

  console.log('\n=== 3. EXISTING DATA ===');
  console.log(`Snapshots: ${snapCount} total | Latest: ${latestSnaps?.map(s => s.snapshot_date).join(', ') || 'none'}`);
  console.log(`Briefs: ${briefCount} total | Latest: ${latestBriefs?.map(b => `${b.brief_date}(${b.status})`).join(', ') || 'none'}`);
  console.log(`Actions: ${actionCount} total`);
  if (actions) actions.forEach(a => console.log(`  [${a.status}] ${a.type}: ${a.title}`));
}

main().catch(console.error);
