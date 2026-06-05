/**
 * Nurture Workflow — automated onboarding email sequence for new merchants.
 *
 * Day 0:  "Tu tienda está conectada. Esto vimos."
 * Day 2:  "Primer análisis listo. Esto encontramos."
 * Day 5:  "Ya llevas X días con Sillages. Resultados."
 * Day 10: "Tu trial termina en 4 días." (soft CTA)
 * Day 13: "Mañana termina tu trial." (hard CTA)
 *
 * Only for merchants on free/trial plans. Skips paid merchants.
 * Deduped via nurture_log table.
 *
 * Feature flag: USE_DYNAMIC_NURTURE=true
 * Cron: 0 10 * * * (10:00 UTC daily)
 */

import { supabase } from '../lib/supabase.js';
import { resend } from '../lib/resend.js';
import { env } from '../config/env.js';

const LOG = '[workflow:nurture]';
const FROM = 'Tony from Sillages <tony@sillages.app>';
const REPLY_TO = 'tony@sillages.app';

// ── Sequence definition ────────────────────────────────────────────────────

interface SequenceStep {
  day: number;
  subject: (name: string) => string;
  body: (ctx: NurtureContext) => string;
}

interface NurtureContext {
  firstName: string;
  shopName: string;
  email: string;
  accountId: string;
  daysSinceInstall: number;
  // Data from DB
  totalRevenue?: number;
  totalOrders?: number;
  cartsDetected?: number;
  cartsRecovered?: number;
  topProduct?: string;
  trialEndsAt?: string;
  planId?: string;
}

const SEQUENCE: SequenceStep[] = [
  {
    day: 0,
    subject: (name) => `${name}, tu tienda está conectada`,
    body: (ctx) => `<p>Hola ${ctx.firstName},</p>
<p>Ya estamos conectados con ${ctx.shopName}. Esta noche analizaremos todos los datos de tu tienda y mañana por la mañana tendrás tu primer brief en el email.</p>
<p>El brief te dirá qué vendiste ayer, qué producto es tu estrella, y una cosa concreta que puedes hacer hoy para vender más.</p>
<p>No tienes que configurar nada. Solo abre el email mañana con el café.</p>
<p>Un saludo,<br>Tony</p>`,
  },
  {
    day: 2,
    subject: (name) => `${name}, primer análisis de ${name} listo`,
    body: (ctx) => {
      const revenue = ctx.totalRevenue ? `€${ctx.totalRevenue.toFixed(0)}` : 'tus datos';
      const orders = ctx.totalOrders ?? 0;
      return `<p>Hola ${ctx.firstName},</p>
<p>Ya llevamos 2 días mirando ${ctx.shopName}. Esto es de lo que te habla tu brief cada mañana:</p>
<ul style="padding-left:20px;line-height:2;">
  <li>Lo que vendiste: <strong>${revenue}</strong> en ${orders} pedidos</li>
  ${ctx.topProduct ? `<li>Tu producto estrella: <strong>${ctx.topProduct}</strong></li>` : ''}
</ul>
<p>Cada mañana, en 2 minutos, sabes qué pasó ayer y una cosa concreta para vender más hoy. En lenguaje llano, sin jerga.</p>
<p>Si tienes alguna pregunta, solo responde a este email.</p>
<p>Tony</p>`;
    },
  },
  {
    day: 5,
    subject: () => `5 días con Sillages — esto es lo que hemos visto`,
    body: (ctx) => {
      return `<p>Hola ${ctx.firstName},</p>
<p>Ya llevas 5 días con Sillages en ${ctx.shopName}. Hasta ahora has recibido 5 briefs: cada mañana, qué pasó ayer y el siguiente paso para vender más hoy.</p>
<p>La idea es simple: 2 minutos con el café y sabes dónde está tu tienda sin pelearte con datos ni jerga.</p>
<p>¿Hay algo de tu tienda que te gustaría entender mejor en el brief? Responde a este email y lo miramos.</p>
<p>Tony</p>`;
    },
  },
  {
    day: 10,
    subject: () => `Tu prueba gratuita termina en 4 días`,
    body: (ctx) => `<p>Hola ${ctx.firstName},</p>
<p>Tu prueba gratuita de Sillages termina en 4 días.</p>
<p>Hasta ahora has recibido 10 briefs diarios sobre ${ctx.shopName}. Si te han sido útiles, no tienes que hacer nada — tu plan se activará automáticamente.</p>
<p>Si tienes alguna duda o necesitas ayuda con algo, solo responde a este email.</p>
<p>Tony</p>`,
  },
  {
    day: 13,
    subject: () => `Mañana se activa tu suscripción de Sillages`,
    body: (ctx) => {
      const price = ctx.planId === 'pro' ? '59' : ctx.planId === 'crecimiento' ? '39' : '19';
      return `<p>Hola ${ctx.firstName},</p>
<p>Tu prueba gratuita termina mañana. A partir de ahí, tu plan se activa a <strong>$${price}/mes</strong>.</p>
<p>Si quieres continuar, no tienes que hacer nada.</p>
<p>Si prefieres no continuar, puedes cancelar desde tu admin de Shopify: <strong>Ajustes → Apps → Sillages → Cancelar</strong>.</p>
<p>Gracias por probar Sillages. Si hay algo que pueda mejorar, me encantaría saberlo.</p>
<p>Tony</p>`;
    },
  },
];

// ── Types ──────────────────────────────────────────────────────────────────

export interface NurtureWorkflowResult {
  checked: number;
  sent: number;
  skippedPaid: number;
  skippedAlreadySent: number;
  errors: number;
  totalDuration_ms: number;
}

// ── Main entry ─────────────────────────────────────────────────────────────

// ⏸ PAUSED 2026-06-05 — shares the brief positioning; nurture sending frozen
// until Tony approves the new copy. Re-enable by setting this to false.
const NURTURE_PAUSED = true;

export async function runNurtureWorkflow(): Promise<NurtureWorkflowResult> {
  const start = Date.now();
  if (NURTURE_PAUSED) {
    console.warn(`${LOG} PAUSED — nurture sending frozen pending copy approval. No emails sent.`);
    return { checked: 0, sent: 0, skippedPaid: 0, skippedAlreadySent: 0, errors: 0, totalDuration_ms: Date.now() - start };
  }
  console.log(`${LOG} Starting nurture workflow`);

  let checked = 0;
  let sent = 0;
  let skippedPaid = 0;
  let skippedAlreadySent = 0;
  let errors = 0;

  // Load all accounts with created_at (install_date proxy)
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, email, full_name, subscription_status, trial_ends_at, created_at')
    .or('subscription_status.in.(active,trialing),subscription_status.is.null');

  if (!accounts || accounts.length === 0) {
    console.log(`${LOG} No accounts to nurture`);
    return { checked: 0, sent: 0, skippedPaid: 0, skippedAlreadySent: 0, errors: 0, totalDuration_ms: Date.now() - start };
  }

  // Filter out ghost accounts
  const GHOST_DOMAINS = ['@shopify.com'];
  const GHOST_EMAILS = new Set(['reviewer@sillages.app']);
  const realAccounts = accounts.filter(a => {
    if (GHOST_EMAILS.has(a.email)) return false;
    if (GHOST_DOMAINS.some(d => a.email.endsWith(d))) return false;
    return true;
  });

  for (const account of realAccounts) {
    checked++;

    // Check if on paid plan (skip nurture for paid merchants)
    const { data: sub } = await supabase
      .from('account_subscriptions')
      .select('plan_id, status, is_beta')
      .eq('account_id', account.id)
      .in('status', ['active', 'trialing'])
      .maybeSingle();

    // Skip beta users and paid plans that are already active (not trialing)
    if (sub?.is_beta) { skippedPaid++; continue; }
    const isPaid = sub && sub.status === 'active' && sub.plan_id !== 'starter';
    if (isPaid) { skippedPaid++; continue; }

    // Calculate days since install
    const installDate = new Date(account.created_at);
    const daysSinceInstall = Math.floor((Date.now() - installDate.getTime()) / 86400000);

    // Find which sequence step matches today
    const step = SEQUENCE.find(s => s.day === daysSinceInstall);
    if (!step) continue;

    // Check if already sent for this day
    const { count } = await supabase
      .from('nurture_log')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', account.id)
      .eq('day', step.day);

    if ((count ?? 0) > 0) { skippedAlreadySent++; continue; }

    // Load context data
    const ctx = await buildNurtureContext(account, sub, daysSinceInstall);

    try {
      await sendNurtureEmail(ctx, step);
      sent++;

      // Log to nurture_log
      await supabase.from('nurture_log').insert({
        account_id: account.id,
        day: step.day,
      });

      console.log(`${LOG} [${account.email}] Day ${step.day} sent`);
    } catch (err) {
      console.error(`${LOG} [${account.email}] Day ${step.day} failed: ${(err as Error).message}`);
      errors++;
    }
  }

  const totalDuration = Date.now() - start;

  // Log to workflow_runs
  try {
    await supabase.from('workflow_runs').insert({
      workflow: 'nurture',
      started_at: new Date(start).toISOString(),
      duration_ms: totalDuration,
      merchants_total: checked,
      merchants_succeeded: sent,
      merchants_failed: errors,
      results: { checked, sent, skippedPaid, skippedAlreadySent, errors },
    });
  } catch { /* non-fatal */ }

  console.log(`${LOG} Complete: checked:${checked} sent:${sent} skippedPaid:${skippedPaid} alreadySent:${skippedAlreadySent} errors:${errors} (${totalDuration}ms)`);
  return { checked, sent, skippedPaid, skippedAlreadySent, errors, totalDuration_ms: totalDuration };
}

// ── Build context ──────────────────────────────────────────────────────────

async function buildNurtureContext(
  account: { id: string; email: string; full_name: string | null; trial_ends_at: string | null; created_at: string },
  sub: { plan_id: string } | null,
  daysSinceInstall: number,
): Promise<NurtureContext> {
  const firstName = account.full_name?.split(' ')[0] ?? account.email.split('@')[0];

  // Load shop name
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_name')
    .eq('account_id', account.id)
    .eq('token_status', 'active')
    .order('last_synced_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  const shopName = conn?.shop_name ?? 'tu tienda';

  // Load aggregate data (last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const { data: snaps } = await supabase
    .from('shopify_daily_snapshots')
    .select('total_revenue, total_orders, top_products')
    .eq('account_id', account.id)
    .gte('snapshot_date', sevenDaysAgo);

  let totalRevenue = 0;
  let totalOrders = 0;
  const productSales = new Map<string, number>();
  for (const s of snaps ?? []) {
    totalRevenue += s.total_revenue ?? 0;
    totalOrders += s.total_orders ?? 0;
    for (const p of (s.top_products as Array<{ title: string; quantity_sold: number }>) ?? []) {
      productSales.set(p.title, (productSales.get(p.title) ?? 0) + p.quantity_sold);
    }
  }
  let topProduct: string | undefined;
  let topQty = 0;
  for (const [name, qty] of productSales) { if (qty > topQty) { topQty = qty; topProduct = name; } }

  // Load cart stats
  const { count: cartsDetected } = await supabase
    .from('abandoned_carts')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', account.id);

  const { count: cartsRecovered } = await supabase
    .from('abandoned_carts')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', account.id)
    .eq('recovered', true);

  return {
    firstName,
    shopName,
    email: account.email,
    accountId: account.id,
    daysSinceInstall,
    totalRevenue,
    totalOrders,
    cartsDetected: cartsDetected ?? 0,
    cartsRecovered: cartsRecovered ?? 0,
    topProduct,
    trialEndsAt: account.trial_ends_at ?? undefined,
    planId: sub?.plan_id ?? 'starter',
  };
}

// ── Send email ─────────────────────────────────────────────────────────────

async function sendNurtureEmail(ctx: NurtureContext, step: SequenceStep): Promise<void> {
  const subject = step.subject(ctx.firstName);
  const bodyContent = step.body(ctx);

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F7F1EC;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F1EC;padding:48px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <tr><td style="padding-bottom:32px;">
          <span style="font-size:18px;font-weight:700;letter-spacing:0.08em;color:#3A2332;text-transform:uppercase;">SILLAGES</span>
        </td></tr>
        <tr><td style="color:#3A2332;font-size:16px;line-height:1.7;">
          ${bodyContent}
        </td></tr>
        <tr><td style="padding-top:40px;border-top:1px solid #E8DDD6;">
          <p style="margin:0;color:#8B6F7A;font-size:13px;">
            <a href="https://sillages.app" style="color:#8B6F7A;text-decoration:none;">sillages.app</a> — Tu brief diario con IA
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const { error } = await resend.emails.send({
    from: FROM,
    to: ctx.email,
    reply_to: REPLY_TO,
    subject,
    html,
    headers: {
      'List-Unsubscribe': `<mailto:tony@sillages.app?subject=unsubscribe>`,
    },
  });

  if (error) throw new Error(`Resend: ${(error as Error).message}`);
}
