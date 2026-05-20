import { supabase } from '../lib/supabase.js';
import { resend } from '../lib/resend.js';
import { env } from '../config/env.js';

const LOG = '[trial-reminders]';

/**
 * Check all trialing accounts and send reminder emails at day 10 and day 13.
 * Called daily by the scheduler.
 */
export async function runTrialReminders(): Promise<void> {
  console.log(`${LOG} Starting trial reminder check`);

  // Find accounts with subscription_status = 'trialing' and trial_ends_at set
  const { data: accounts, error } = await supabase
    .from('accounts')
    .select('id, email, full_name, trial_ends_at, subscription_status')
    .eq('subscription_status', 'trialing')
    .not('trial_ends_at', 'is', null);

  if (error) {
    console.error(`${LOG} Failed to load trialing accounts: ${error.message}`);
    return;
  }

  if (!accounts || accounts.length === 0) {
    console.log(`${LOG} No trialing accounts found`);
    return;
  }

  console.log(`${LOG} Found ${accounts.length} trialing account(s)`);

  const now = Date.now();

  for (const account of accounts) {
    try {
      const trialEnd = new Date(account.trial_ends_at).getTime();
      const daysLeft = Math.ceil((trialEnd - now) / 86400000);

      // Get plan info for pricing
      const { data: sub } = await supabase
        .from('account_subscriptions')
        .select('plan_id')
        .eq('account_id', account.id)
        .in('status', ['trialing', 'active'])
        .maybeSingle();

      const planPrices: Record<string, number> = {
        basico: 19, crecimiento: 39, pro: 59,
      };
      const planName = sub?.plan_id ?? 'plan';
      const price = planPrices[planName] ?? 0;

      const firstName = account.full_name?.split(' ')[0] ?? 'there';
      const email = account.email;

      if (!email) continue;

      if (daysLeft === 4) {
        // Day 10 reminder (4 days before end)
        const alreadySent = await wasReminderSent(account.id, 'trial_reminder_day10');
        if (alreadySent) continue;

        await sendTrialReminder(email, firstName, 4, planName, price, account.id);
        await markReminderSent(account.id, 'trial_reminder_day10');
        console.log(`${LOG} Sent day-10 reminder to ${email} (${account.id})`);

      } else if (daysLeft === 1) {
        // Day 13 reminder (1 day before end)
        const alreadySent = await wasReminderSent(account.id, 'trial_reminder_day13');
        if (alreadySent) continue;

        await sendTrialReminder(email, firstName, 1, planName, price, account.id);
        await markReminderSent(account.id, 'trial_reminder_day13');
        console.log(`${LOG} Sent day-13 reminder to ${email} (${account.id})`);

      } else if (daysLeft <= 0) {
        console.log(`${LOG} Trial expired for ${account.id} (${daysLeft} days) — Shopify webhook should handle status change`);
      }
    } catch (err) {
      console.error(`${LOG} Error processing ${account.id}: ${(err as Error).message}`);
    }
  }

  console.log(`${LOG} Trial reminder check complete`);
}

// ── Dedup helpers ──────────────────────────────────────────────────────────

async function wasReminderSent(accountId: string, reminderType: string): Promise<boolean> {
  const { count } = await supabase
    .from('email_log')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('channel', reminderType)
    .eq('status', 'sent');

  return (count ?? 0) > 0;
}

async function markReminderSent(accountId: string, reminderType: string): Promise<void> {
  try {
    await supabase.from('email_log').insert({
      account_id: accountId,
      channel: reminderType,
      status: 'sent',
      sent_at: new Date().toISOString(),
    });
  } catch { /* non-fatal — dedup table might not have all columns */ }
}

// ── Email builder ──────────────────────────────────────────────────────────

async function sendTrialReminder(
  to: string,
  firstName: string,
  daysLeft: number,
  planName: string,
  price: number,
  accountId: string,
): Promise<void> {
  const subject = daysLeft === 4
    ? 'Tu prueba gratuita de Sillages termina en 4 días'
    : 'Mañana se activa tu suscripción de Sillages';

  const bodyParagraphs = daysLeft === 4
    ? `
      <p style="margin:0 0 20px;">
        Solo quería avisarte: tu prueba gratuita de Sillages termina en <strong>4 días</strong>.
      </p>
      <p style="margin:0 0 20px;">
        Espero que estés sacándole partido a los informes diarios. Si tienes alguna duda o necesitas
        ayuda para configurar algo, solo tienes que responder a este email — estoy aquí para ayudar.
      </p>
      <p style="margin:0 0 20px;">
        Si todo va bien, no tienes que hacer nada. Tu plan ${planName} ($${price}/mes) se activará
        automáticamente cuando termine la prueba.
      </p>
    `
    : `
      <p style="margin:0 0 20px;">
        Tu prueba gratuita de Sillages termina <strong>mañana</strong>. A partir de ese momento,
        tu plan ${planName} se activará a <strong>$${price}/mes</strong>.
      </p>
      <p style="margin:0 0 20px;">
        Si quieres continuar, no tienes que hacer nada — todo se gestiona automáticamente a través
        de tu factura de Shopify.
      </p>
      <p style="margin:0 0 20px;">
        Si prefieres no continuar, puedes cancelar desde tu admin de Shopify:
        <strong>Ajustes → Apps y canales de venta → Sillages → Cancelar suscripción</strong>.
      </p>
      <p style="margin:0 0 20px;">
        Sea lo que sea, gracias por probar Sillages. Si hay algo que podamos mejorar,
        me encantaría saberlo.
      </p>
    `;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#F7F1EC;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F1EC;padding:48px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
          <tr>
            <td style="padding-bottom:36px;">
              <span style="font-size:22px;font-weight:700;letter-spacing:0.08em;color:#3A2332;text-transform:uppercase;">Sillages</span>
            </td>
          </tr>
          <tr>
            <td style="color:#3A2332;font-size:17px;line-height:1.7;">
              <p style="margin:0 0 20px;">Hola ${firstName},</p>
              ${bodyParagraphs}
              <p style="margin:0 0 20px;">Un saludo,</p>
              <p style="margin:0;">
                Tony<br />
                <span style="color:#8B6F7A;font-size:15px;">Founder, Sillages</span>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding-top:48px;border-top:1px solid #E8DDD6;">
              <p style="margin:0;color:#8B6F7A;font-size:13px;">
                Recibes este email porque tienes una prueba gratuita activa en Sillages.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to,
    subject,
    html,
  });
}
