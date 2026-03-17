import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import axios from 'axios';

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

async function main() {
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token, refresh_token, token_expires_at, scopes, app_client_id')
    .eq('account_id', ANDREA_ID)
    .single();

  if (!conn) { console.log('No connection'); return; }

  console.log('=== CONNECTION INFO ===');
  console.log(`refresh_token: ${conn.refresh_token ?? 'NULL'}`);
  console.log(`token_expires_at: ${conn.token_expires_at ?? 'NULL'}`);
  console.log(`app_client_id: ${conn.app_client_id ?? 'NULL'}`);
  console.log(`stored scopes: ${conn.scopes ?? 'NULL'}`);

  const token = conn.access_token;
  const domain = conn.shop_domain;
  const headers = { 'X-Shopify-Access-Token': token };

  // Test each endpoint
  const tests = [
    { name: 'Checkouts (read_checkouts)', url: `https://${domain}/admin/api/2024-01/checkouts.json?limit=2` },
    { name: 'Orders (read_all_orders)', url: `https://${domain}/admin/api/2024-01/orders.json?limit=1&status=any` },
    { name: 'Customers (read_customers)', url: `https://${domain}/admin/api/2024-01/customers.json?limit=1` },
    { name: 'Price Rules (write_discounts)', url: `https://${domain}/admin/api/2024-01/price_rules.json?limit=1` },
    { name: 'Products (read_products)', url: `https://${domain}/admin/api/2024-01/products.json?limit=1` },
  ];

  for (const t of tests) {
    console.log(`\n=== ${t.name} ===`);
    try {
      const r = await axios.get(t.url, { headers });
      const keys = Object.keys(r.data);
      const firstKey = keys[0];
      const count = Array.isArray(r.data[firstKey]) ? r.data[firstKey].length : '?';
      console.log(`OK — ${count} results`);
    } catch (err: unknown) {
      const e = err as { response?: { status: number; data: unknown } };
      console.log(`FAIL: ${e.response?.status} — ${JSON.stringify(e.response?.data).slice(0, 300)}`);
    }
  }

  // Current scopes
  console.log('\n=== CURRENT SCOPES ===');
  try {
    const r = await axios.get(`https://${domain}/admin/oauth/access_scopes.json`, { headers });
    const scopes = (r.data.access_scopes as Array<{ handle: string }>).map(s => s.handle);
    console.log(`Total: ${scopes.length}`);

    const required = [
      'read_all_orders', 'write_discounts', 'write_products',
      'write_customers', 'read_checkouts', 'write_marketing_events',
      'read_customers', 'read_products', 'read_analytics',
      'read_inventory', 'read_reports', 'read_pixels',
    ];

    console.log('\nScope check:');
    for (const r of required) {
      console.log(`  ${scopes.includes(r) ? 'YES' : 'NO '} ${r}`);
    }
  } catch (err: unknown) {
    const e = err as { response?: { status: number } };
    console.log(`FAIL: ${e.response?.status}`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
