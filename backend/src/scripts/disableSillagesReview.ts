import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // 1. Find the connection
  const { data: conn, error: connErr } = await supabase
    .from('shopify_connections')
    .select('id, account_id, shop_domain, token_status')
    .eq('shop_domain', 'sillages-review.myshopify.com')
    .maybeSingle();

  if (connErr) { console.error('Error finding connection:', connErr.message); return; }
  if (!conn) { console.error('No connection found for sillages-review.myshopify.com'); return; }

  console.log('Found connection:', conn);

  // 2. Mark token as invalid
  const { error: tokenErr } = await supabase
    .from('shopify_connections')
    .update({ token_status: 'invalid' })
    .eq('id', conn.id);

  if (tokenErr) console.error('Failed to update token_status:', tokenErr.message);
  else console.log('✅ token_status set to invalid');

  // 3. Disable send_enabled
  const { error: sendErr } = await supabase
    .from('user_intelligence_config')
    .update({ send_enabled: false })
    .eq('account_id', conn.account_id);

  if (sendErr) console.error('Failed to update send_enabled:', sendErr.message);
  else console.log('✅ send_enabled set to false');

  // 4. Verify
  const { data: verify1 } = await supabase
    .from('shopify_connections')
    .select('shop_domain, token_status')
    .eq('id', conn.id)
    .single();

  const { data: verify2 } = await supabase
    .from('user_intelligence_config')
    .select('send_enabled')
    .eq('account_id', conn.account_id)
    .maybeSingle();

  console.log('\nVerification:');
  console.log('  shopify_connections:', verify1);
  console.log('  user_intelligence_config:', verify2);
}

main().catch(console.error);
