import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

async function main() {
  // 1. Get all recovered carts
  const { data: recovered } = await supabase
    .from('abandoned_carts')
    .select('*')
    .eq('account_id', ANDREA_ID)
    .eq('recovered', true)
    .order('recovered_at', { ascending: false });

  console.log(`=== RECOVERED CARTS (${recovered?.length ?? 0}) ===\n`);

  for (const cart of recovered ?? []) {
    console.log(`Customer: ${cart.customer_name} <${cart.customer_email}>`);
    console.log(`  Abandoned at:  ${cart.abandoned_at}`);
    console.log(`  Recovered at:  ${cart.recovered_at}`);
    console.log(`  Order ID:      ${cart.recovery_order_id ?? 'N/A'}`);
    console.log(`  Revenue:       €${cart.recovery_revenue ?? cart.total_price}`);
    console.log(`  Action ID:     ${cart.recovery_action_id ?? 'NONE — no action linked'}`);
    console.log(`  Products:      ${(cart.products as Array<{title: string}>)?.map(p => p.title).join(', ')}`);

    // Check if we sent an email BEFORE the recovery
    if (cart.recovery_action_id) {
      const { data: action } = await supabase
        .from('pending_actions')
        .select('id, status, created_at, approved_at, executed_at, result')
        .eq('id', cart.recovery_action_id)
        .single();

      if (action) {
        const result = action.result as Record<string, unknown> | null;
        const skipped = result?.skipped === true;
        const sentTo = result?.sent_to as string | undefined;
        console.log(`  Action status: ${action.status}`);
        console.log(`  Action created: ${action.created_at}`);
        console.log(`  Action executed: ${action.executed_at ?? 'never'}`);
        if (skipped) {
          console.log(`  ⚠️  SKIPPED: ${result?.reason}`);
        } else if (sentTo) {
          console.log(`  ✉️  EMAIL SENT to ${sentTo}`);
          // Check timing: was email sent BEFORE recovery?
          if (action.executed_at && cart.recovered_at) {
            const emailTime = new Date(action.executed_at).getTime();
            const recoveryTime = new Date(cart.recovered_at).getTime();
            if (emailTime < recoveryTime) {
              console.log(`  ✅ EMAIL WAS SENT BEFORE PURCHASE — possible attribution`);
            } else {
              console.log(`  ❌ EMAIL SENT AFTER PURCHASE — not our merit`);
            }
          }
        }
      }
    } else {
      // Check if ANY cart_recovery action existed for this customer
      const { data: anyAction } = await supabase
        .from('pending_actions')
        .select('id, status, created_at, executed_at, result')
        .eq('account_id', ANDREA_ID)
        .eq('type', 'cart_recovery')
        .filter('content->>customer_email', 'eq', cart.customer_email)
        .limit(5);

      if (anyAction && anyAction.length > 0) {
        for (const a of anyAction) {
          const result = a.result as Record<string, unknown> | null;
          const sentTo = result?.sent_to;
          console.log(`  Found action ${a.id.slice(0,8)}: ${a.status} | created ${a.created_at?.slice(0,16)} | executed ${a.executed_at?.slice(0,16) ?? 'never'}`);
          if (sentTo) console.log(`    → EMAIL SENT to ${sentTo}`);
          if (result?.skipped) console.log(`    → SKIPPED: ${result.reason}`);
        }
      } else {
        console.log(`  🔍 NO action ever created for this customer`);
      }
    }

    // Also check email_log for any email sent to this customer
    // (emails go to customer, not merchant — check by looking at action results)

    console.log('');
  }

  // Summary
  console.log('=== SUMMARY ===');
  let emailSentBefore = 0;
  let organic = 0;
  let totalRevenue = 0;

  for (const cart of recovered ?? []) {
    const rev = cart.recovery_revenue ?? cart.total_price ?? 0;
    totalRevenue += Number(rev);

    if (cart.recovery_action_id) {
      const { data: action } = await supabase
        .from('pending_actions')
        .select('executed_at, result')
        .eq('id', cart.recovery_action_id)
        .single();

      const result = action?.result as Record<string, unknown> | null;
      if (result?.sent_to && action?.executed_at && cart.recovered_at) {
        const emailTime = new Date(action.executed_at).getTime();
        const recoveryTime = new Date(cart.recovered_at).getTime();
        if (emailTime < recoveryTime) {
          emailSentBefore++;
          continue;
        }
      }
    }
    organic++;
  }

  console.log(`Total recovered: ${recovered?.length ?? 0}`);
  console.log(`Total revenue: €${totalRevenue.toFixed(2)}`);
  console.log(`Email sent BEFORE purchase: ${emailSentBefore} (our merit)`);
  console.log(`Organic (bought on their own): ${organic} (not our merit)`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
