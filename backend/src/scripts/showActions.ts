import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

async function main() {
  const { data: actions } = await supabase
    .from('pending_actions')
    .select('id, type, title, description, content')
    .eq('account_id', ANDREA_ID)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (!actions || actions.length === 0) {
    console.log('No pending actions found');
    return;
  }

  for (const a of actions) {
    const c = a.content as Record<string, unknown>;
    console.log('================================================================');
    console.log(`ID: ${a.id}`);
    console.log(`CLIENTE: ${c.customer_name} <${c.customer_email}>`);
    if (c.products) {
      const prods = c.products as Array<{ title: string; quantity: number; price: number }>;
      console.log(`PRODUCTOS: ${prods.map(p => `${p.title} x${p.quantity} (€${p.price})`).join(', ')}`);
    }
    console.log(`ASUNTO: ${a.title}`);
    console.log(`DESCRIPCIÓN: ${a.description}`);
    console.log('---');
    console.log('COPY COMPLETO:');
    console.log(String(c.copy ?? ''));
    console.log('---');
    if (c.recommended_product) {
      console.log(`RECOMENDACIÓN: ${c.recommended_product}`);
    } else {
      console.log('RECOMENDACIÓN: (incluida en el copy)');
    }
    const dc = String(c.discount_code ?? '');
    if (dc && dc !== 'N/A' && dc !== 'undefined') {
      console.log(`DESCUENTO: ${dc} — ${c.discount_value}% (${c.discount_type})`);
    } else {
      console.log('DESCUENTO: ninguno');
    }
    console.log('');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
