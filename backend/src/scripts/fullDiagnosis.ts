import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { shopifyClient } from '../lib/shopify.js';

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

async function main() {
  // 1. Get Shopify connection
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token')
    .eq('account_id', ANDREA_ID)
    .single();

  if (!conn) { console.error('No Shopify connection'); return; }

  const client = shopifyClient(conn.shop_domain, conn.access_token);

  // 2. Get ALL recent orders (last 30 days) for cross-reference
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  const { orders } = await client.getOrders({
    created_at_min: thirtyDaysAgo,
    created_at_max: new Date().toISOString(),
  });

  const validOrders = orders.filter(o => o.financial_status !== 'voided' && !o.cancel_reason);
  const ordersByEmail = new Map<string, typeof validOrders>();
  for (const o of validOrders) {
    const email = o.customer?.email?.toLowerCase();
    if (!email) continue;
    if (!ordersByEmail.has(email)) ordersByEmail.set(email, []);
    ordersByEmail.get(email)!.push(o);
  }

  console.log(`Total valid orders (30d): ${validOrders.length}`);
  console.log(`Unique customer emails: ${ordersByEmail.size}\n`);

  // 3. Get ALL abandoned carts
  const { data: carts } = await supabase
    .from('abandoned_carts')
    .select('id, customer_name, customer_email, total_price, abandoned_at, recovered, recovered_at, recovery_attribution')
    .eq('account_id', ANDREA_ID)
    .order('abandoned_at', { ascending: false });

  // 4. Get ALL pending/completed cart_recovery actions
  const { data: actions } = await supabase
    .from('pending_actions')
    .select('id, type, status, title, created_at, executed_at, content, result')
    .eq('account_id', ANDREA_ID)
    .eq('type', 'cart_recovery')
    .order('created_at', { ascending: false });

  // 5. Get email log
  const { data: emailLogs } = await supabase
    .from('email_log')
    .select('message_id, recipient_email, sent_at, status')
    .eq('account_id', ANDREA_ID)
    .eq('channel', 'email')
    .order('sent_at', { ascending: false })
    .limit(50);

  // Cross-reference
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('ABANDONED CARTS AUDIT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  for (const cart of carts ?? []) {
    const email = cart.customer_email?.toLowerCase();
    const customerOrders = email ? (ordersByEmail.get(email) ?? []) : [];
    const boughtAfterAbandon = customerOrders.filter(o =>
      new Date(o.created_at) > new Date(cart.abandoned_at)
    );
    const hasPurchased = boughtAfterAbandon.length > 0;

    // Find matching actions
    const matchingActions = (actions ?? []).filter(a => {
      const content = a.content as Record<string, unknown>;
      return content.customer_email?.toString().toLowerCase() === email;
    });

    // Find sent emails
    const sentEmails = (emailLogs ?? []).filter(l =>
      l.recipient_email?.toLowerCase() === email
    );

    const status = hasPurchased
      ? (cart.recovered ? '✅ RECOVERED' : '❌ BOUGHT BUT NOT MARKED RECOVERED')
      : (cart.recovered ? '⚠️  MARKED RECOVERED BUT NO ORDER FOUND' : '🛒 STILL ABANDONED');

    console.log(`${status}`);
    console.log(`  Customer: ${cart.customer_name} <${cart.customer_email}>`);
    console.log(`  Cart: €${cart.total_price} | Abandoned: ${cart.abandoned_at}`);
    console.log(`  DB recovered: ${cart.recovered ?? false} | attribution: ${cart.recovery_attribution ?? 'none'}`);

    if (hasPurchased) {
      for (const o of boughtAfterAbandon) {
        const name = `${o.customer?.first_name ?? ''} ${o.customer?.last_name ?? ''}`.trim();
        console.log(`  ORDER: ${o.created_at} | €${o.total_price} | ${o.financial_status} | ${name} | items: ${o.line_items.map(li => li.title).join(', ')}`);
      }
    }

    if (matchingActions.length > 0) {
      for (const a of matchingActions) {
        const result = a.result as Record<string, unknown> | null;
        console.log(`  ACTION: [${a.status}] "${a.title}" | created: ${a.created_at}`);
        if (result?.skipped) console.log(`    SKIPPED: ${result.reason}`);
        if (result?.sent_to) console.log(`    SENT TO: ${result.sent_to} | msg: ${result.message_id}`);
        if (result?.error) console.log(`    ERROR: ${result.error}`);
      }
    }

    if (sentEmails.length > 0) {
      for (const e of sentEmails) {
        console.log(`  EMAIL: ${e.sent_at} | ${e.status} | msg: ${e.message_id}`);
      }
    }

    console.log('');
  }

  // Summary
  const totalCarts = carts?.length ?? 0;
  const boughtButNotRecovered = (carts ?? []).filter(c => {
    const email = c.customer_email?.toLowerCase();
    const customerOrders = email ? (ordersByEmail.get(email) ?? []) : [];
    return customerOrders.some(o => new Date(o.created_at) > new Date(c.abandoned_at)) && !c.recovered;
  });

  const pendingActionsForBuyers = (actions ?? []).filter(a => {
    if (a.status !== 'pending') return false;
    const content = a.content as Record<string, unknown>;
    const email = content.customer_email?.toString().toLowerCase();
    return email && ordersByEmail.has(email);
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Total abandoned carts: ${totalCarts}`);
  console.log(`Bought but NOT marked recovered: ${boughtButNotRecovered.length}`);
  console.log(`Pending actions for customers who already bought: ${pendingActionsForBuyers.length}`);

  if (boughtButNotRecovered.length > 0) {
    console.log('\n❌ CARTS THAT NEED recovery=true:');
    for (const c of boughtButNotRecovered) {
      console.log(`  ${c.customer_name} <${c.customer_email}> — cart from ${cart_date(c.abandoned_at)}`);
    }
  }

  if (pendingActionsForBuyers.length > 0) {
    console.log('\n❌ PENDING ACTIONS TO REJECT:');
    for (const a of pendingActionsForBuyers) {
      const content = a.content as Record<string, unknown>;
      console.log(`  "${a.title}" for ${content.customer_name} — action ${a.id}`);
    }
  }

  // 6. Check the hasCustomerPurchasedRecently logic
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('CHECK LOGIC AUDIT');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('hasCustomerPurchasedRecently:');
  console.log('  - Queries Shopify orders from last 7 days');
  console.log('  - Matches by customer.email (case-insensitive)');
  console.log('  - Excludes voided + cancelled');
  console.log('  - Fail-closed: returns true if Shopify unreachable');
  console.log('');
  console.log('WHERE checks run:');
  console.log('  A) eventDetector.detectNewAbandonedCarts → YES (filters recent order emails)');
  console.log('  B) scheduler.processEventsForAccount → YES (pre-check before action creation)');
  console.log('  C) actions.executeCartRecovery → YES (at send time)');
  console.log('  D) Periodic cleanup of stale pending actions → NO (missing!)');
}

function cart_date(d: string): string {
  return new Date(d).toISOString().slice(0, 16).replace('T', ' ');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
