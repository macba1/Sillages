import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

async function main() {
  const { data: acc } = await supabase
    .from('accounts')
    .select('id, email, full_name, subscription_status')
    .eq('email', 'andrea@nicolina.es')
    .single();

  console.log('=== ACCOUNT ===');
  console.log(acc);

  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('*')
    .eq('account_id', acc.id)
    .single();

  console.log('\n=== SHOPIFY CONNECTION ===');
  console.log('shop_domain:', conn?.shop_domain);
  console.log('shop_name:', conn?.shop_name);
  console.log('shop_currency:', conn?.shop_currency);
  console.log('token_type:', conn?.token_type);
  console.log('access_token prefix:', conn?.access_token?.slice(0, 10));
  console.log('scopes:', conn?.scopes);
  console.log('installed_at:', conn?.installed_at);
  console.log('updated_at:', conn?.updated_at);

  // Check brand profile
  const { data: brand } = await supabase
    .from('brand_profiles')
    .select('*')
    .eq('account_id', acc.id)
    .single();

  console.log('\n=== BRAND PROFILE ===');
  if (brand) {
    console.log('brand_voice:', brand.brand_voice?.slice(0, 100));
    console.log('brand_values:', brand.brand_values?.slice(0, 100));
    console.log('updated_at:', brand.updated_at);
  } else {
    console.log('NOT FOUND');
  }

  // Check abandoned carts
  const { count: cartCount } = await supabase
    .from('abandoned_carts')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', acc.id);

  console.log('\n=== ABANDONED CARTS ===');
  console.log('Count:', cartCount);

  // Check store_history
  const { data: hist } = await supabase
    .from('store_history')
    .select('*')
    .eq('account_id', acc.id)
    .maybeSingle();

  console.log('\n=== STORE HISTORY ===');
  if (hist) {
    const monthly = hist.monthly_revenue as any[];
    console.log('months:', monthly?.length);
    console.log('total_orders:', hist.total_orders);
    console.log('total_revenue:', hist.total_revenue);
  } else {
    console.log('NOT FOUND');
  }

  // Check push subscriptions
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, created_at')
    .eq('account_id', acc.id);

  console.log('\n=== PUSH SUBSCRIPTIONS ===');
  console.log('Count:', subs?.length ?? 0);
  for (const s of subs ?? []) {
    console.log('  ', s.id, s.created_at);
  }

  // Check event_log
  const { count: eventCount } = await supabase
    .from('event_log')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', acc.id);

  console.log('\n=== EVENT LOG ===');
  console.log('Count:', eventCount);
}

main().catch(e => { console.error(e); process.exit(1); });
