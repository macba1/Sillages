import { supabase } from '../lib/supabase.js';
import { resend } from '../lib/resend.js';
import { env } from '../config/env.js';
import type { ShopifyDailySnapshot } from '../types.js';

// RULE: Alerts NEVER go to merchants. They go to admin (Tony) ONLY.
// If something is urgent for the merchant, create a pending_action instead.
const ADMIN_EMAIL = 'tony@richmondpartner.com';

export type AlertType = 'TRAFFIC_NOT_CONVERTING' | 'STAR_PRODUCT_OPPORTUNITY';
export type AlertSeverity = 'warning' | 'positive';

interface AlertCandidate {
  type: AlertType;
  title: string;
  message: string;
  severity: AlertSeverity;
}

// ── Alert logic ──────────────────────────────────────────────────────────────

function checkTrafficNotConverting(
  snapshot: ShopifyDailySnapshot,
  previousSnapshot: ShopifyDailySnapshot | null,
  language: 'en' | 'es',
): AlertCandidate | null {
  if (!previousSnapshot) return null;
  if (snapshot.total_orders <= 5) return null;
  if (snapshot.conversion_rate <= 0 || previousSnapshot.conversion_rate <= 0) return null;

  const drop =
    (previousSnapshot.conversion_rate - snapshot.conversion_rate) /
    previousSnapshot.conversion_rate;

  if (drop < 0.25) return null;

  const dropPct = Math.round(drop * 100);
  const fromPct = (previousSnapshot.conversion_rate * 100).toFixed(1);
  const toPct = (snapshot.conversion_rate * 100).toFixed(1);

  if (language === 'es') {
    return {
      type: 'TRAFFIC_NOT_CONVERTING',
      title: 'Recibimos visitas pero no estamos convirtiendo',
      message: `Nuestra tasa de conversión cayó ${dropPct}% respecto a la semana pasada (de ${fromPct}% a ${toPct}%). Estamos recibiendo visitas pero menos personas están comprando. Algo en el proceso de pago o en las páginas de producto puede haber cambiado.`,
      severity: 'warning',
    };
  }

  return {
    type: 'TRAFFIC_NOT_CONVERTING',
    title: "Traffic is up but we're not converting it",
    message: `Our conversion rate dropped ${dropPct}% vs last week (from ${fromPct}% to ${toPct}%). We're getting visitors but fewer of them are buying. Something in the checkout path or product pages may have changed.`,
    severity: 'warning',
  };
}

async function checkStarProductOpportunity(
  accountId: string,
  snapshot: ShopifyDailySnapshot,
  language: 'en' | 'es',
): Promise<AlertCandidate | null> {
  const topProduct = snapshot.top_products?.[0];
  if (!topProduct) return null;

  // Fetch last 2 days of snapshots before today to check 3-day streak
  const { data: recent } = await supabase
    .from('shopify_daily_snapshots')
    .select('top_products, snapshot_date')
    .eq('account_id', accountId)
    .lt('snapshot_date', snapshot.snapshot_date)
    .order('snapshot_date', { ascending: false })
    .limit(2);

  if (!recent || recent.length < 2) return null;

  const allSameTop = recent.every((s) => {
    const products = s.top_products as ShopifyDailySnapshot['top_products'];
    return products?.[0]?.product_id === topProduct.product_id;
  });

  if (!allSameTop) return null;

  if (language === 'es') {
    return {
      type: 'STAR_PRODUCT_OPPORTUNITY',
      title: `${topProduct.title} lleva 3 días seguidos como nuestro producto #1`,
      message: `"${topProduct.title}" ha sido nuestro producto más vendido tres días consecutivos. Esta demanda constante es una señal — considera destacarlo más en nuestra tienda, crear un bundle o revisar el inventario para no quedarnos sin stock.`,
      severity: 'positive',
    };
  }

  return {
    type: 'STAR_PRODUCT_OPPORTUNITY',
    title: `${topProduct.title} has been our #1 product for 3 days straight`,
    message: `"${topProduct.title}" has been our top-selling product for the third consecutive day. This consistent demand is a signal worth acting on — consider highlighting it more prominently, running a bundle, or increasing inventory.`,
    severity: 'positive',
  };
}

// ── Alert email to ADMIN ONLY (never to merchant) ────────────────────────────

async function sendAlertEmailToAdmin(
  accountEmail: string,
  alert: AlertCandidate,
): Promise<void> {
  try {
    await resend.emails.send({
      from: `Sillages Alerts <alerts@sillages.app>`,
      to: ADMIN_EMAIL,
      subject: `[Alert] ${accountEmail}: ${alert.title}`,
      html: `
<div style="max-width:600px;margin:0 auto;padding:32px 24px;font-family:'Helvetica Neue',Arial,sans-serif;">
  <h2 style="color:${alert.severity === 'warning' ? '#D35400' : '#2D6A4F'};margin:0 0 16px;">${alert.severity === 'warning' ? 'ALERT' : 'OPPORTUNITY'} — ${accountEmail}</h2>
  <h3 style="color:#2A1F14;margin:0 0 12px;">${alert.title}</h3>
  <p style="color:#2A1F14;font-size:14px;line-height:1.6;">${alert.message}</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
  <p style="font-size:11px;color:#A89880;">Sillages Alert Engine — admin only, merchants never see this</p>
</div>`,
    });
  } catch (err) {
    console.error(`[alertEngine] Failed to send alert email to admin: ${err instanceof Error ? err.message : err}`);
  }
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function checkAlerts(
  accountId: string,
  toEmail: string,
  snapshot: ShopifyDailySnapshot,
  previousSnapshot: ShopifyDailySnapshot | null,
  language: 'en' | 'es' = 'en',
): Promise<void> {
  const candidates: AlertCandidate[] = [];

  const trafficAlert = checkTrafficNotConverting(snapshot, previousSnapshot, language);
  if (trafficAlert) candidates.push(trafficAlert);

  const starAlert = await checkStarProductOpportunity(accountId, snapshot, language);
  if (starAlert) candidates.push(starAlert);

  for (const candidate of candidates) {
    // Deduplicate: skip if same alert type fired in last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: existing } = await supabase
      .from('alerts')
      .select('id')
      .eq('account_id', accountId)
      .eq('type', candidate.type)
      .gte('created_at', sevenDaysAgo.toISOString())
      .limit(1);

    if (existing && existing.length > 0) continue;

    // Insert alert record
    const { error: insertError } = await supabase.from('alerts').insert({
      account_id: accountId,
      type: candidate.type,
      title: candidate.title,
      message: candidate.message,
      severity: candidate.severity,
    });

    if (insertError) {
      console.error(`[alertEngine] Failed to insert alert ${candidate.type}: ${insertError.message}`);
      continue;
    }

    // Send alert to ADMIN only (never to merchant)
    await sendAlertEmailToAdmin(toEmail, candidate);

    console.log(`[alertEngine] Alert fired — ${candidate.type} for account ${accountId}`);
  }
}
