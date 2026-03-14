import { resend } from '../lib/resend.js';
import { supabase } from '../lib/supabase.js';
import { env } from '../config/env.js';

// ── i18n labels ──────────────────────────────────────────────────────────────

const labels = {
  en: {
    subjectPrefix: (storeName: string, weekStart: string, weekEnd: string) =>
      `\u{1F4CA} ${storeName} \u2014 Week ${weekStart} to ${weekEnd}`,
    header: (weekStart: string, weekEnd: string) =>
      `Weekly Summary \u2014 ${weekStart} to ${weekEnd}`,
    executiveSummary: 'Executive Summary',
    revenue: 'Revenue',
    orders: 'Orders',
    avgOrderValue: 'Avg. Order Value',
    vsPreviousWeek: 'vs previous week',
    bestDay: 'Best day',
    worstDay: 'Worst day',
    topCustomers: 'Top Customers',
    newBadge: 'NEW',
    ordersLabel: 'orders',
    spent: 'spent',
    favorite: 'Favorite',
    topProducts: 'Top Products',
    units: 'units',
    customerInsights: 'Customer Insights',
    newVsReturning: 'New vs Returning',
    lostCustomers: 'Lost Customers',
    aboutToRepeat: 'About to Repeat',
    actionsReview: 'Actions Review',
    weeklyPlan: 'Weekly Plan',
    focus: 'Focus',
    patternsDiscovered: 'Patterns Discovered',
    footerTagline: 'Sillages \u2014 Your growth strategist',
    viewDashboard: 'View dashboard',
  },
  es: {
    subjectPrefix: (storeName: string, weekStart: string, weekEnd: string) =>
      `\u{1F4CA} ${storeName} \u2014 Semana ${weekStart} al ${weekEnd}`,
    header: (weekStart: string, weekEnd: string) =>
      `Resumen Semanal \u2014 ${weekStart} al ${weekEnd}`,
    executiveSummary: 'Resumen Ejecutivo',
    revenue: 'Ingresos',
    orders: 'Pedidos',
    avgOrderValue: 'Ticket Medio',
    vsPreviousWeek: 'vs semana anterior',
    bestDay: 'Mejor d\u00eda',
    worstDay: 'Peor d\u00eda',
    topCustomers: 'Clientes Destacados',
    newBadge: 'NUEVO',
    ordersLabel: 'pedidos',
    spent: 'gastado',
    favorite: 'Favorito',
    topProducts: 'Productos Destacados',
    units: 'uds',
    customerInsights: 'An\u00e1lisis de Clientes',
    newVsReturning: 'Nuevos vs Recurrentes',
    lostCustomers: 'Clientes Perdidos',
    aboutToRepeat: 'A Punto de Repetir',
    actionsReview: 'Revisi\u00f3n de Acciones',
    weeklyPlan: 'Plan Semanal',
    focus: 'Foco',
    patternsDiscovered: 'Patrones Descubiertos',
    footerTagline: 'Sillages \u2014 Tu estratega de crecimiento',
    viewDashboard: 'Ver dashboard',
  },
} as const;

type Lang = keyof typeof labels;

// ── Types matching weeklyBriefGenerator's saved structure ─────────────────────

interface SectionSummary {
  summary: string;
  revenue_analysis: {
    total_revenue: number;
    total_orders: number;
    avg_order_value: number;
    vs_previous_week: { revenue_pct: number; orders_pct: number };
    best_day: { day: string; revenue: number };
    worst_day: { day: string; revenue: number };
    narrative: string;
  };
}

interface TopCustomer {
  name: string;
  orders_this_week: number;
  total_spent_this_week: number;
  total_spent_all_time: number;
  favorite_product: string;
  is_new: boolean;
}

interface SectionCustomers {
  top_customers: TopCustomer[];
  customer_insights: {
    new_customers: number;
    returning_customers: number;
    lost_customers_count: number;
    lost_customers_names: string[];
    about_to_repeat: string[];
    narrative: string;
  };
}

interface TopProduct {
  name: string;
  units: number;
  revenue: number;
  trend: 'up' | 'down' | 'stable';
}

interface SectionProducts {
  top_products: TopProduct[];
}

interface SectionActionsReview {
  actions_review: Array<{
    title: string;
    type: string;
    result: string;
    impact: string;
  }>;
}

interface SectionWeeklyPlan {
  weekly_plan: {
    focus: string;
    actions: Array<{
      day: string;
      action: string;
      why: string;
    }>;
  };
  patterns_discovered: string[];
}

interface WeeklyBriefRow {
  id: string;
  account_id: string;
  week_start: string;
  week_end: string;
  status: string;
  section_summary: SectionSummary | null;
  section_customers: SectionCustomers | null;
  section_products: SectionProducts | null;
  section_actions_review: SectionActionsReview | null;
  section_weekly_plan: SectionWeeklyPlan | null;
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function sendWeeklyBriefEmail(weeklyBriefId: string): Promise<void> {
  // 1. Load the weekly brief
  const { data: brief, error: briefErr } = await supabase
    .from('weekly_briefs')
    .select('*')
    .eq('id', weeklyBriefId)
    .single();

  if (briefErr || !brief) throw new Error(`Weekly brief not found: ${briefErr?.message}`);

  const wb = brief as WeeklyBriefRow;

  // 2. Load the account
  const [{ data: account, error: accErr }, { data: shopConn }] = await Promise.all([
    supabase.from('accounts').select('email, full_name, language').eq('id', wb.account_id).single(),
    supabase.from('shopify_connections').select('shop_name, shop_domain, shop_currency').eq('account_id', wb.account_id).single(),
  ]);

  if (accErr || !account) throw new Error(`Account not found: ${accErr?.message}`);

  const acc = account as { email: string; full_name: string | null; language?: string };
  const ownerName = acc.full_name?.split(' ')[0] ?? acc.email.split('@')[0];
  const lang: Lang = acc.language === 'es' ? 'es' : 'en';
  const currency: string = (shopConn as { shop_currency: string | null } | null)?.shop_currency ?? 'USD';

  // 3. Build from address (same pattern as daily briefs)
  const rawShopName: string = (shopConn as { shop_name: string | null } | null)?.shop_name ?? ownerName;
  const emailSlug = rawShopName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const fromAddress = `${emailSlug}@sillages.app`;
  const fromField = `${rawShopName} via Sillages <${fromAddress}>`;

  console.log(`[weeklyEmailSender] Sending from: ${fromField}`);

  // 4. Build subject and HTML
  const t = labels[lang];
  const subject = t.subjectPrefix(rawShopName, wb.week_start, wb.week_end);
  const html = buildWeeklyEmailHtml({ brief: wb, lang, currency });

  // 5. Send via Resend
  const { data: sent, error: sendErr } = await resend.emails.send({
    from: fromField,
    to: acc.email,
    subject,
    html,
  });

  if (sendErr || !sent) throw new Error(`Resend error: ${(sendErr as Error)?.message}`);

  // 6. Update status to sent
  await supabase
    .from('weekly_briefs')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      email_message_id: sent.id,
    })
    .eq('id', weeklyBriefId);

  console.log(`[weeklyEmailSender] Sent weekly brief ${weeklyBriefId} to ${acc.email}`);
}

// ── HTML builder ─────────────────────────────────────────────────────────────

function buildWeeklyEmailHtml({ brief, lang, currency }: {
  brief: WeeklyBriefRow;
  lang: Lang;
  currency: string;
}): string {
  const t = labels[lang];
  const numberLocale = lang === 'es' ? 'es-ES' : 'en-US';

  function fmt(n: number, style: 'currency' | 'decimal' = 'decimal'): string {
    if (style === 'currency') {
      return new Intl.NumberFormat(numberLocale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
    }
    return new Intl.NumberFormat(numberLocale).format(n);
  }

  function pctBadge(pct: number | null | undefined): string {
    if (pct == null) return '';
    const sign = pct >= 0 ? '+' : '';
    const color = pct >= 0 ? '#22c55e' : '#ef4444';
    const arrow = pct >= 0 ? '\u2191' : '\u2193';
    return `<span style="font-size:13px;font-weight:600;color:${color};">${arrow} ${sign}${pct.toFixed(1)}%</span>`;
  }

  function trendArrow(trend: 'up' | 'down' | 'stable'): string {
    if (trend === 'up') return '<span style="color:#22c55e;">\u2191</span>';
    if (trend === 'down') return '<span style="color:#ef4444;">\u2193</span>';
    return '<span style="color:#9A8090;">\u2192</span>';
  }

  // Extract from section-based JSON columns
  const ss = brief.section_summary;
  const rev = ss?.revenue_analysis;
  const summary = ss?.summary;
  const sc = brief.section_customers;
  const customers = sc?.top_customers;
  const insights = sc?.customer_insights;
  const sp = brief.section_products;
  const products = sp?.top_products;
  const sar = brief.section_actions_review;
  const actions = sar?.actions_review;
  const swp = brief.section_weekly_plan;
  const plan = swp?.weekly_plan;
  const patterns = swp?.patterns_discovered;

  // ── Section builders ───────────────────────────────────────────────────────

  const revenueBlock = rev ? `
          <!-- Revenue Block -->
          <tr>
            <td style="background:#FDFAF6;border-radius:12px;border:1px solid #EDE5DC;padding:24px;margin-bottom:16px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding-bottom:16px;">
                    <p style="margin:0 0 2px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">${t.revenue}</p>
                    <p style="margin:0;font-size:32px;font-weight:700;color:#3A2332;letter-spacing:-0.5px;">${fmt(rev.total_revenue, 'currency')}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:12px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="width:50%;vertical-align:top;">
                          <p style="margin:0 0 2px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">${t.orders}</p>
                          <p style="margin:0;font-size:18px;font-weight:600;color:#3A2332;">${fmt(rev.total_orders)}</p>
                        </td>
                        <td style="width:50%;vertical-align:top;">
                          <p style="margin:0 0 2px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">${t.avgOrderValue}</p>
                          <p style="margin:0;font-size:18px;font-weight:600;color:#3A2332;">${fmt(rev.avg_order_value, 'currency')}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                ${rev.vs_previous_week ? `
                <tr>
                  <td style="padding:12px 0;border-top:1px solid #F0E8E0;">
                    <p style="margin:0;font-size:13px;color:#6B5460;">
                      ${pctBadge(rev.vs_previous_week.revenue_pct)}
                      <span style="margin-left:6px;">${t.vsPreviousWeek}</span>
                    </p>
                  </td>
                </tr>
                ` : ''}
                ${rev.best_day || rev.worst_day ? `
                <tr>
                  <td style="padding-top:8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        ${rev.best_day ? `
                        <td style="width:50%;vertical-align:top;">
                          <p style="margin:0 0 2px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">${t.bestDay}</p>
                          <p style="margin:0;font-size:13px;font-weight:600;color:#22c55e;">${rev.best_day.day} (${fmt(rev.best_day.revenue, 'currency')})</p>
                        </td>
                        ` : ''}
                        ${rev.worst_day ? `
                        <td style="width:50%;vertical-align:top;">
                          <p style="margin:0 0 2px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">${t.worstDay}</p>
                          <p style="margin:0;font-size:13px;font-weight:600;color:#ef4444;">${rev.worst_day.day} (${fmt(rev.worst_day.revenue, 'currency')})</p>
                        </td>
                        ` : ''}
                      </tr>
                    </table>
                  </td>
                </tr>
                ` : ''}
              </table>
            </td>
          </tr>
          <tr><td style="height:16px;"></td></tr>
  ` : '';

  const topCustomersBlock = customers && customers.length > 0 ? `
          <!-- Top Customers -->
          <tr>
            <td style="padding-bottom:8px;padding-top:8px;">
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#9A8090;">${t.topCustomers}</p>
            </td>
          </tr>
          <tr>
            <td style="background:#FDFAF6;border-radius:12px;border:1px solid #EDE5DC;padding:8px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${customers.map((c) => `
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #F0E8E0;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td>
                          <span style="font-size:14px;font-weight:600;color:#3A2332;">${c.name}</span>
                          ${c.is_new ? `<span style="display:inline-block;margin-left:8px;padding:2px 8px;background:#C9964A;color:#FFFFFF;font-size:10px;font-weight:700;border-radius:4px;letter-spacing:0.05em;">${t.newBadge}</span>` : ''}
                          <p style="margin:4px 0 0;font-size:12px;color:#6B5460;">
                            ${fmt(c.orders_this_week)} ${t.ordersLabel} &middot; ${fmt(c.total_spent_this_week, 'currency')} ${t.spent}
                            ${c.favorite_product ? ` &middot; ${t.favorite}: ${c.favorite_product}` : ''}
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                `).join('')}
              </table>
            </td>
          </tr>
          <tr><td style="height:16px;"></td></tr>
  ` : '';

  const topProductsBlock = products && products.length > 0 ? `
          <!-- Top Products -->
          <tr>
            <td style="padding-bottom:8px;padding-top:8px;">
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#9A8090;">${t.topProducts}</p>
            </td>
          </tr>
          <tr>
            <td style="background:#FDFAF6;border-radius:12px;border:1px solid #EDE5DC;padding:8px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${products.map((p) => `
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #F0E8E0;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="vertical-align:middle;">
                          <span style="font-size:14px;font-weight:600;color:#3A2332;">${p.name}</span>
                          <span style="margin-left:6px;">${trendArrow(p.trend)}</span>
                          <p style="margin:4px 0 0;font-size:12px;color:#6B5460;">
                            ${fmt(p.units)} ${t.units} &middot; ${fmt(p.revenue, 'currency')}
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                `).join('')}
              </table>
            </td>
          </tr>
          <tr><td style="height:16px;"></td></tr>
  ` : '';

  const customerInsightsBlock = insights ? `
          <!-- Customer Insights -->
          <tr>
            <td style="padding-bottom:8px;padding-top:8px;">
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#9A8090;">${t.customerInsights}</p>
            </td>
          </tr>
          <tr>
            <td style="background:#FDFAF6;border-radius:12px;border:1px solid #EDE5DC;padding:20px 24px;">
              ${insights.narrative ? `
              <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">${t.newVsReturning}</p>
              <p style="margin:0 0 16px;font-size:13px;color:#3A2332;line-height:1.6;">${insights.narrative}</p>
              ` : ''}
              ${insights.lost_customers_names && insights.lost_customers_names.length > 0 ? `
              <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">${t.lostCustomers}</p>
              <p style="margin:0 0 16px;font-size:13px;color:#ef4444;line-height:1.6;">${insights.lost_customers_names.join(', ')}</p>
              ` : ''}
              ${insights.about_to_repeat && insights.about_to_repeat.length > 0 ? `
              <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">${t.aboutToRepeat}</p>
              <p style="margin:0;font-size:13px;color:#22c55e;line-height:1.6;">${insights.about_to_repeat.join(', ')}</p>
              ` : ''}
            </td>
          </tr>
          <tr><td style="height:16px;"></td></tr>
  ` : '';

  const actionsReviewBlock = actions && actions.length > 0 ? `
          <!-- Actions Review -->
          <tr>
            <td style="padding-bottom:8px;padding-top:8px;">
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#9A8090;">${t.actionsReview}</p>
            </td>
          </tr>
          <tr>
            <td style="background:#FDFAF6;border-radius:12px;border:1px solid #EDE5DC;padding:8px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${actions.map((a) => `
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #F0E8E0;">
                    <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#3A2332;">${a.title}</p>
                    <p style="margin:0;font-size:13px;color:#6B5460;line-height:1.5;">${a.result} ${a.impact ? `— ${a.impact}` : ''}</p>
                  </td>
                </tr>
                `).join('')}
              </table>
            </td>
          </tr>
          <tr><td style="height:16px;"></td></tr>
  ` : '';

  const weeklyPlanBlock = plan ? `
          <!-- Weekly Plan -->
          <tr>
            <td style="padding-bottom:8px;padding-top:8px;">
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#9A8090;">${t.weeklyPlan}</p>
            </td>
          </tr>
          <tr>
            <td style="background:#1A1A2E;border-radius:12px;padding:24px;">
              ${plan.focus ? `
              <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.3);">${t.focus}</p>
              <p style="margin:0 0 20px;font-size:15px;font-weight:600;color:#C9964A;line-height:1.4;">${plan.focus}</p>
              ` : ''}
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${plan.actions.map((d) => `
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="width:80px;vertical-align:top;">
                          <span style="font-size:12px;font-weight:600;color:#C9964A;text-transform:uppercase;letter-spacing:0.05em;">${d.day}</span>
                        </td>
                        <td style="vertical-align:top;">
                          <span style="font-size:13px;color:rgba(255,255,255,0.75);line-height:1.5;">${d.action}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                `).join('')}
              </table>
            </td>
          </tr>
          <tr><td style="height:16px;"></td></tr>
  ` : '';

  const patternsBlock = patterns && patterns.length > 0 ? `
          <!-- Patterns Discovered -->
          <tr>
            <td style="padding-bottom:8px;padding-top:8px;">
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#9A8090;">${t.patternsDiscovered}</p>
            </td>
          </tr>
          <tr>
            <td style="background:#FDFAF6;border-radius:12px;border:1px solid #EDE5DC;padding:16px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${patterns.map((p) => `
                <tr>
                  <td style="padding:8px 0;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="width:8px;vertical-align:top;padding-top:4px;">
                          <div style="width:6px;height:6px;background:#C9964A;border-radius:50%;"></div>
                        </td>
                        <td style="padding-left:10px;font-size:13px;color:#3A2332;line-height:1.6;">${p}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                `).join('')}
              </table>
            </td>
          </tr>
          <tr><td style="height:16px;"></td></tr>
  ` : '';

  // ── Assemble full email ────────────────────────────────────────────────────

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Sillages Weekly Brief</title>
</head>
<body style="margin:0;padding:0;background:#F7F1EC;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F1EC;min-height:100vh;">
    <tr>
      <td align="center" style="padding:32px 16px 48px;">

        <!-- Container -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">

          <!-- Header -->
          <tr>
            <td style="padding-bottom:28px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <p style="margin:0;font-size:18px;font-weight:700;color:#3A2332;letter-spacing:-0.3px;">sillages</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Week Title -->
          <tr>
            <td style="padding-bottom:24px;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#3A2332;line-height:1.3;">
                ${t.header(brief.week_start, brief.week_end)}
              </p>
              <div style="margin-top:12px;width:40px;height:3px;background:#C9964A;border-radius:2px;"></div>
            </td>
          </tr>

          ${summary ? `
          <!-- Executive Summary -->
          <tr>
            <td style="padding-bottom:8px;padding-top:8px;">
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#9A8090;">${t.executiveSummary}</p>
            </td>
          </tr>
          <tr>
            <td style="background:#FDFAF6;border-radius:12px;border:1px solid #EDE5DC;padding:24px;">
              <p style="margin:0;font-size:15px;font-weight:500;color:#3A2332;line-height:1.7;">${summary}</p>
            </td>
          </tr>
          <tr><td style="height:16px;"></td></tr>
          ` : ''}

          ${revenueBlock}
          ${topCustomersBlock}
          ${topProductsBlock}
          ${customerInsightsBlock}
          ${actionsReviewBlock}
          ${weeklyPlanBlock}
          ${patternsBlock}

          <!-- Footer -->
          <tr>
            <td style="padding-top:24px;border-top:1px solid #EDE5DC;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding-bottom:16px;">
                    <p style="margin:0;font-size:13px;font-weight:600;color:#C9964A;">${t.footerTagline}</p>
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <a href="${env.FRONTEND_URL}/dashboard" style="display:inline-block;padding:10px 24px;background:#C9964A;color:#FFFFFF;font-size:13px;font-weight:600;text-decoration:none;border-radius:8px;">${t.viewDashboard}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
