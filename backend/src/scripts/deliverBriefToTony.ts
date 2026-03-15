import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { sendPushNotification } from '../services/pushNotifier.js';
import { sendBriefEmail } from '../services/emailSender.js';

/**
 * Copy NICOLINA's latest brief to Tony's account and deliver it
 * (push notification + email) so he can see it in the app.
 */
async function main() {
  // 1. Find both accounts
  const [{ data: andrea }, { data: tony }] = await Promise.all([
    supabase.from('accounts').select('id, email, full_name').eq('email', 'andrea@nicolina.es').single(),
    supabase.from('accounts').select('id, email, full_name').eq('email', 'tony@richmondpartner.com').single(),
  ]);

  if (!andrea) { console.error('Andrea account not found'); process.exit(1); }
  if (!tony) { console.error('Tony account not found'); process.exit(1); }

  console.log(`Andrea: ${andrea.full_name} (${andrea.id})`);
  console.log(`Tony: ${tony.full_name} (${tony.id})`);

  // 2. Get NICOLINA's latest brief
  const { data: nicolinaBrief } = await supabase
    .from('intelligence_briefs')
    .select('*')
    .eq('account_id', andrea.id)
    .order('brief_date', { ascending: false })
    .limit(1)
    .single();

  if (!nicolinaBrief) { console.error('No brief found for NICOLINA'); process.exit(1); }
  console.log(`\nNICOLINA brief: ${nicolinaBrief.brief_date} — status: ${nicolinaBrief.status}`);

  // 3. Get NICOLINA's pending actions for this brief
  const { data: nicolinaActions } = await supabase
    .from('pending_actions')
    .select('*')
    .eq('brief_id', nicolinaBrief.id);

  console.log(`Actions to copy: ${nicolinaActions?.length ?? 0}`);

  // 4. Delete any existing brief for Tony on the same date
  const { data: existingBrief } = await supabase
    .from('intelligence_briefs')
    .select('id')
    .eq('account_id', tony.id)
    .eq('brief_date', nicolinaBrief.brief_date)
    .maybeSingle();

  if (existingBrief) {
    await supabase.from('pending_actions').delete().eq('brief_id', existingBrief.id);
    await supabase.from('intelligence_briefs').delete().eq('id', existingBrief.id);
    console.log(`Deleted existing brief for Tony on ${nicolinaBrief.brief_date}`);
  }

  // 5. Copy brief to Tony's account
  const { id: _oldId, account_id: _oldAccountId, ...briefData } = nicolinaBrief;
  const { data: newBrief, error: briefError } = await supabase
    .from('intelligence_briefs')
    .insert({
      ...briefData,
      account_id: tony.id,
    })
    .select('id')
    .single();

  if (briefError || !newBrief) {
    console.error('Failed to copy brief:', briefError?.message);
    process.exit(1);
  }
  console.log(`\nBrief copied to Tony — new ID: ${newBrief.id}`);

  // 6. Copy actions to Tony's account
  if (nicolinaActions && nicolinaActions.length > 0) {
    const actionRows = nicolinaActions.map(a => {
      const { id: _id, account_id: _aid, brief_id: _bid, created_at: _ca, ...actionData } = a;
      return {
        ...actionData,
        account_id: tony.id,
        brief_id: newBrief.id,
      };
    });

    const { error: actionsError } = await supabase
      .from('pending_actions')
      .insert(actionRows);

    if (actionsError) {
      console.error('Failed to copy actions:', actionsError.message);
    } else {
      console.log(`Copied ${actionRows.length} actions to Tony's account`);
    }
  }

  // 7. Send push notification
  console.log('\n── Sending push notification... ──');
  const { count: pushCount } = await supabase
    .from('push_subscriptions')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', tony.id);

  console.log(`Tony has ${pushCount ?? 0} push subscription(s)`);

  if ((pushCount ?? 0) > 0) {
    const y = nicolinaBrief.section_yesterday as { revenue: number; orders: number } | null;
    const revenue = y?.revenue ?? 0;
    const orders = y?.orders ?? 0;
    const n = nicolinaActions?.length ?? 0;

    const pushPayload = {
      title: `NICOLINA — Ayer €${revenue.toFixed(0)} · ${orders} pedidos`,
      body: n > 0
        ? `${n} ${n === 1 ? 'acción preparada' : 'acciones preparadas'}. Toca para aprobar.`
        : 'Tu brief diario está listo — Toca para verlo →',
      url: '/dashboard',
    };

    console.log(`Push payload: ${JSON.stringify(pushPayload, null, 2)}`);
    await sendPushNotification(tony.id, pushPayload);
    console.log('Push notification sent!');
  } else {
    console.log('No push subscriptions — skipping push');
  }

  // 8. Send email
  console.log('\n── Sending brief email... ──');
  try {
    await sendBriefEmail(newBrief.id);
    console.log('Email sent!');
  } catch (err) {
    console.error('Email failed:', (err as Error).message);
  }

  console.log('\n═══════════════════════════════════════');
  console.log('  DONE — Check your app and email!');
  console.log('═══════════════════════════════════════');
  console.log(`Brief date: ${nicolinaBrief.brief_date}`);
  console.log(`Actions: ${nicolinaActions?.length ?? 0}`);
  console.log(`Push: ${(pushCount ?? 0) > 0 ? 'sent' : 'no subscription'}`);
  console.log(`Email: tony@richmondpartner.com`);
}

main().catch(e => { console.error(e); process.exit(1); });
