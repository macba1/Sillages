import 'dotenv/config';
import { shopifyClient } from '../lib/shopify.js';
import { supabase } from '../lib/supabase.js';

async function main() {
  const { data: conn } = await supabase.from('shopify_connections').select('shop_domain, access_token').eq('account_id', 'e77572ee-83df-43e8-8f69-f143a227fe56').single();
  if (!conn) return;
  const client = shopifyClient(conn.shop_domain, conn.access_token);
  const products = await client.getProducts({ limit: 50, fields: 'id,title,images' });

  console.log('All DONA products:');
  const donas = products.filter(p => (p.title as string).toLowerCase().includes('dona'));
  for (const p of donas) {
    const imgs = p.images as Array<{src: string}> | undefined;
    console.log(`  "${p.title}" → ${imgs?.length ?? 0} images ${imgs?.[0]?.src ? 'OK' : 'NONE'}`);
  }

  // Check exact match for PEANUT REESE
  console.log('\nFuzzy search for peanut/reese:');
  for (const p of products) {
    const t = (p.title as string).toLowerCase();
    if (t.includes('peanut') || t.includes('reese')) {
      const imgs = p.images as Array<{src: string}> | undefined;
      console.log(`  "${p.title}" → ${imgs?.length ?? 0} images`, imgs?.[0]?.src ?? 'NONE');
    }
  }
}
main();
