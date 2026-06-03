import { format, parseISO } from 'date-fns';
import { es as esLocale } from 'date-fns/locale';
import { resend } from '../lib/resend.js';
import { supabase } from '../lib/supabase.js';
import { env } from '../config/env.js';
import { logCommunication } from './commLog.js';
import { canEmailMerchant } from './commsGate.js';
import type { IntelligenceBrief, Account } from '../types.js';
import type { BrandConfig } from './emailTemplates.js';

// ── Visual constants — from v2 handoff ──────────────────────────────────────

const BG = '#F2EBE3';
const TEXT = '#14110D';
const TEXT_BODY = '#3B342B';
const LABEL = '#8A7F6E';
const DIVIDER = '#F0E9DF';
const GREEN_NUM = '#0F7A3D';
const GREEN_BG = '#ECF7EF';
const GREEN_BORDER = '#1E9E5A';
const GREEN_LABEL = '#0B5C2E';
const RED_NUM = '#C2410C';
const RED_BG = '#FCEDED';
const RED_BORDER = '#D94B4B';
const RED_LABEL = '#8A2424';
const AMBER_BG = '#FFF8E6';
const AMBER_BORDER = '#E0A500';
const AMBER_LABEL = '#7A5C00';
const GOLD = '#FFE38A';
const DARK = '#14110D';
const DARK_MUTED = '#7A7062';
const MUTED_NUM = '#B8A88F';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

// ── i18n labels ──────────────────────────────────────────────────────────────

const labels = {
  en: {
    ayer: 'Yesterday',
    moneyLeft: 'Money left on the table',
    whatsWorking: "What's working",
    yourCustomers: 'Your customers',
    pattern: 'Pattern',
    needsAttention: 'Needs attention',
    oneThingLabel: 'Your one thing',
    oneThingSub: 'for today · 5 min',
    thisWeek: 'This week so far',
    revenue: 'Revenue',
    orders: 'Orders / Pedidos',
    aov: 'Avg. order',
    topProduct: 'Top product',
    recurring: 'Returning',
    total: 'Total',
    regular: 'Regular',
    oneTime: 'One-time',
    inactive: 'Inactive',
    vsLastWeek: 'vs last week',
    openDashboard: 'Open your dashboard',
    dailyBrief: 'Daily brief',
    unsubscribe: 'Unsubscribe',
    managePrefs: 'Manage preferences',
    cartRecoveryAuto: 'Recovery emails already sent automatically.',
    cartRecoveryApprove: 'Approve recovery emails →',
    cartRecoveryUpgrade: 'Upgrade to recover these carts automatically →',
    defaultSubject: 'Your daily brief',
  },
  es: {
    ayer: 'Ayer',
    moneyLeft: 'Money left on the table',
    whatsWorking: "What's working",
    yourCustomers: 'Your customers',
    pattern: 'Pattern',
    needsAttention: 'Needs attention',
    oneThingLabel: 'Your one thing',
    oneThingSub: 'para hoy · 5 min',
    thisWeek: 'This week so far',
    revenue: 'Revenue',
    orders: 'Pedidos',
    aov: 'Ticket medio',
    topProduct: 'Top producto',
    recurring: 'Recurrentes',
    total: 'Total',
    regular: 'Regulares',
    oneTime: 'One-time',
    inactive: 'Inactivas',
    vsLastWeek: 'vs sem. pasada',
    openDashboard: 'Abrir dashboard',
    dailyBrief: 'Daily brief',
    unsubscribe: 'Unsubscribe',
    managePrefs: 'Manage preferences',
    cartRecoveryAuto: 'Ya le hemos enviado un email de recuperación.',
    cartRecoveryApprove: 'Aprueba los emails de recuperación →',
    cartRecoveryUpgrade: 'Activa Crecimiento para recuperar estos carritos →',
    defaultSubject: 'Tu brief diario',
  },
} as const;

type Lang = keyof typeof labels;

// ── Entry point ──────────────────────────────────────────────────────────────

export async function sendBriefEmail(briefId: string): Promise<void> {
  const { data: brief, error: briefErr } = await supabase
    .from('intelligence_briefs')
    .select('*')
    .eq('id', briefId)
    .single();

  if (briefErr || !brief) throw new Error(`Brief not found: ${briefErr?.message}`);
  const b = brief as IntelligenceBrief & { email_message_id?: string | null };

  // Idempotency: never re-send a brief that already went out (e.g. scheduler retry,
  // double cron). One brief per account+brief_date is enforced upstream by upsert.
  if (b.status === 'sent' && b.email_message_id) {
    console.log(`[emailSender] Brief ${briefId} already sent (msg ${b.email_message_id}) — skipping resend`);
    return;
  }
  if (b.status !== 'ready') throw new Error(`Brief ${briefId} is not ready (status: ${b.status})`);

  const [{ data: account, error: accErr }, { data: shopConn }, { data: brandProfile }] = await Promise.all([
    supabase.from('accounts').select('email, full_name, language').eq('id', b.account_id).single(),
    supabase.from('shopify_connections').select('shop_name, shop_currency, shop_domain').eq('account_id', b.account_id).maybeSingle(),
    supabase.from('brand_profiles').select('logo_url, primary_color, shop_url, contact_email, contact_phone, contact_address, social_links').eq('account_id', b.account_id).maybeSingle(),
  ]);

  if (accErr || !account) throw new Error(`Account not found: ${accErr?.message}`);
  const acc = account as Pick<Account, 'email' | 'full_name'> & { language?: string };

  // Respect unsubscribe / blacklist — never email a merchant who opted out.
  if (!await canEmailMerchant(acc.email)) {
    console.log(`[emailSender] Skipping brief ${briefId} — ${acc.email} not emailable (unsubscribed/blacklisted)`);
    await supabase.from('intelligence_briefs').update({ status: 'skipped' }).eq('id', briefId);
    return;
  }

  const ownerName = acc.full_name?.split(' ')[0] ?? acc.email.split('@')[0];
  const lang: Lang = acc.language === 'es' ? 'es' : 'en';
  const currency: string = (shopConn as { shop_currency: string | null } | null)?.shop_currency ?? 'USD';
  const rawShopName: string = (shopConn as { shop_name: string | null } | null)?.shop_name ?? ownerName;
  const emailSlug = rawShopName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const fromField = `${rawShopName} via Sillages <${emailSlug}@sillages.app>`;

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

  const weekData = await loadWeekToDate(b.account_id, b.brief_date, currency);

  const { data: sub } = await supabase.from('account_subscriptions').select('plan_id').eq('account_id', b.account_id).in('status', ['active', 'trialing']).maybeSingle();
  const { data: config } = await supabase.from('user_intelligence_config').select('auto_approve_cart_recovery').eq('account_id', b.account_id).maybeSingle();
  const planId = sub?.plan_id ?? 'starter';
  const autoApprove = config?.auto_approve_cart_recovery ?? false;

  const t = labels[lang];
  const y = b.section_yesterday;
  const preheader = y?.summary?.slice(0, 120) ?? t.defaultSubject;
  const subjectLine = `${ownerName}, ${b.section_signal?.headline?.slice(0, 60) ?? y?.summary?.slice(0, 50) ?? t.defaultSubject}`;

  const html = buildV2Html({ brief: b, lang, currency, brand, weekData, planId, autoApprove });

  const { buildUnsubscribeUrl } = await import('../lib/unsubscribe.js');
  const unsubscribeUrl = buildUnsubscribeUrl(b.account_id, acc.email);

  const { data: sent, error: sendErr } = await resend.emails.send({
    from: fromField,
    to: acc.email,
    subject: subjectLine,
    html,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });

  if (sendErr || !sent) throw new Error(`Resend error: ${(sendErr as Error)?.message}`);

  const sentAt = new Date().toISOString();
  await supabase.from('intelligence_briefs').update({ status: 'sent', sent_at: sentAt, email_message_id: sent.id }).eq('id', briefId);

  // Log to email_log for tracking — error-checked (see commLog.ts). The daily
  // brief was silently failing to log here for weeks because the raw insert
  // swallowed a channel CHECK-constraint error.
  const logged = await logCommunication({
    account_id: b.account_id,
    brief_id: briefId,
    channel: 'daily_brief',
    recipient_email: acc.email,
    status: 'sent',
    message_id: sent.id,
  });
  if (!logged) {
    console.error(`[emailSender] Brief ${briefId} was SENT to ${acc.email} (msg ${sent.id}) but email_log write failed — delivery tracking is blind for this send.`);
  }

  console.log(`[emailSender] Sent brief ${briefId} to ${acc.email}`);
}

// ── Week-to-date ──────────────────────────────────────────────────────────────

interface WeekToDate { revenue: number; orders: number; topProduct: string | null; returningRate: number; daysInWeek: number; }

async function loadWeekToDate(accountId: string, briefDate: string, _currency: string): Promise<WeekToDate> {
  const bd = new Date(briefDate + 'T12:00:00Z');
  const dow = bd.getUTCDay();
  const mondayOffset = dow === 0 ? 6 : dow - 1;
  const monday = new Date(bd.getTime() - mondayOffset * 86400000);
  const mondayStr = monday.toISOString().slice(0, 10);

  const { data: weekSnaps } = await supabase.from('shopify_daily_snapshots').select('total_revenue, total_orders, returning_customer_rate, top_products').eq('account_id', accountId).gte('snapshot_date', mondayStr).lte('snapshot_date', briefDate).order('snapshot_date');
  if (!weekSnaps || weekSnaps.length === 0) return { revenue: 0, orders: 0, topProduct: null, returningRate: 0, daysInWeek: 0 };

  let totalRev = 0, totalOrd = 0, totalRetRate = 0;
  const productSales = new Map<string, number>();
  for (const s of weekSnaps) {
    totalRev += s.total_revenue; totalOrd += s.total_orders; totalRetRate += s.returning_customer_rate ?? 0;
    for (const p of (s.top_products as Array<{ title: string; quantity_sold: number }>) ?? []) productSales.set(p.title, (productSales.get(p.title) ?? 0) + p.quantity_sold);
  }
  let topProduct: string | null = null, topQty = 0;
  for (const [name, qty] of productSales) { if (qty > topQty) { topQty = qty; topProduct = name; } }
  return { revenue: totalRev, orders: totalOrd, topProduct, returningRate: weekSnaps.length > 0 ? totalRetRate / weekSnaps.length : 0, daysInWeek: weekSnaps.length };
}

// ── V2 HTML builder — pixel-perfect from handoff ──────────────────────────────

interface BuildV2Input { brief: IntelligenceBrief; lang: Lang; currency: string; brand: BrandConfig; weekData: WeekToDate; planId: string; autoApprove: boolean; }

function buildV2Html({ brief, lang, currency, brand, weekData, planId, autoApprove }: BuildV2Input): string {
  const t = labels[lang];
  const locale = lang === 'es' ? esLocale : undefined;
  const bd = parseISO(brief.brief_date);
  const dayName = format(bd, 'EEEE', { locale });
  const datePart = format(bd, ', MMMM d', { locale });
  const y = brief.section_yesterday;
  const ww = brief.section_whats_working;
  const up = brief.section_upcoming;
  const wnw = brief.section_whats_not_working;
  const sig = brief.section_signal;
  const act = brief.section_activation;

  const sym: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };
  const cs = sym[currency] ?? currency;

  function fmtCurrency(n: number): string { return `${cs}${Math.round(n).toLocaleString()}`; }
  function wowColor(pct: number | null | undefined): string { return (pct ?? 0) >= 0 ? GREEN_NUM : RED_NUM; }
  function wowArrow(pct: number | null | undefined): string {
    if (pct == null) return '';
    const arrow = pct >= 0 ? '↑' : '↓';
    return `<span style="font-size:12px;font-weight:600;color:${wowColor(pct)};letter-spacing:0;margin-left:4px;">${arrow} ${Math.abs(pct).toFixed(0)}%</span>`;
  }
  function wowLine(pct: number | null | undefined): string {
    if (pct == null) return `<span style="color:${LABEL};">= ${t.vsLastWeek}</span>`;
    const arrow = pct >= 0 ? '↑' : '↓';
    const color = pct >= 0 ? GREEN_NUM : RED_NUM;
    return `<span style="font-weight:600;color:${color};">${arrow} ${Math.abs(pct).toFixed(0)}%</span> <span style="color:${LABEL};font-weight:400;">${t.vsLastWeek}</span>`;
  }

  // Spacer
  const sp = (h: number) => `<tr><td style="font-size:0;line-height:0;height:${h}px;">&nbsp;</td></tr>`;

  // Preheader
  const preheader = y?.summary?.slice(0, 120) ?? '';

  // ── Logo header (image if available, text fallback) ──
  const bigLogoUrl = brand.logoUrl?.replace(/_\d+x\./, '_400x.');
  const logoHtml = bigLogoUrl
    ? `<a href="${brand.shopUrl ?? '#'}" target="_blank" style="text-decoration:none;"><img src="${bigLogoUrl}" alt="${brand.storeName}" width="120" style="display:block;width:120px;height:auto;border:0;" /></a>`
    : `<div style="font-size:15px;font-weight:700;letter-spacing:0.22em;color:${TEXT};line-height:1;">${brand.storeName.toUpperCase()}</div>`;

  // ── Headline ──
  const headlineSummary = y?.summary ?? '';
  // Find the most impactful phrase for the highlight
  const highlightPhrase = act?.what?.match(/€\d+[^\.]*/)?.[0] ?? act?.expected_impact?.match(/€[^\.]+/)?.[0] ?? '';

  // ── Cart recovery note ──
  let cartNote = '';
  if (['crecimiento', 'pro'].includes(planId)) {
    cartNote = autoApprove ? t.cartRecoveryAuto : t.cartRecoveryApprove;
  } else {
    cartNote = t.cartRecoveryUpgrade;
  }

  // ── Detect sections ──
  const hasMoneyLeft = wnw?.items?.some(i => /carrit|cart|abandon/i.test(i.insight ?? ''));
  const moneyLeftItem = wnw?.items?.find(i => /carrit|cart|abandon/i.test(i.insight ?? ''));
  const hasNeedsAttention = (y?.wow?.revenue_pct ?? 0) < -20;
  const needsAttentionItems = wnw?.items?.filter(i => !/carrit|cart|abandon/i.test(i.insight ?? '')) ?? [];

  // ── Build HTML ──
  let body = '';

  // HEADER
  body += `<tr><td style="padding:4px 6px 0 6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td valign="middle" align="left">${logoHtml}</td>
    <td valign="middle" align="right"><div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${LABEL};line-height:1;">${t.dailyBrief}</div></td>
  </tr></table></td></tr>`;

  body += sp(28);

  // HERO DATE + HEADLINE
  body += `<tr><td style="padding:0 6px;">
    <p class="day-big" style="margin:0 0 6px 0;font-size:36px;font-weight:700;letter-spacing:-0.025em;color:${TEXT};line-height:1.05;font-family:${FONT};">
      ${dayName}<span style="color:${MUTED_NUM};">${datePart}</span>
    </p>
    <p class="highlight-text" style="margin:18px 0 0 0;font-size:24px;font-weight:500;letter-spacing:-0.015em;color:${TEXT_BODY};line-height:1.4;font-family:${FONT};">
      ${headlineSummary}
    </p>
  </td></tr>`;

  body += sp(32);

  // AYER — hero card
  if (y) {
    const wowRevPct = y.wow?.revenue_pct;
    const wowRevText = wowRevPct != null ? `${wowRevPct >= 0 ? '↑' : '↓'} ${Math.abs(wowRevPct).toFixed(0)}% ${t.vsLastWeek}` : '';
    const wowRevColor = (wowRevPct ?? 0) >= 0 ? GREEN_NUM : RED_NUM;

    body += `<tr><td class="hero-card" style="background-color:#FFFFFF;border-radius:18px;padding:32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="left"><p style="margin:0 0 18px 0;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${LABEL};font-family:${FONT};">${t.ayer}</p></td>
        ${wowRevText ? `<td align="right"><p style="margin:0 0 18px 0;font-size:11px;font-weight:600;letter-spacing:0.06em;color:${wowRevColor};font-family:${FONT};">${wowRevText}</p></td>` : ''}
      </tr></table>
      <p class="hero-num" style="margin:0;font-size:64px;font-weight:700;letter-spacing:-0.035em;color:${TEXT};line-height:1;font-family:${FONT};">${fmtCurrency(y.revenue)}</p>
      <p class="narrative" style="margin:22px 0 28px 0;font-size:16px;line-height:1.65;color:${TEXT_BODY};font-family:${FONT};">
        ${y.orders} ${t.orders.toLowerCase()}. ${y.summary?.replace(/^[^.]*\.\s*/, '') ?? ''}
      </p>
      <div style="height:1px;background-color:${DIVIDER};margin-bottom:24px;">&nbsp;</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr class="stack">
        <td class="stack-cell" valign="top" width="50%" style="padding-right:12px;">
          <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${LABEL};font-family:${FONT};">${t.orders}</p>
          <p style="margin:0;font-size:24px;font-weight:700;color:${TEXT};letter-spacing:-0.02em;line-height:1.1;font-family:${FONT};">${y.orders} ${wowArrow(y.wow?.orders_pct)}</p>
        </td>
        <td class="stack-cell" valign="top" width="50%" style="padding-left:12px;border-left:1px solid ${DIVIDER};">
          <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${LABEL};font-family:${FONT};">${t.aov}</p>
          <p style="margin:0;font-size:24px;font-weight:700;color:${TEXT};letter-spacing:-0.02em;line-height:1.1;font-family:${FONT};">${fmtCurrency(y.aov)} ${wowArrow(y.wow?.aov_pct)}</p>
        </td>
      </tr></table>
    </td></tr>`;
    body += sp(14);
  }

  // MONEY LEFT ON THE TABLE
  if (hasMoneyLeft && moneyLeftItem) {
    body += `<tr><td class="card-accent" style="background-color:${AMBER_BG};border-left:4px solid ${AMBER_BORDER};padding:28px 30px;">
      <p style="margin:0 0 14px 0;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${AMBER_LABEL};font-family:${FONT};">${t.moneyLeft}</p>
      <p class="narrative" style="margin:0 0 14px 0;font-size:15px;line-height:1.65;color:${TEXT_BODY};font-family:${FONT};">${moneyLeftItem.insight}</p>
      <p style="margin:0;font-size:12px;color:${AMBER_LABEL};line-height:1.4;letter-spacing:0.01em;font-family:${FONT};">${cartNote}</p>
    </td></tr>`;
    body += sp(14);
  }

  // WHAT'S WORKING
  if (ww?.items && ww.items.length > 0) {
    const item = ww.items[0];
    body += `<tr><td class="card-accent" style="background-color:${GREEN_BG};border-left:4px solid ${GREEN_BORDER};padding:28px 30px;">
      <p style="margin:0 0 14px 0;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${GREEN_LABEL};font-family:${FONT};">${t.whatsWorking}</p>
      <p class="narrative" style="margin:0;font-size:15px;line-height:1.6;color:${TEXT_BODY};font-family:${FONT};">${item.title}${item.metric ? ` — <strong>${item.metric}</strong>` : ''}. ${item.insight}</p>
    </td></tr>`;
    body += sp(14);
  }

  // YOUR CUSTOMERS
  if (sig) {
    body += `<tr><td class="card" style="background-color:#FFFFFF;border-radius:18px;padding:32px;">
      <p style="margin:0 0 14px 0;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${LABEL};font-family:${FONT};">${t.yourCustomers}</p>
      <p class="narrative" style="margin:0 0 6px 0;font-size:16px;line-height:1.6;color:${TEXT_BODY};font-family:${FONT};">${sig.headline}</p>
      <p class="narrative" style="margin:0;font-size:15px;line-height:1.6;color:${TEXT_BODY};font-family:${FONT};">${sig.market_context}</p>
    </td></tr>`;
    body += sp(14);
  }

  // PATTERN
  if (up?.items && up.items.length > 0) {
    const item = up.items[0];
    body += `<tr><td class="card" style="background-color:#FFFFFF;border-radius:18px;padding:32px;">
      <p style="margin:0 0 14px 0;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${LABEL};font-family:${FONT};">${t.pattern}</p>
      <p style="margin:0 0 12px 0;font-size:26px;font-weight:700;letter-spacing:-0.025em;color:${TEXT};line-height:1.15;font-family:${FONT};">${item.pattern}</p>
      <p class="narrative" style="margin:0;font-size:15px;line-height:1.6;color:${TEXT_BODY};font-family:${FONT};">${item.action}</p>
    </td></tr>`;
    body += sp(14);
  }

  // NEEDS ATTENTION
  if (hasNeedsAttention && needsAttentionItems.length > 0) {
    const item = needsAttentionItems[0];
    const declinePct = Math.abs(y?.wow?.revenue_pct ?? 0);
    body += `<tr><td class="card-accent" style="background-color:${RED_BG};border-left:4px solid ${RED_BORDER};padding:28px 30px;">
      <p style="margin:0 0 14px 0;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${RED_LABEL};font-family:${FONT};">${t.needsAttention}</p>
      <p class="mega-num" style="margin:0 0 14px 0;font-size:48px;font-weight:700;letter-spacing:-0.035em;color:${TEXT};line-height:1;font-family:${FONT};">−${declinePct.toFixed(0)}%</p>
      <p class="narrative" style="margin:0;font-size:15px;line-height:1.6;color:${TEXT_BODY};font-family:${FONT};">${item.insight}</p>
    </td></tr>`;
    body += sp(28);
  } else {
    body += sp(14);
  }

  // YOUR ONE THING — DARK HERO
  if (act) {
    body += `<tr><td class="dark-card" style="background-color:${DARK};border-radius:18px;padding:36px;">
      <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${GOLD};font-family:${FONT};">${t.oneThingLabel}</p>
      <p style="margin:0 0 22px 0;font-size:11px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;color:${DARK_MUTED};font-family:${FONT};">${t.oneThingSub}</p>
      <p class="one-thing-text" style="margin:0 0 28px 0;font-size:26px;font-weight:500;letter-spacing:-0.015em;color:#FFFFFF;line-height:1.35;font-family:${FONT};">
        ${act.what} <span style="color:${MUTED_NUM};font-weight:400;">${act.expected_impact ?? ''}</span>
      </p>
      <!--[if !mso]><!-- -->
      <a href="${env.FRONTEND_URL}/actions" style="display:inline-block;background-color:#FFFFFF;color:${DARK};text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.01em;padding:14px 22px;border-radius:10px;line-height:1.2;font-family:${FONT};">
        ${lang === 'es' ? 'Ver en la app' : 'View in app'} →
      </a>
      <!--<![endif]-->
    </td></tr>`;
    body += sp(28);
  }

  // THIS WEEK SO FAR
  if (weekData.daysInWeek > 0) {
    body += `<tr><td class="card" style="background-color:#FFFFFF;border-radius:18px;padding:32px;">
      <p style="margin:0 0 24px 0;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${LABEL};font-family:${FONT};">${t.thisWeek}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr class="stack">
        <td class="stack-cell" valign="top" width="50%" style="padding:0 14px 22px 0;border-bottom:1px solid ${DIVIDER};">
          <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${LABEL};font-family:${FONT};">${t.revenue}</p>
          <p style="margin:0;font-size:30px;font-weight:700;color:${TEXT};letter-spacing:-0.025em;line-height:1.05;font-family:${FONT};">${fmtCurrency(weekData.revenue)}</p>
        </td>
        <td class="stack-cell" valign="top" width="50%" style="padding:0 0 22px 22px;border-bottom:1px solid ${DIVIDER};border-left:1px solid ${DIVIDER};">
          <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${LABEL};font-family:${FONT};">${t.orders}</p>
          <p style="margin:0;font-size:30px;font-weight:700;color:${TEXT};letter-spacing:-0.025em;line-height:1.05;font-family:${FONT};">${weekData.orders}</p>
        </td>
      </tr><tr class="stack">
        <td class="stack-cell" valign="top" width="50%" style="padding:22px 14px 0 0;">
          <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${LABEL};font-family:${FONT};">${t.topProduct}</p>
          <p style="margin:0;font-size:20px;font-weight:700;color:${TEXT};letter-spacing:-0.015em;line-height:1.2;font-family:${FONT};">${weekData.topProduct ?? '—'}</p>
        </td>
        <td class="stack-cell" valign="top" width="50%" style="padding:22px 0 0 22px;border-left:1px solid ${DIVIDER};">
          <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${LABEL};font-family:${FONT};">${t.recurring}</p>
          <p style="margin:0;font-size:30px;font-weight:700;color:${TEXT};letter-spacing:-0.025em;line-height:1.05;font-family:${FONT};">${(weekData.returningRate * 100).toFixed(0)}%</p>
        </td>
      </tr></table>
    </td></tr>`;
    body += sp(32);
  }

  // CTA
  body += `<tr><td align="center" class="cta-btn" style="padding:0 0 4px 0;">
    <!--[if !mso]><!-- -->
    <a href="${env.FRONTEND_URL}/dashboard" style="display:inline-block;background-color:${DARK};color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:600;letter-spacing:0.01em;padding:18px 38px;border-radius:12px;line-height:1.2;font-family:${FONT};">
      ${t.openDashboard} →
    </a>
    <!--<![endif]-->
  </td></tr>`;

  body += sp(40);

  // FOOTER
  const footerLinks = [
    brand.shopUrl ? `<a href="${brand.shopUrl}" style="color:${LABEL};text-decoration:none;">${brand.shopUrl.replace(/^https?:\/\//, '')}</a>` : null,
    brand.contactEmail ? `<a href="mailto:${brand.contactEmail}" style="color:${LABEL};text-decoration:none;">${brand.contactEmail}</a>` : null,
  ].filter(Boolean).join(' &middot; ');

  body += `<tr><td align="center" style="padding:8px 16px 0 16px;">
    <p style="margin:0 0 6px 0;font-size:13px;font-weight:600;color:${TEXT_BODY};letter-spacing:0.18em;line-height:1.5;font-family:${FONT};">${brand.storeName.toUpperCase()}</p>
    ${footerLinks ? `<p style="margin:0 0 14px 0;font-size:12px;color:${LABEL};line-height:1.6;font-family:${FONT};">${footerLinks}</p>` : ''}
    <p style="margin:0 0 18px 0;font-size:12px;color:${LABEL};line-height:1.6;font-family:${FONT};">
      <a href="{{unsubscribe_url}}" style="color:${LABEL};text-decoration:underline;">${t.unsubscribe}</a> &middot;
      <a href="${env.FRONTEND_URL}/settings" style="color:${LABEL};text-decoration:underline;">${t.managePrefs}</a>
    </p>
    <p style="margin:0;font-size:11px;color:${MUTED_NUM};letter-spacing:0.04em;line-height:1.4;font-family:${FONT};">Powered by <strong style="font-weight:600;">Sillages</strong></p>
  </td></tr>`;

  body += sp(24);

  // ── Full email wrapper ──
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="x-apple-disable-message-reformatting" />
<title>${t.dailyBrief}</title>
<style>
  body, table, td, p, a, li, blockquote { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; border-collapse: collapse; }
  img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; display: block; }
  body { margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: ${BG}; font-family: ${FONT}; color: ${TEXT}; }
  a { color: inherit; }
  @media screen and (max-width: 620px) {
    .container { width: 100% !important; }
    .px-outer { padding-left: 14px !important; padding-right: 14px !important; padding-top: 20px !important; padding-bottom: 20px !important; }
    .card { padding: 24px !important; }
    .card-accent { padding: 24px !important; padding-left: 24px !important; }
    .hero-card { padding: 26px !important; }
    .dark-card { padding: 28px !important; }
    .hero-num { font-size: 56px !important; letter-spacing: -0.03em !important; }
    .mega-num { font-size: 44px !important; letter-spacing: -0.03em !important; }
    .one-thing-text { font-size: 22px !important; line-height: 1.3 !important; }
    .narrative { font-size: 15.5px !important; }
    .highlight-text { font-size: 22px !important; line-height: 1.35 !important; }
    .day-big { font-size: 30px !important; letter-spacing: -0.02em !important; }
    .stack { display: block !important; width: 100% !important; }
    .stack-cell { display: block !important; width: 100% !important; padding: 0 0 18px 0 !important; }
    .stack-cell:last-child { padding-bottom: 0 !important; }
    .cta-btn a { display: block !important; width: 100% !important; box-sizing: border-box !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${BG};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${BG};opacity:0;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BG};">
    <tr>
      <td align="center" class="px-outer" style="padding:40px 24px;">
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
          ${body}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
