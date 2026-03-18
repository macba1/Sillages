import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { shopifyClient } from '../lib/shopify.js';

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';
const NAME = process.argv[2] ?? 'noelia';

async function main() {
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token')
    .eq('account_id', ANDREA_ID)
    .single();

  if (!conn) { console.log('No connection'); return; }

  const client = shopifyClient(conn.shop_domain, conn.access_token);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  const { orders } = await client.getOrders({
    created_at_min: thirtyDaysAgo,
    created_at_max: new Date().toISOString(),
  });

  const matches = orders.filter(o => {
    const fullName = `${o.customer?.first_name ?? ''} ${o.customer?.last_name ?? ''}`.toLowerCase();
    return fullName.includes(NAME.toLowerCase());
  });

  console.log(`Orders for "${NAME}" (last 30d): ${matches.length}`);
  for (const o of matches) {
    console.log(`  ${o.created_at} | ${o.customer?.email} | €${o.total_price} | ${o.financial_status} | ${o.cancel_reason ?? 'OK'} | ${o.line_items.map(li => li.title).join(', ')}`);
  }

  if (matches.length === 0) {
    console.log('NO ha comprado. Se puede recuperar.');
  } else {
    const valid = matches.filter(o => o.financial_status !== 'voided' && !o.cancel_reason);
    if (valid.length > 0) {
      console.log('YA COMPRÓ. No enviar recovery.');
    } else {
      console.log('Tiene pedidos pero cancelados/anulados. Se puede recuperar.');
    }
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
