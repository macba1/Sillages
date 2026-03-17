import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

async function main() {
  const { data } = await supabase
    .from('abandoned_carts')
    .select('customer_name, customer_email, total_price, abandoned_at, products')
    .eq('account_id', ANDREA_ID)
    .order('abandoned_at', { ascending: false });

  if (!data) { console.log('No data'); return; }
  console.log(`TOTAL: ${data.length} carritos abandonados\n`);

  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    const prods = (c.products as Array<{ title: string; quantity: number }>)
      ?.map(p => `${p.title} x${p.quantity}`)
      .join(', ') ?? '';
    const date = new Date(c.abandoned_at);
    const days = Math.floor((Date.now() - date.getTime()) / 86400000);
    console.log(`${i + 1}. ${c.abandoned_at.slice(0, 10)}  (hace ${days} días)`);
    console.log(`   ${c.customer_name || 'SIN NOMBRE'} <${c.customer_email || 'SIN EMAIL'}>`);
    console.log(`   Productos: ${prods}`);
    console.log(`   Total: €${c.total_price}\n`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
