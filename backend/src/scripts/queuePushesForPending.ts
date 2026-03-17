import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

/**
 * For each pending cart_recovery/welcome_email/reactivation_email action
 * that doesn't have a corresponding push in pending_comms, create one
 * so the admin can approve sending the push to the merchant.
 */
async function main() {
  const MERCHANT_TYPES = ['cart_recovery', 'welcome_email', 'reactivation_email'];

  const { data: pendingActions } = await supabase
    .from('pending_actions')
    .select('id, account_id, type, title, content')
    .eq('status', 'pending')
    .in('type', MERCHANT_TYPES);

  if (!pendingActions || pendingActions.length === 0) {
    console.log('No pending merchant actions found.');
    return;
  }

  console.log(`Found ${pendingActions.length} pending merchant action(s):`);

  for (const action of pendingActions) {
    const content = action.content as Record<string, unknown>;
    const customerName = String(content.customer_name ?? '');
    const customerEmail = String(content.customer_email ?? '');
    const products = String(content.products ?? '');

    let pushBody: string;
    if (action.type === 'cart_recovery') {
      pushBody = `${customerName} dejó ${products || 'productos'} en su carrito. ¿Enviamos el email de recuperación?`;
    } else if (action.type === 'welcome_email') {
      pushBody = `${customerName} hizo su primera compra. ¿Enviamos email de bienvenida?`;
    } else {
      pushBody = `Email preparado para ${customerName}. ¿Lo enviamos?`;
    }

    const { error } = await supabase
      .from('pending_comms')
      .insert({
        account_id: action.account_id,
        type: 'push',
        channel: 'event_push',
        status: 'pending',
        content: {
          title: `Email preparado: ${action.title}`,
          body: pushBody,
          url: '/actions',
          _action_id: action.id,
          _customer_name: customerName,
          _customer_email: customerEmail,
        },
      });

    if (error) {
      console.log(`  ✗ ${customerName}: ${error.message}`);
    } else {
      console.log(`  ✓ Push queued for admin: ${action.title} (${customerName})`);
    }
  }

  // Show final state
  const { data: comms } = await supabase
    .from('pending_comms')
    .select('id, type, channel, status, content')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  console.log(`\n=== PENDING COMMS for admin approval (${comms?.length ?? 0}) ===`);
  for (const c of comms ?? []) {
    const body = (c.content as Record<string, unknown>)?.body ?? '';
    console.log(`  ${c.id.slice(0, 8)} | ${c.channel} | ${String(body).slice(0, 80)}`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
