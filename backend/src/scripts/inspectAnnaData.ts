import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

async function main() {
  const { data } = await supabase
    .from('pending_actions')
    .select('content')
    .eq('type', 'cart_recovery')
    .eq('status', 'completed')
    .filter('result->>message_id', 'eq', '14ce5e02-5acd-4cef-b146-45a539dc9310')
    .single();

  const c = data?.content as Record<string, unknown>;
  console.log('Content keys:', Object.keys(c).join(', '));
  console.log('Type of products:', typeof c.products);
  if (c.products) console.log('Products:', JSON.stringify(c.products).slice(0, 500));
  console.log('Copy:', String(c.copy ?? '').slice(0, 300));
  console.log('Checkout URL:', c.checkout_url);
  console.log('Customer:', c.customer_name);

  // Check abandoned carts
  const { data: carts } = await supabase
    .from('abandoned_carts')
    .select('products, checkout_url, customer_name, customer_email, total_price, currency')
    .eq('account_id', 'e77572ee-83df-43e8-8f69-f143a227fe56')
    .order('abandoned_at', { ascending: false })
    .limit(3);

  console.log('\n=== RECENT ABANDONED CARTS ===');
  for (const cart of carts ?? []) {
    console.log(`${cart.customer_name} (${cart.customer_email}) — €${cart.total_price}`);
    console.log(`  checkout_url: ${cart.checkout_url ?? 'null'}`);
    const prods = cart.products as Array<Record<string, unknown>> | undefined;
    if (prods && Array.isArray(prods)) {
      for (const p of prods.slice(0, 3)) {
        console.log(`  - ${p.title} (${p.quantity}x €${p.price}) image: ${p.image_url ?? 'none'}`);
      }
    }
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
