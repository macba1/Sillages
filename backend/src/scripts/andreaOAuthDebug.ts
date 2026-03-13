import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

async function main() {
  const ACCOUNT_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

  // 1. Check oauth_states for Andrea's recent reconnection attempts
  console.log('=== OAUTH STATES ===');
  const { data: states } = await supabase
    .from('oauth_states')
    .select('*')
    .eq('account_id', ACCOUNT_ID)
    .order('created_at', { ascending: false })
    .limit(10);

  if (states && states.length > 0) {
    for (const s of states) {
      console.log(JSON.stringify(s, null, 2));
    }
  } else {
    console.log('No oauth states found');
  }

  // 2. Check the token details
  console.log('\n=== TOKEN ANALYSIS ===');
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('access_token, token_status, app_client_id, updated_at, created_at')
    .eq('account_id', ACCOUNT_ID)
    .single();

  if (conn) {
    const token = conn.access_token;
    console.log(`Token prefix: ${token.slice(0, 10)}`);
    console.log(`Token length: ${token.length}`);
    console.log(`Starts with shpat_: ${token.startsWith('shpat_')}`);
    console.log(`Starts with shpca_: ${token.startsWith('shpca_')}`);
    console.log(`Starts with shpua_: ${token.startsWith('shpua_')}`);
    console.log(`app_client_id: ${conn.app_client_id}`);
    console.log(`Connection created: ${conn.created_at}`);
    console.log(`Connection updated: ${conn.updated_at}`);
  }

  // 3. Check if the Shopify app is configured as "custom distribution" vs "public"
  // Custom distribution apps ALWAYS issue online tokens regardless of grant_options
  console.log('\n=== APP CONFIGURATION CHECK ===');
  console.log(`SHOPIFY_API_KEY (primary): ${process.env.SHOPIFY_API_KEY?.slice(0, 10)}...`);
  console.log(`SHOPIFY_BETA_API_KEY: ${process.env.SHOPIFY_BETA_API_KEY?.slice(0, 10)}...`);
  console.log(`app_client_id saved: ${conn?.app_client_id?.slice(0, 10)}...`);

  const isPrimary = conn?.app_client_id === process.env.SHOPIFY_API_KEY;
  const isBeta = conn?.app_client_id === process.env.SHOPIFY_BETA_API_KEY;
  console.log(`Matches primary app: ${isPrimary}`);
  console.log(`Matches beta app: ${isBeta}`);

  console.log('\n=== ROOT CAUSE HYPOTHESIS ===');
  console.log('If the app is "Custom Distribution" in Shopify Partners,');
  console.log('Shopify ALWAYS issues online tokens (shpca_/shpua_) regardless');
  console.log('of whether grant_options[]=per-user is included or not.');
  console.log('Only "Public" or "Unlisted" apps get offline tokens (shpat_).');
  console.log('Check: https://partners.shopify.com → Apps → Distribution');
}

main().catch(console.error);
