import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { shopifyClient } from '../lib/shopify.js';

async function main() {
  const { data: conn } = await supabase.from('shopify_connections')
    .select('shop_domain, access_token')
    .eq('account_id', 'e77572ee-83df-43e8-8f69-f143a227fe56').single();
  if (!conn) return;

  const client = shopifyClient(conn.shop_domain, conn.access_token);
  const products = await client.getProducts({ limit: 250, fields: 'title,images' });

  console.log('=== ALL PRODUCTS WITH "queso" or "tarta" ===');
  for (const p of products) {
    const t = p.title as string;
    if (t.toLowerCase().includes('queso') || t.toLowerCase().includes('tarta')) {
      const imgs = p.images as Array<{ src: string }> | undefined;
      console.log(`  "${t}" → image: ${imgs?.[0]?.src ? 'YES' : 'NO'}`);
    }
  }

  console.log('\n=== ALL PRODUCT TITLES ===');
  for (const p of products) {
    console.log(`  ${p.title}`);
  }
}

main().catch(console.error);
