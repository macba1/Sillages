import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { detectEvents } from '../services/eventDetector.js';
import { generateEventAction } from '../services/eventActionGenerator.js';

const ANDREA_EMAIL = 'andrea@nicolina.es';
const ANDREA_ACCOUNT_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

const ALLOWED_TYPES = ['cart_recovery', 'welcome_email', 'reactivation_email', 'discount_code'];

async function main() {
  console.log('=== STEP 1: CLEAN ALL PENDING ACTIONS & COMMS ===');

  const { error: e1 } = await supabase
    .from('pending_actions')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  console.log(`Deleted pending_actions${e1 ? ` (error: ${e1.message})` : ''}`);

  const { error: e2 } = await supabase
    .from('pending_comms')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  console.log(`Deleted pending_comms${e2 ? ` (error: ${e2.message})` : ''}`);

  // Also clear event_log so events can be re-detected
  const { error: e3 } = await supabase
    .from('event_log')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  console.log(`Deleted event_log${e3 ? ` (error: ${e3.message})` : ''}`);

  console.log('\n=== STEP 2: DISABLE SILLAGESDEV ===');

  // Find sillagesdev account (tony@richmondpartner.com)
  const { data: tonyAccount } = await supabase
    .from('accounts')
    .select('id, email')
    .eq('email', 'tony@richmondpartner.com')
    .single();

  if (tonyAccount) {
    // Set send_enabled = false
    const { error: configErr } = await supabase
      .from('user_intelligence_config')
      .update({ send_enabled: false })
      .eq('account_id', tonyAccount.id);

    if (configErr) {
      console.log(`Config update error: ${configErr.message}`);
    } else {
      console.log(`Disabled send_enabled for sillagesdev (${tonyAccount.id})`);
    }
  } else {
    console.log('sillagesdev account not found');
  }

  console.log('\n=== STEP 3: DETECT EVENTS FOR ANDREA ===');

  // Verify Andrea's account
  const { data: andrea } = await supabase
    .from('accounts')
    .select('id, email, language, full_name')
    .eq('id', ANDREA_ACCOUNT_ID)
    .single();

  if (!andrea) {
    console.error('Andrea account not found!');
    process.exit(1);
  }

  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_name, shop_currency')
    .eq('account_id', ANDREA_ACCOUNT_ID)
    .maybeSingle();

  const storeName = conn?.shop_name ?? 'Nicolina';
  const currency = conn?.shop_currency ?? 'EUR';
  const lang: 'en' | 'es' = andrea.language === 'es' ? 'es' : 'en';

  console.log(`Account: ${andrea.email} (${andrea.id})`);
  console.log(`Store: ${storeName}, Currency: ${currency}, Lang: ${lang}`);

  // Detect events
  const events = await detectEvents(ANDREA_ACCOUNT_ID);
  console.log(`\nDetected ${events.length} event(s):`);
  for (const e of events) {
    console.log(`  - ${e.type}: ${e.key}`);
    if (e.type === 'abandoned_cart') {
      const d = e.data as { customer_name: string; total_value: number; products: Array<{ title: string }> };
      console.log(`    Customer: ${d.customer_name}, Total: €${d.total_value.toFixed(2)}`);
      console.log(`    Products: ${d.products.map(p => p.title).join(', ')}`);
    } else if (e.type === 'new_first_buyer') {
      const d = e.data as { customer_name: string; product_purchased: string; order_total: number };
      console.log(`    Customer: ${d.customer_name}, Product: ${d.product_purchased}, Total: €${d.order_total.toFixed(2)}`);
    } else if (e.type === 'overdue_customer') {
      const d = e.data as { customer_name: string; last_product: string; days_since: number; usual_cycle_days: number };
      console.log(`    Customer: ${d.customer_name}, Favorite: ${d.last_product}, Days since: ${d.days_since}, Cycle: ${d.usual_cycle_days}`);
    }
  }

  console.log('\n=== STEP 4: GENERATE ACTIONS ===');

  const generatedActions: Array<{ id: string; type: string; title: string }> = [];

  for (const event of events) {
    // Map event types to action types
    const actionType = event.type === 'new_first_buyer' ? 'welcome_email'
      : event.type === 'abandoned_cart' ? 'cart_recovery'
      : event.type === 'overdue_customer' ? 'reactivation_email'
      : null;

    if (!actionType || !ALLOWED_TYPES.includes(actionType)) {
      console.log(`  Skipping ${event.type} — not in allowed types`);
      continue;
    }

    console.log(`\nGenerating ${actionType} for ${event.key}...`);
    const actionId = await generateEventAction(ANDREA_ACCOUNT_ID, event, lang, storeName, currency);

    if (actionId) {
      // Fetch the generated action to show
      const { data: action } = await supabase
        .from('pending_actions')
        .select('id, type, title, description, content')
        .eq('id', actionId)
        .single();

      if (action) {
        generatedActions.push({ id: action.id, type: action.type, title: action.title });
        console.log(`  ✓ ${action.type}: "${action.title}"`);
        console.log(`    ${action.description}`);
        const content = action.content as Record<string, unknown>;
        if (content.customer_email) console.log(`    To: ${content.customer_name} <${content.customer_email}>`);
        if (content.recipients) {
          const recipients = content.recipients as Array<{ name: string; email: string }>;
          console.log(`    To: ${recipients.map(r => `${r.name} <${r.email}>`).join(', ')}`);
        }
        if (content.copy) {
          const copy = String(content.copy);
          console.log(`    Copy: ${copy.slice(0, 200)}${copy.length > 200 ? '...' : ''}`);
        }
        if (content.recommended_product) console.log(`    Recommended: ${content.recommended_product}`);
        if (content.discount_code) console.log(`    Discount: ${content.discount_code} (${content.discount_value})`);
      }
    } else {
      console.log(`  ✗ Failed to generate action`);
    }
  }

  // Now generate discount_code actions for overdue customers (>30 days)
  // These aren't auto-detected as events, so query Shopify directly
  console.log('\n=== STEP 5: GENERATE DISCOUNT CODES FOR OLD CUSTOMERS ===');

  // Get overdue customers that we already detected — create discount_code for them
  const overdueEvents = events.filter(e => e.type === 'overdue_customer');

  if (overdueEvents.length > 0) {
    for (const event of overdueEvents) {
      const d = event.data as import('../services/eventDetector.js').OverdueCustomerData;

      if (d.days_since < 30) continue; // only 30+ days

      console.log(`\nGenerating discount_code for ${d.customer_name} (${d.days_since} days)...`);

      // Create a discount_code action using the same overdue data
      const discountEvent: import('../services/eventDetector.js').DetectedEvent = {
        type: 'overdue_customer',
        key: `discount:${d.customer_email}`,
        data: d,
      };

      const actionId = await generateEventAction(ANDREA_ACCOUNT_ID, discountEvent, lang, storeName, currency);
      if (actionId) {
        // Update the type to discount_code
        await supabase
          .from('pending_actions')
          .update({ type: 'discount_code' })
          .eq('id', actionId);

        const { data: action } = await supabase
          .from('pending_actions')
          .select('id, type, title, description, content')
          .eq('id', actionId)
          .single();

        if (action) {
          generatedActions.push({ id: action.id, type: 'discount_code', title: action.title });
          console.log(`  ✓ discount_code: "${action.title}"`);
          const content = action.content as Record<string, unknown>;
          if (content.copy) {
            const copy = String(content.copy);
            console.log(`    Copy: ${copy.slice(0, 200)}${copy.length > 200 ? '...' : ''}`);
          }
        }
      }
    }
  } else {
    console.log('No overdue customers detected — skipping discount codes');
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Generated ${generatedActions.length} action(s):`);
  for (const a of generatedActions) {
    console.log(`  [${a.type}] ${a.title} (${a.id})`);
  }

  // Verify comms_approval is manual for Andrea
  const { data: andreaAccount } = await supabase
    .from('accounts')
    .select('comms_approval')
    .eq('id', ANDREA_ACCOUNT_ID)
    .single();
  console.log(`\nAndrea comms_approval: ${andreaAccount?.comms_approval ?? 'not set'}`);
  console.log('All actions are in pending_actions. Nothing sent — waiting for admin approval.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
