import { supabase } from '../lib/supabase.js';
import { openai } from '../lib/openai.js';
import { loadBrandProfile } from './brandAnalyzer.js';
import { buildCustomerIntelligence } from './customerIntelligence.js';
import type { ShopifyDailySnapshot } from '../types.js';
import type { BrandProfile } from './brandAnalyzer.js';
import type { CustomerIntelligence } from './customerIntelligence.js';

const LOG = '[weeklyBrief]';

// ── Output schema from OpenAI ──────────────────────────────────────────────

interface WeeklyBriefOutput {
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
  top_customers: Array<{
    name: string;
    orders_this_week: number;
    total_spent_this_week: number;
    total_spent_all_time: number;
    favorite_product: string;
    is_new: boolean;
  }>;
  top_products: Array<{
    name: string;
    units: number;
    revenue: number;
    trend: 'up' | 'down' | 'stable';
  }>;
  customer_insights: {
    new_customers: number;
    returning_customers: number;
    lost_customers_count: number;
    lost_customers_names: string[];
    about_to_repeat: string[];
    narrative: string;
  };
  actions_review: Array<{
    title: string;
    type: string;
    result: string;
    impact: string;
  }>;
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

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Generates a comprehensive weekly brief for a given account.
 * @param accountId - The account to generate for
 * @param weekEndDate - The Sunday that just ended the week (YYYY-MM-DD)
 * @returns The id of the created weekly_briefs row
 */
export async function generateWeeklyBrief(
  accountId: string,
  weekEndDate: string,
): Promise<string> {
  console.log(`${LOG} Starting weekly brief for account=${accountId} weekEnd=${weekEndDate}`);

  // ── 1. Compute week boundaries ──────────────────────────────────────────
  const weekEnd = new Date(weekEndDate + 'T23:59:59Z');
  const weekStart = new Date(weekEnd.getTime() - 6 * 86400000);
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  const prevWeekEnd = new Date(weekStart.getTime() - 86400000);
  const prevWeekStart = new Date(prevWeekEnd.getTime() - 6 * 86400000);
  const prevWeekStartStr = prevWeekStart.toISOString().slice(0, 10);
  const prevWeekEndStr = prevWeekEnd.toISOString().slice(0, 10);

  // ── 2. Load all data in parallel ────────────────────────────────────────
  const [
    accountResult,
    snapshotsResult,
    prevSnapshotsResult,
    brandProfile,
    customerIntelligence,
    completedActionsResult,
    connectionResult,
  ] = await Promise.all([
    supabase.from('accounts').select('*').eq('id', accountId).single(),
    supabase
      .from('shopify_daily_snapshots')
      .select('*')
      .eq('account_id', accountId)
      .gte('snapshot_date', weekStartStr)
      .lte('snapshot_date', weekEndDate)
      .order('snapshot_date', { ascending: true }),
    supabase
      .from('shopify_daily_snapshots')
      .select('*')
      .eq('account_id', accountId)
      .gte('snapshot_date', prevWeekStartStr)
      .lte('snapshot_date', prevWeekEndStr)
      .order('snapshot_date', { ascending: true }),
    loadBrandProfile(accountId),
    buildCustomerIntelligence(accountId, weekEndDate).catch(err => {
      console.warn(`${LOG} Customer intelligence failed (non-fatal): ${err instanceof Error ? err.message : err}`);
      return null;
    }),
    supabase
      .from('pending_actions')
      .select('*')
      .eq('account_id', accountId)
      .eq('status', 'completed')
      .gte('created_at', weekStartStr)
      .lte('created_at', weekEndDate + 'T23:59:59Z'),
    supabase
      .from('shopify_connections')
      .select('shop_name, shop_domain, shop_currency')
      .eq('account_id', accountId)
      .single(),
  ]);

  if (accountResult.error || !accountResult.data) {
    throw new Error(`${LOG} Account not found: ${accountResult.error?.message}`);
  }

  const account = accountResult.data;
  const language: 'en' | 'es' = account.language === 'es' ? 'es' : 'en';
  const storeName = connectionResult.data?.shop_name ?? connectionResult.data?.shop_domain ?? 'your store';
  const currency = connectionResult.data?.shop_currency ?? 'USD';

  const weekSnapshots = (snapshotsResult.data ?? []) as ShopifyDailySnapshot[];
  const prevWeekSnapshots = (prevSnapshotsResult.data ?? []) as ShopifyDailySnapshot[];
  const completedActions = completedActionsResult.data ?? [];

  console.log(`${LOG} Data loaded — ${weekSnapshots.length} snapshots this week, ${prevWeekSnapshots.length} prev week, ${completedActions.length} completed actions, language=${language}`);

  if (weekSnapshots.length === 0) {
    throw new Error(`${LOG} No snapshots found for week ${weekStartStr} to ${weekEndDate}`);
  }

  // ── 3. Build the prompt ─────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt(language);
  const userPrompt = buildUserPrompt({
    weekSnapshots,
    prevWeekSnapshots,
    brandProfile,
    customerIntelligence,
    completedActions,
    storeName,
    currency,
    language,
    weekStartStr,
    weekEndDate,
  });

  // ── 4. Call OpenAI ──────────────────────────────────────────────────────
  console.log(`${LOG} Calling OpenAI gpt-4o...`);

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error(`${LOG} OpenAI returned empty content`);

  const result = JSON.parse(content) as WeeklyBriefOutput;
  const tokens = completion.usage;

  console.log(`${LOG} OpenAI done — ${tokens?.total_tokens ?? 0} tokens`);

  // ── 5. Save to weekly_briefs ────────────────────────────────────────────
  const { data: row, error: insertError } = await supabase
    .from('weekly_briefs')
    .insert({
      account_id: accountId,
      week_start: weekStartStr,
      week_end: weekEndDate,
      status: 'ready',
      section_summary: {
        summary: result.summary,
        revenue_analysis: result.revenue_analysis,
      },
      section_customers: {
        top_customers: result.top_customers,
        customer_insights: result.customer_insights,
      },
      section_products: {
        top_products: result.top_products,
      },
      section_actions_review: {
        actions_review: result.actions_review,
      },
      section_weekly_plan: {
        weekly_plan: result.weekly_plan,
        patterns_discovered: result.patterns_discovered,
      },
      model_used: 'gpt-4o',
      prompt_tokens: tokens?.prompt_tokens ?? 0,
      completion_tokens: tokens?.completion_tokens ?? 0,
      total_tokens: tokens?.total_tokens ?? 0,
      generated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (insertError || !row) {
    throw new Error(`${LOG} Failed to save weekly brief: ${insertError?.message}`);
  }

  console.log(`${LOG} Weekly brief saved — id=${row.id} account=${accountId} week=${weekStartStr}→${weekEndDate}`);
  return row.id;
}

// ── Prompt builders ────────────────────────────────────────────────────────

function buildSystemPrompt(language: 'en' | 'es'): string {
  return `You are a senior ecommerce strategist writing a weekly performance report for a small store owner. Write in ${language === 'es' ? 'Spanish' : 'English'}. Be personal — use customer names from the data. Be specific — reference real products and numbers. Sound like a smart friend, not a consultant.

═══ BANNED PHRASES — if ANY of these appear in your output, you have FAILED ═══
- "¡No te lo pierdas!" / "Don't miss out!"
- "¡Haz tu pedido ahora!" / "Order now!"
- "Pura fantasía"
- "Te transporta"
- "Un clásico reinventado"
- "Descubre nuestra selección" / "Discover our selection"
- "Celebra con nuestras deliciosas..."
- "Personaliza tu regalo"
- "¡Te encantará!" / "You'll love it!"
- "No te arrepentirás"
- Any phrase with ¡...! that sounds like a TV commercial
- "Un abrazo dulce"
- "Explosión de sabor"
- "Una experiencia única"
- Any phrase that could work on ANY store's page
- "conversion rate", "tasa de conversión"
- "AOV", "average order value", "valor medio del pedido"
- "KPI", "metric", "métrica"
- "leverage", "optimize", "apalancamiento", "optimizar"
- "stakeholder", "synergy"

═══ TONE ═══
Write like a smart friend texting the store owner their weekly recap over coffee. Use real numbers. Name real customers. Reference real products. No jargon. No consultant-speak. If you'd never say it in a casual conversation, don't write it.

Return ONLY valid JSON matching the output schema. No preamble, no explanation.`;
}

function buildUserPrompt(input: {
  weekSnapshots: ShopifyDailySnapshot[];
  prevWeekSnapshots: ShopifyDailySnapshot[];
  brandProfile: BrandProfile | null;
  customerIntelligence: CustomerIntelligence | null;
  completedActions: Array<Record<string, unknown>>;
  storeName: string;
  currency: string;
  language: 'en' | 'es';
  weekStartStr: string;
  weekEndDate: string;
}): string {
  const {
    weekSnapshots,
    prevWeekSnapshots,
    brandProfile,
    customerIntelligence,
    completedActions,
    storeName,
    currency,
    language,
    weekStartStr,
    weekEndDate,
  } = input;

  const sym: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', MXN: 'MX$' };
  const cs = sym[currency] ?? `${currency} `;

  const lines: string[] = [];

  lines.push(`═══ WEEKLY ANALYSIS: ${storeName} ═══`);
  lines.push(`Week: ${weekStartStr} → ${weekEndDate} | Currency: ${cs} | Language: ${language}`);
  lines.push('');

  // ── Brand profile ───────────────────────────────────────────────────────
  if (brandProfile) {
    lines.push('═══ BRAND PROFILE ═══');
    lines.push(`Voice: ${brandProfile.brand_voice}`);
    lines.push(`Values: ${brandProfile.brand_values}`);
    lines.push(`Audience: ${brandProfile.target_audience}`);
    lines.push(`USPs: ${brandProfile.unique_selling_points}`);
    lines.push('');
  }

  // ── This week's daily snapshots ─────────────────────────────────────────
  lines.push('═══ THIS WEEK — DAILY SNAPSHOTS ═══');
  for (const snap of weekSnapshots) {
    const dayName = new Date(snap.snapshot_date + 'T12:00:00Z')
      .toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US', { weekday: 'long' });
    lines.push(`${dayName} (${snap.snapshot_date}): revenue=${cs}${snap.total_revenue}, orders=${snap.total_orders}, new_customers=${snap.new_customers}, sessions=${snap.sessions}`);
    if (snap.top_products?.length > 0) {
      const topProds = snap.top_products.slice(0, 3).map((p) => `${p.title}(${p.quantity_sold})`).join(', ');
      lines.push(`  Top products: ${topProds}`);
    }
  }
  lines.push('');

  // ── Previous week's snapshots ───────────────────────────────────────────
  if (prevWeekSnapshots.length > 0) {
    lines.push('═══ PREVIOUS WEEK — DAILY SNAPSHOTS (for comparison) ═══');
    for (const snap of prevWeekSnapshots) {
      const dayName = new Date(snap.snapshot_date + 'T12:00:00Z')
        .toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US', { weekday: 'long' });
      lines.push(`${dayName} (${snap.snapshot_date}): revenue=${cs}${snap.total_revenue}, orders=${snap.total_orders}, new_customers=${snap.new_customers}`);
    }
    lines.push('');
  }

  // ── Customer intelligence ───────────────────────────────────────────────
  if (customerIntelligence) {
    lines.push('═══ CUSTOMER INTELLIGENCE ═══');
    lines.push(`Total: ${customerIntelligence.total_customers} customers — ${customerIntelligence.repeat_customers} repeat, ${customerIntelligence.one_time_customers} one-time, ${customerIntelligence.new_this_week} new this week`);

    if (customerIntelligence.star_customers.length > 0) {
      lines.push('Star customers:');
      for (const c of customerIntelligence.star_customers) {
        lines.push(`  #${c.rank} ${c.name} — ${cs}${c.total_spent} total, ${c.total_orders} orders, fav: ${c.favorite_product}`);
      }
    }

    if (customerIntelligence.lost_customers.length > 0) {
      lines.push('Lost customers (1 purchase, 14+ days ago):');
      for (const c of customerIntelligence.lost_customers.slice(0, 5)) {
        lines.push(`  ${c.name} — last purchase ${c.days_since_last_purchase} days ago, bought ${c.favorite_product}`);
      }
    }

    if (customerIntelligence.about_to_repeat.length > 0) {
      lines.push('About to repeat (within purchase cycle window):');
      for (const c of customerIntelligence.about_to_repeat) {
        lines.push(`  ${c.name} — expected in ${c.expected_in_days} days, fav: ${c.favorite_product}`);
      }
    }

    if (customerIntelligence.abandoned_carts.length > 0) {
      lines.push(`Abandoned carts: ${customerIntelligence.abandoned_carts.length}`);
      for (const ac of customerIntelligence.abandoned_carts.slice(0, 5)) {
        const prods = ac.products.map(p => p.title).join(', ');
        lines.push(`  ${ac.customer_name} — ${cs}${ac.total_value} — ${prods} ${ac.is_returning_customer ? '(returning)' : '(new)'}`);
      }
    }
    lines.push('');
  }

  // ── Completed actions this week ─────────────────────────────────────────
  if (completedActions.length > 0) {
    lines.push('═══ ACTIONS EXECUTED THIS WEEK ═══');
    for (const action of completedActions) {
      const impact = action.measured_impact ? ` → impact: ${JSON.stringify(action.measured_impact)}` : '';
      lines.push(`- [${action.type}] ${action.title}: ${action.description}${impact}`);
    }
    lines.push('');
  } else {
    lines.push('═══ ACTIONS EXECUTED THIS WEEK ═══');
    lines.push('No actions were completed this week.');
    lines.push('');
  }

  // ── Output schema ───────────────────────────────────────────────────────
  lines.push('═══ OUTPUT JSON SCHEMA ═══');
  lines.push(`Return this exact JSON structure (all text in ${language === 'es' ? 'Spanish' : 'English'}):`);
  lines.push(`{
  "summary": "3-4 sentence executive summary of the week",
  "revenue_analysis": {
    "total_revenue": <number>,
    "total_orders": <number>,
    "avg_order_value": <number>,
    "vs_previous_week": { "revenue_pct": <number change %>, "orders_pct": <number change %> },
    "best_day": { "day": "<weekday name>", "revenue": <number> },
    "worst_day": { "day": "<weekday name>", "revenue": <number> },
    "narrative": "2-3 sentences about revenue trends"
  },
  "top_customers": [
    { "name": "<real name>", "orders_this_week": <n>, "total_spent_this_week": <n>, "total_spent_all_time": <n>, "favorite_product": "<product>", "is_new": <bool> }
  ],
  "top_products": [
    { "name": "<product>", "units": <n>, "revenue": <n>, "trend": "up|down|stable" }
  ],
  "customer_insights": {
    "new_customers": <n>,
    "returning_customers": <n>,
    "lost_customers_count": <n>,
    "lost_customers_names": ["<name>", ...],
    "about_to_repeat": ["<name>", ...],
    "narrative": "2-3 sentences"
  },
  "actions_review": [
    { "title": "<action>", "type": "<type>", "result": "<what happened>", "impact": "<measured result or assessment>" }
  ],
  "weekly_plan": {
    "focus": "<main focus for coming week>",
    "actions": [
      { "day": "<day>", "action": "<what to do>", "why": "<reason tied to this week's data>" }
    ]
  },
  "patterns_discovered": ["<insight only visible at weekly level>", ...]
}`);

  return lines.join('\n');
}
