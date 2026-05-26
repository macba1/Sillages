import { format, parseISO } from 'date-fns';
import { es as esLocale } from 'date-fns/locale';
import { resend } from '../lib/resend.js';
import { supabase } from '../lib/supabase.js';
import { env } from '../config/env.js';
import type { IntelligenceBrief, Account } from '../types.js';
import type { BrandConfig } from './emailTemplates.js';

// ── i18n labels ──────────────────────────────────────────────────────────────

const labels = {
  en: {
    yesterday: 'Yesterday',
    revenue: 'Revenue',
    orders: 'Orders',
    aov: 'Avg. order',
    topProduct: 'Top Product',
    whatsWorking: "What's Working",
    upcoming: "What's Coming This Week",
    needsAttention: 'Needs Attention',
    moneyLeft: 'Money Left on the Table',
    yourCustomers: 'Your Customers',
    oneThingToday: 'Your One Thing for Today',
    thisWeek: 'This Week So Far',
    weekRevenue: 'Week revenue',
    weekOrders: 'Week orders',
    weekTopProduct: 'Top product',
    recurringRate: 'Returning',
    openDashboard: 'Open your dashboard',
    vsLastWeek: 'vs last week',
    defaultSubject: 'Your daily brief',
    noData: '—',
    cartRecoveryAuto: 'We already sent a recovery email.',
    cartRecoveryApprove: 'Approve the email in the app.',
    cartRecoveryUpgrade: 'Upgrade to Crecimiento to recover these carts automatically.',
  },
  es: {
    yesterday: 'Ayer',
    revenue: 'Ingresos',
    orders: 'Pedidos',
    aov: 'Ticket medio',
    topProduct: 'Producto estrella',
    whatsWorking: 'Lo que funciona',
    upcoming: 'Lo que viene esta semana',
    needsAttention: 'Necesita atención',
    moneyLeft: 'Dinero sobre la mesa',
    yourCustomers: 'Tus clientes',
    oneThingToday: 'Tu acción de hoy',
    thisWeek: 'Esta semana',
    weekRevenue: 'Ingresos semana',
    weekOrders: 'Pedidos semana',
    weekTopProduct: 'Top producto',
    recurringRate: 'Recurrentes',
    openDashboard: 'Abrir tu dashboard',
    vsLastWeek: 'vs semana pasada',
    defaultSubject: 'Tu brief diario',
    noData: '—',
    cartRecoveryAuto: 'Ya le hemos enviado un email de recuperación.',
    cartRecoveryApprove: 'Aprueba el email en la app.',
    cartRecoveryUpgrade: 'Activa el plan Crecimiento para recuperar estos carritos automáticamente.',
  },
} as const;

type Lang = keyof typeof labels;

// ── Visual constants (same as emailTemplates.ts) ──────────────────────────

const BG_OUTER = '#F7F1EC';
const TEXT_DARK = '#3A2332';
const TEXT_MUTED = '#6B5460';
const CARD_BORDER = '#EDE5DC';
const DEFAULT_PRIMARY = '#C9964A';
const GREEN = '#2D6A4F';
const RED = '#DC2626';
const AMBER = '#B45309';

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Send the daily intelligence brief by email to the merchant.
 * Uses the branded template with store logo, colors, and contact info.
 */
export async function sendBriefEmail(briefId: string): Promise<void> {
  const { data: brief, error: briefErr } = await supabase
    .from('intelligence_briefs')
    .select('*')
    .eq('id', briefId)
    .single();

  if (briefErr || !brief) throw new Error(`Brief not found: ${briefErr?.message}`);

  const b = brief as IntelligenceBrief;
  if (b.status !== 'ready') throw new Error(`Brief ${briefId} is not ready (status: ${b.status})`);

  const [{ data: account, error: accErr }, { data: shopConn }, { data: brandProfile }] = await Promise.all([
    supabase.from('accounts').select('email, full_name, language').eq('id', b.account_id).single(),
    supabase.from('shopify_connections').select('shop_name, shop_currency, shop_domain').eq('account_id', b.account_id).maybeSingle(),
    supabase.from('brand_profiles').select('logo_url, primary_color, shop_url, contact_email, contact_phone, contact_address, social_links').eq('account_id', b.account_id).maybeSingle(),
  ]);

  if (accErr || !account) throw new Error(`Account not found: ${accErr?.message}`);

  const acc = account as Pick<Account, 'email' | 'full_name'> & { language?: string };
  const ownerName = acc.full_name?.split(' ')[0] ?? acc.email.split('@')[0];
  const lang: Lang = acc.language === 'es' ? 'es' : 'en';
  const currency: string = (shopConn as { shop_currency: string | null } | null)?.shop_currency ?? 'USD';

  const rawShopName: string = (shopConn as { shop_name: string | null } | null)?.shop_name ?? ownerName;
  const emailSlug = rawShopName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const fromAddress = `${emailSlug}@sillages.app`;
  const fromField = `${rawShopName} via Sillages <${fromAddress}>`;

  // Build brand config for template
  const brand: BrandConfig = {
    storeName: rawShopName,
    logoUrl: brandProfile?.logo_url ?? undefined,
    primaryColor: brandProfile?.primary_color ?? undefined,
    shopUrl: brandProfile?.shop_url ?? undefined,
    contactEmail: brandProfile?.contact_email ?? undefined,
    contactPhone: brandProfile?.contact_phone ?? undefined,
    contactAddress: brandProfile?.contact_address ?? undefined,
    socialLinks: brandProfile?.social_links as BrandConfig['socialLinks'] ?? undefined,
  };

  // Load week-to-date data for "This Week" section
  const weekData = await loadWeekToDate(b.account_id, b.brief_date, currency);

  // Load plan info for cart recovery upsell
  const { data: sub } = await supabase
    .from('account_subscriptions')
    .select('plan_id')
    .eq('account_id', b.account_id)
    .in('status', ['active', 'trialing'])
    .maybeSingle();

  const { data: config } = await supabase
    .from('user_intelligence_config')
    .select('auto_approve_cart_recovery')
    .eq('account_id', b.account_id)
    .maybeSingle();

  const planId = sub?.plan_id ?? 'starter';
  const autoApprove = config?.auto_approve_cart_recovery ?? false;

  const t = labels[lang];
  const subjectHeadline = b.section_signal?.headline ?? b.section_yesterday?.summary?.slice(0, 60) ?? t.defaultSubject;
  const subject = `${ownerName}, ${subjectHeadline}`;

  const html = buildBriefEmailHtml({ brief: b, ownerName, lang, currency, brand, weekData, planId, autoApprove });

  // Unsubscribe headers
  const { buildUnsubscribeUrl } = await import('../lib/unsubscribe.js');
  const unsubscribeUrl = buildUnsubscribeUrl(b.account_id, acc.email);
  const headers: Record<string, string> = {};
  headers['List-Unsubscribe'] = `<${unsubscribeUrl}>`;
  headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';

  const { data: sent, error: sendErr } = await resend.emails.send({
    from: fromField,
    to: acc.email,
    subject,
    html,
    headers,
  });

  if (sendErr || !sent) throw new Error(`Resend error: ${(sendErr as Error)?.message}`);

  await supabase
    .from('intelligence_briefs')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      email_message_id: sent.id,
    })
    .eq('id', briefId);

  console.log(`[emailSender] Sent brief ${briefId} to ${acc.email}`);
}

// ── Week-to-date data ─────────────────────────────────────────────────────────

interface WeekToDate {
  revenue: number;
  orders: number;
  topProduct: string | null;
  returningRate: number;
  daysInWeek: number;
}

async function loadWeekToDate(accountId: string, briefDate: string, _currency: string): Promise<WeekToDate> {
  // Find Monday of this week
  const briefDateObj = new Date(briefDate + 'T12:00:00Z');
  const dayOfWeek = briefDateObj.getUTCDay(); // 0=Sun, 1=Mon...
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(briefDateObj.getTime() - mondayOffset * 86400000);
  const mondayStr = monday.toISOString().slice(0, 10);

  const { data: weekSnaps } = await supabase
    .from('shopify_daily_snapshots')
    .select('total_revenue, total_orders, returning_customer_rate, top_products')
    .eq('account_id', accountId)
    .gte('snapshot_date', mondayStr)
    .lte('snapshot_date', briefDate)
    .order('snapshot_date');

  if (!weekSnaps || weekSnaps.length === 0) {
    return { revenue: 0, orders: 0, topProduct: null, returningRate: 0, daysInWeek: 0 };
  }

  let totalRev = 0;
  let totalOrd = 0;
  let totalRetRate = 0;
  const productSales = new Map<string, number>();

  for (const s of weekSnaps) {
    totalRev += s.total_revenue;
    totalOrd += s.total_orders;
    totalRetRate += s.returning_customer_rate ?? 0;
    for (const p of (s.top_products as Array<{ title: string; quantity_sold: number }>) ?? []) {
      productSales.set(p.title, (productSales.get(p.title) ?? 0) + p.quantity_sold);
    }
  }

  let topProduct: string | null = null;
  let topQty = 0;
  for (const [name, qty] of productSales) {
    if (qty > topQty) { topQty = qty; topProduct = name; }
  }

  return {
    revenue: totalRev,
    orders: totalOrd,
    topProduct,
    returningRate: weekSnaps.length > 0 ? totalRetRate / weekSnaps.length : 0,
    daysInWeek: weekSnaps.length,
  };
}

// ── Branded brief email HTML ──────────────────────────────────────────────────

interface BuildBriefInput {
  brief: IntelligenceBrief;
  ownerName: string;
  lang: Lang;
  currency: string;
  brand: BrandConfig;
  weekData: WeekToDate;
  planId: string;
  autoApprove: boolean;
}

function buildBriefEmailHtml({ brief, ownerName, lang, currency, brand, weekData, planId, autoApprove }: BuildBriefInput): string {
  const t = labels[lang];
  const locale = lang === 'es' ? esLocale : undefined;
  const dateStr = format(parseISO(brief.brief_date), 'EEEE, d MMMM', { locale });
  const accent = brand.primaryColor ?? DEFAULT_PRIMARY;

  const y = brief.section_yesterday;
  const ww = brief.section_whats_working;
  const up = brief.section_upcoming;
  const wnw = brief.section_whats_not_working;
  const sig = brief.section_signal;
  const act = brief.section_activation;

  function fmt(n: number, style: 'currency' | 'decimal' = 'decimal'): string {
    if (style === 'currency') {
      return new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
    }
    return new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-US').format(n);
  }

  function wowBadge(pct: number | null | undefined): string {
    if (pct == null) return '';
    const color = pct >= 0 ? GREEN : RED;
    const arrow = pct >= 0 ? '&#9650;' : '&#9660;';
    return `<span style="font-size:11px;color:${color};font-weight:600;margin-left:4px;">${arrow} ${Math.abs(pct).toFixed(0)}%</span>`;
  }

  // ── Logo header ──────────────────────────────────────────────────────────
  const bigLogoUrl = brand.logoUrl?.replace(/_\d+x\./, '_400x.');
  const shopUrl = brand.shopUrl ?? '#';
  const headerContent = bigLogoUrl
    ? `<a href="${shopUrl}" target="_blank" style="text-decoration:none;">
        <img src="${bigLogoUrl}" alt="${brand.storeName}" width="160" style="display:block;width:160px;height:auto;border:0;" />
      </a>`
    : `<a href="${shopUrl}" target="_blank" style="text-decoration:none;font-size:20px;font-weight:700;color:${TEXT_DARK};">${brand.storeName}</a>`;

  // ── Section builders ──────────────────────────────────────────────────────

  const sectionLabel = (text: string) =>
    `<tr><td style="padding:24px 32px 8px;"><p style="margin:0;font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#9A8090;">${text}</p></td></tr>`;

  const borderedCard = (borderColor: string, content: string) =>
    `<tr><td style="padding:0 32px 16px;">
      <div style="border-left:3px solid ${borderColor};padding:12px 16px;background:#FAFAFA;border-radius:0 8px 8px 0;">
        ${content}
      </div>
    </td></tr>`;

  // ── Build sections ────────────────────────────────────────────────────────
  let bodyContent = '';

  // DATE
  bodyContent += `<tr><td style="padding:20px 32px 4px;">
    <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#9A8090;">${dateStr}</p>
  </td></tr>`;

  // SECTION 1: YESTERDAY
  if (y) {
    bodyContent += `<tr><td style="padding:8px 32px 16px;">
      <p style="margin:0 0 16px;font-size:15px;color:${TEXT_DARK};line-height:1.6;">${y.summary}</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="width:33%;vertical-align:top;">
            <p style="margin:0 0 2px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">${t.revenue}</p>
            <p style="margin:0;font-size:20px;font-weight:700;color:${TEXT_DARK};">${fmt(y.revenue, 'currency')}${wowBadge(y.wow?.revenue_pct)}</p>
          </td>
          <td style="width:33%;vertical-align:top;">
            <p style="margin:0 0 2px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">${t.orders}</p>
            <p style="margin:0;font-size:20px;font-weight:700;color:${TEXT_DARK};">${fmt(y.orders)}${wowBadge(y.wow?.orders_pct)}</p>
          </td>
          <td style="width:33%;vertical-align:top;">
            <p style="margin:0 0 2px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">${t.aov}</p>
            <p style="margin:0;font-size:20px;font-weight:700;color:${TEXT_DARK};">${fmt(y.aov, 'currency')}${wowBadge(y.wow?.aov_pct)}</p>
          </td>
        </tr>
      </table>
    </td></tr>`;
    bodyContent += `<tr><td style="padding:0 32px 16px;"><div style="height:1px;background:${CARD_BORDER};"></div></td></tr>`;
  }

  // SECTION 2: MONEY LEFT ON THE TABLE (conditional — abandoned carts)
  const hasCartMention = wnw?.items?.some(item =>
    item.insight?.toLowerCase().includes('carrito') ||
    item.insight?.toLowerCase().includes('cart') ||
    item.insight?.toLowerCase().includes('abandonó') ||
    item.insight?.toLowerCase().includes('abandon'));

  if (hasCartMention && wnw?.items) {
    const cartItem = wnw.items.find(item =>
      item.insight?.toLowerCase().includes('carrito') ||
      item.insight?.toLowerCase().includes('cart') ||
      item.insight?.toLowerCase().includes('abandonó') ||
      item.insight?.toLowerCase().includes('abandon')) ?? wnw.items[0];

    let cartNote = '';
    if (['crecimiento', 'pro'].includes(planId)) {
      cartNote = autoApprove ? t.cartRecoveryAuto : t.cartRecoveryApprove;
    } else {
      cartNote = t.cartRecoveryUpgrade;
    }

    bodyContent += sectionLabel(t.moneyLeft);
    bodyContent += borderedCard(AMBER,
      `<p style="margin:0 0 8px;font-size:13px;color:${TEXT_DARK};line-height:1.6;">${cartItem.insight}</p>
       <p style="margin:0;font-size:12px;color:${AMBER};font-weight:600;">${cartNote}</p>`);
  }

  // SECTION 3: WHAT'S WORKING (conditional)
  if (ww?.items && ww.items.length > 0) {
    bodyContent += sectionLabel(t.whatsWorking);
    for (const item of ww.items) {
      bodyContent += borderedCard(GREEN,
        `<p style="margin:0 0 2px;font-size:13px;font-weight:600;color:${TEXT_DARK};">${item.title}${item.metric ? ` — ${item.metric}` : ''}</p>
         <p style="margin:0;font-size:13px;color:${TEXT_MUTED};line-height:1.5;">${item.insight}</p>`);
    }
  }

  // SECTION 4: YOUR CUSTOMERS
  if (sig) {
    bodyContent += sectionLabel(t.yourCustomers);
    bodyContent += `<tr><td style="padding:0 32px 16px;">
      <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:${TEXT_DARK};">${sig.headline}</p>
      <p style="margin:0;font-size:13px;color:${TEXT_MUTED};line-height:1.6;">${sig.market_context}</p>
    </td></tr>`;
  }

  // SECTION 5: PATTERN / UPCOMING
  if (up?.items && up.items.length > 0) {
    bodyContent += sectionLabel(t.upcoming);
    for (const item of up.items) {
      bodyContent += `<tr><td style="padding:0 32px 8px;">
        <div style="background:#FDF8F0;border-radius:8px;border:1px solid ${CARD_BORDER};padding:12px 16px;">
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${TEXT_DARK};">${item.pattern}</p>
          <p style="margin:0 0 8px;font-size:13px;color:${TEXT_MUTED};line-height:1.5;">${item.action}</p>
          ${item.ready_copy ? `<div style="background:#FFFFFF;border-radius:6px;border:1px solid ${CARD_BORDER};padding:10px 12px;margin-top:4px;">
            <p style="margin:0;font-size:12px;color:${TEXT_DARK};line-height:1.5;font-style:italic;">${item.ready_copy}</p>
          </div>` : ''}
        </div>
      </td></tr>`;
    }
  }

  // SECTION 6: NEEDS ATTENTION (conditional — significant WoW decline)
  const wowRevPct = y?.wow?.revenue_pct;
  const hasSignificantDecline = wowRevPct != null && wowRevPct < -20;
  if (hasSignificantDecline) {
    const nonCartItems = wnw?.items?.filter(item =>
      !item.insight?.toLowerCase().includes('carrito') &&
      !item.insight?.toLowerCase().includes('cart')) ?? [];
    if (nonCartItems.length > 0) {
      bodyContent += sectionLabel(t.needsAttention);
      for (const item of nonCartItems) {
        bodyContent += borderedCard('#EF4444',
          `<p style="margin:0 0 2px;font-size:13px;font-weight:600;color:${TEXT_DARK};">${item.title}${item.metric ? ` — ${item.metric}` : ''}</p>
           <p style="margin:0;font-size:13px;color:${TEXT_MUTED};line-height:1.5;">${item.insight}</p>`);
      }
    }
  }

  // SECTION 7: YOUR ONE THING FOR TODAY (always)
  if (act) {
    bodyContent += sectionLabel(t.oneThingToday);
    const howSteps = act.how?.map((step: string, i: number) => `
      <tr>
        <td style="padding:4px 0;">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:22px;vertical-align:top;">
              <div style="width:18px;height:18px;background:${accent};border-radius:50%;text-align:center;line-height:18px;font-size:10px;font-weight:700;color:#FFFFFF;">${i + 1}</div>
            </td>
            <td style="padding-left:8px;font-size:13px;color:${TEXT_DARK};line-height:1.5;">${step}</td>
          </tr></table>
        </td>
      </tr>`).join('') ?? '';

    bodyContent += `<tr><td style="padding:0 32px 16px;">
      <div style="border-left:3px solid ${accent};padding:12px 16px;background:#FAFAFA;border-radius:0 8px 8px 0;">
        <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:${TEXT_DARK};">${act.what}</p>
        <p style="margin:0 0 12px;font-size:13px;color:${TEXT_MUTED};line-height:1.5;">${act.why}</p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0">${howSteps}</table>
        ${act.expected_impact ? `<p style="margin:12px 0 0;font-size:12px;font-weight:600;color:${accent};">${act.expected_impact}</p>` : ''}
      </div>
    </td></tr>`;
  }

  // SECTION 8: THIS WEEK SO FAR
  if (weekData.daysInWeek > 0) {
    bodyContent += sectionLabel(t.thisWeek);
    bodyContent += `<tr><td style="padding:0 32px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAFAFA;border-radius:8px;border:1px solid ${CARD_BORDER};">
        <tr>
          <td style="padding:12px 16px;width:25%;vertical-align:top;">
            <p style="margin:0 0 2px;font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">${t.weekRevenue}</p>
            <p style="margin:0;font-size:16px;font-weight:700;color:${TEXT_DARK};">${fmt(weekData.revenue, 'currency')}</p>
          </td>
          <td style="padding:12px 16px;width:25%;vertical-align:top;">
            <p style="margin:0 0 2px;font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">${t.weekOrders}</p>
            <p style="margin:0;font-size:16px;font-weight:700;color:${TEXT_DARK};">${fmt(weekData.orders)}</p>
          </td>
          <td style="padding:12px 16px;width:25%;vertical-align:top;">
            <p style="margin:0 0 2px;font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">${t.weekTopProduct}</p>
            <p style="margin:0;font-size:13px;font-weight:600;color:${TEXT_DARK};">${weekData.topProduct ?? t.noData}</p>
          </td>
          <td style="padding:12px 16px;width:25%;vertical-align:top;">
            <p style="margin:0 0 2px;font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">${t.recurringRate}</p>
            <p style="margin:0;font-size:16px;font-weight:700;color:${TEXT_DARK};">${(weekData.returningRate * 100).toFixed(0)}%</p>
          </td>
        </tr>
      </table>
    </td></tr>`;
  }

  // CTA BUTTON
  bodyContent += `<tr><td style="padding:8px 32px 24px;" align="center">
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
      <tr>
        <td align="center" style="background:${accent};border-radius:8px;">
          <a href="${env.FRONTEND_URL}/dashboard" target="_blank" style="display:inline-block;padding:14px 40px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
            ${t.openDashboard} &rarr;
          </a>
        </td>
      </tr>
    </table>
  </td></tr>`;

  // ── Footer: contact + social + unsubscribe ──────────────────────────────
  const contactLines: string[] = [];
  if (brand.contactAddress) contactLines.push(brand.contactAddress);
  if (brand.contactPhone) contactLines.push(`Tel: ${brand.contactPhone}`);
  if (brand.contactEmail) contactLines.push(brand.contactEmail);
  const contactBlock = contactLines.length > 0
    ? `<p style="margin:0 0 8px;font-size:12px;color:#9A8090;line-height:1.6;">${contactLines.join(' · ')}</p>`
    : '';

  const socialParts: string[] = [];
  if (brand.socialLinks?.instagram) socialParts.push(`<a href="${brand.socialLinks.instagram}" style="color:#9A8090;text-decoration:none;">Instagram</a>`);
  if (brand.socialLinks?.facebook) socialParts.push(`<a href="${brand.socialLinks.facebook}" style="color:#9A8090;text-decoration:none;">Facebook</a>`);
  if (brand.socialLinks?.tiktok) socialParts.push(`<a href="${brand.socialLinks.tiktok}" style="color:#9A8090;text-decoration:none;">TikTok</a>`);
  const socialBlock = socialParts.length > 0
    ? `<p style="margin:0 0 12px;font-size:12px;color:#9A8090;">${socialParts.join(' · ')}</p>`
    : '';

  // ── Assemble full email ─────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
</head>
<body style="margin:0;padding:0;background:${BG_OUTER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG_OUTER};">
    <tr>
      <td align="center" style="padding:32px 16px 48px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

          <!-- Header: store logo -->
          <tr>
            <td style="background:#FFFFFF;border-radius:12px 12px 0 0;border:1px solid ${CARD_BORDER};border-bottom:none;padding:24px 32px;" align="center">
              ${headerContent}
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#FFFFFF;border-left:1px solid ${CARD_BORDER};border-right:1px solid ${CARD_BORDER};">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${bodyContent}
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#FAFAFA;border-radius:0 0 12px 12px;border:1px solid ${CARD_BORDER};border-top:none;padding:24px 32px;" align="center">
              <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:${TEXT_DARK};">${brand.storeName}</p>
              ${contactBlock}
              ${socialBlock}
              <p style="margin:0 0 4px;font-size:11px;color:#C4B0B9;">
                <a href="${env.FRONTEND_URL}/settings" style="color:#C4B0B9;text-decoration:none;">Manage preferences</a>
              </p>
              <p style="margin:0;font-size:11px;color:#C4B0B9;">Powered by <a href="https://sillages.app" style="color:#C4B0B9;text-decoration:none;">Sillages</a></p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
