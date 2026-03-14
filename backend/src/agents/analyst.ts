import { openai } from '../lib/openai.js';
import { supabase } from '../lib/supabase.js';
import { analyzeHistoricalPatterns } from '../prompts/briefPrompt.js';
import type { ShopifyDailySnapshot, UserIntelligenceConfig } from '../types.js';
import type { AnalystOutput } from './types.js';
import type { CustomerIntelligence } from '../services/customerIntelligence.js';

// ── Input ───────────────────────────────────────────────────────────────────

export interface AnalystInput {
  snapshot: ShopifyDailySnapshot;
  historicalSnapshots: ShopifyDailySnapshot[];
  config: UserIntelligenceConfig;
  storeName: string;
  currency: string;
  briefDate: string;
  language: 'en' | 'es';
  accountId: string;
  customerIntelligence?: CustomerIntelligence | null;
}

// ── Result ──────────────────────────────────────────────────────────────────

export interface AnalystResult {
  output: AnalystOutput;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior ecommerce data analyst. You receive raw Shopify data and return structured insights. You NEVER recommend actions — you only analyze.

Your analysis must cover these 5 areas:

1. CONVERSION ANALYSIS:
   - Abandoned cart rate and value (if data available)
   - Products viewed but not purchased (friction signals)
   - Average order value and how to increase it (bundles, upsells)
   - Checkout completion rate

2. MERCHANDISING ANALYSIS:
   - Which products generate the most revenue per unit (high-value products)
   - Which products sell the most units (volume products)
   - Product position vs performance mismatch (best products hidden)
   - Collections analysis: which collections drive sales, which are dead
   - Products not sold in 30+ days

3. RETENTION ANALYSIS:
   - Repeat vs new customer ratio
   - Customer purchase frequency (average days between purchases)
   - Customers overdue for repurchase (past their usual cycle)
   - Top customers by lifetime value
   - Customer segments: VIP (4+ purchases), regular (2-3), one-time (1)

4. SEO ANALYSIS:
   - Products without meta description
   - Products without image alt text
   - Short or missing product descriptions
   - Collections without descriptions
   - URL/handle quality

5. ACQUISITION ANALYSIS:
   - New customer trend (growing, stable, declining)
   - Which products attract new customers vs retain existing ones
   - Price point analysis for first-time buyers

ALSO ANALYZE:
- Day-of-week patterns (which days sell more, which products on which days)
- Seasonal/calendar opportunities upcoming (holidays, events within next 14 days)
- Week-over-week trends for all metrics

CRITICAL: For each insight, include the DATA that supports it. Numbers, percentages, comparisons. The Growth Hacker will use your data to justify every action.

ALSO TRACK PREVIOUS ACTIONS:
You will receive actions_history — previously executed actions for this account.
- Include them verbatim in your output's actions_history field
- If a discount was created, note whether orders with that discount code appeared
- If a product was highlighted, note if its sales changed
- This enables the MEASURE step of the improvement loop

IMPORTANT:
- Currency: use the store's currency, never assume USD
- Language: your output is structured JSON, not prose. The "signals" array should use the language specified.
- Sessions/traffic: if session data is 0 or unavailable, do NOT mention it
- Be honest: if there's not enough data to detect a pattern, say so in signals
- If customer detail data is not available, return empty arrays for overdue_customers, vip_customers
- weekly_patterns: only include days that have data points. Use language-appropriate day names.

Return ONLY valid JSON matching the AnalystOutput schema. No preamble, no explanation.`;

// ── Load previous actions for the loop ──────────────────────────────────────

async function loadActionsHistory(accountId: string): Promise<AnalystOutput['actions_history']> {
  // Get actions from the last 14 days (completed, failed, or pending)
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

  const { data: actions } = await supabase
    .from('pending_actions')
    .select('id, type, title, status, executed_at, result')
    .eq('account_id', accountId)
    .gte('created_at', fourteenDaysAgo)
    .order('created_at', { ascending: false })
    .limit(20);

  if (!actions || actions.length === 0) return [];

  return actions.map(a => ({
    action_id: a.id,
    type: a.type,
    title: a.title,
    status: a.status,
    executed_at: a.executed_at,
    measured_impact: a.result?.measured_impact ?? a.result ?? null,
  }));
}

// ── Customer intelligence block ─────────────────────────────────────────────

function buildCustomerIntelBlock(ci: CustomerIntelligence | null | undefined): string {
  if (!ci) return 'CUSTOMER INTELLIGENCE: Not available for this store.';

  const lines: string[] = ['CUSTOMER INTELLIGENCE (from Shopify API — real customer data):'];
  lines.push(`- Total customers (60 days): ${ci.total_customers}`);
  lines.push(`- Repeat customers: ${ci.repeat_customers}`);
  lines.push(`- One-time customers: ${ci.one_time_customers}`);
  lines.push(`- New this week: ${ci.new_this_week}`);

  if (ci.star_customers.length > 0) {
    lines.push('\nSTAR CUSTOMERS (top by spend):');
    ci.star_customers.forEach(c => {
      lines.push(`  ${c.rank}. ${c.name} (${c.email}) — ${c.total_orders} orders, €${c.total_spent} spent, favorite: ${c.favorite_product}, last: ${c.last_purchase_date}`);
    });
  }

  if (ci.lost_customers.length > 0) {
    lines.push('\nLOST CUSTOMERS (1 purchase, 14+ days ago):');
    ci.lost_customers.forEach(c => {
      lines.push(`  - ${c.name} (${c.email}) — bought ${c.favorite_product}, ${c.days_since_last_purchase}d ago, spent €${c.total_spent}`);
    });
  }

  if (ci.about_to_repeat.length > 0) {
    lines.push('\nABOUT TO REPEAT (within their purchase cycle):');
    ci.about_to_repeat.forEach(c => {
      lines.push(`  - ${c.name} (${c.email}) — avg cycle ${c.avg_days_between_purchases}d, expected in ${c.expected_in_days}d, favorite: ${c.favorite_product}`);
    });
  }

  if (ci.abandoned_carts.length > 0) {
    lines.push(`\nABANDONED CARTS (${ci.abandoned_carts.length}):`);
    ci.abandoned_carts.forEach(ac => {
      const products = ac.products.map(p => `${p.title} x${p.quantity}`).join(', ');
      lines.push(`  - ${ac.customer_name} (${ac.customer_email}) — ${products} — €${ac.total_value} — ${ac.is_returning_customer ? 'returning' : 'new visitor'} — ${ac.abandoned_at.slice(0, 10)}`);
    });
  }

  if (ci.yesterday_buyers.length > 0) {
    lines.push(`\nYESTERDAY'S BUYERS (${ci.yesterday_buyers.length}):`);
    ci.yesterday_buyers.forEach(b => {
      lines.push(`  - ${b.name} — ${b.products.join(', ')} — €${b.total} — ${b.is_repeat ? 'repeat' : 'new'}`);
    });
  }

  return lines.join('\n');
}

// ── Load recent brief feedback ───────────────────────────────────────────────

interface BriefFeedbackRow {
  rating: 'useful' | 'not_useful' | 'want_more';
  want_more_topic: string | null;
  free_text: string | null;
  created_at: string;
}

async function loadRecentFeedback(accountId: string): Promise<BriefFeedbackRow[]> {
  const { data } = await supabase
    .from('brief_feedback')
    .select('rating, want_more_topic, free_text, created_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(5);

  return (data as BriefFeedbackRow[] | null) ?? [];
}

function buildFeedbackBlock(feedback: BriefFeedbackRow[]): string {
  if (feedback.length === 0) return '';

  const lines: string[] = [
    '',
    '═══ MERCHANT FEEDBACK (from recent briefs) ═══',
    'The store owner has given feedback on recent briefs. Adjust your analysis accordingly:',
  ];

  for (const fb of feedback) {
    const date = fb.created_at.slice(0, 10);
    let line = `- [${date}] rated "${fb.rating}"`;
    if (fb.want_more_topic) {
      const topicLabel = fb.want_more_topic.toUpperCase().replace('_', ' ');
      line += ` topic: "${fb.want_more_topic}" — GIVE MORE DETAIL ON ${topicLabel}`;
    }
    if (fb.free_text) {
      line += ` free_text: "${fb.free_text}"`;
    }
    lines.push(line);
  }

  lines.push('Use this feedback to prioritize what you analyze. If they want more of something, go deeper on that topic.');

  return lines.join('\n');
}

// ── Build user prompt ───────────────────────────────────────────────────────

function buildAnalystUserPrompt(input: AnalystInput, actionsHistory: AnalystOutput['actions_history'], feedbackBlock: string): string {
  const { snapshot, historicalSnapshots, config, storeName, currency, briefDate, language } = input;

  const sym: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', MXN: 'MX$', COP: 'COP$' };
  const cs = sym[currency] ?? `${currency} `;

  // Top products
  const topProductsText = snapshot.top_products.length > 0
    ? snapshot.top_products
        .slice(0, 10)
        .map((p, i) => `  ${i + 1}. ${p.title} — ${p.quantity_sold} units — ${cs}${p.revenue.toFixed(2)}`)
        .join('\n')
    : '  No product data';

  // Products viewed but not purchased (from raw_shopify_payload)
  const rawPayload = snapshot.raw_shopify_payload as Record<string, unknown> | null;
  const viewedNotPurchased = rawPayload?.top_products_no_conversion as Array<{ title: string; revenue: number; quantity_sold: number }> | undefined;
  const frictionBlock = viewedNotPurchased && viewedNotPurchased.length > 0
    ? viewedNotPurchased.map((p, i) => `  ${i + 1}. ${p.title} — in carts/viewed but low conversion`).join('\n')
    : '  No friction data available';

  // Abandoned carts
  const abandonedCheckouts = rawPayload?.abandoned_checkouts as number | undefined;
  const abandonedCartRate = rawPayload?.abandoned_cart_rate as number | undefined;

  // Historical patterns
  let historicalBlock = '';
  if (historicalSnapshots.length >= 3) {
    const { text } = analyzeHistoricalPatterns(historicalSnapshots, briefDate, language);
    historicalBlock = text;
  }

  // WoW deltas
  const wowBlock = [
    snapshot.wow_revenue_pct !== null ? `Revenue WoW: ${snapshot.wow_revenue_pct >= 0 ? '+' : ''}${snapshot.wow_revenue_pct.toFixed(1)}%` : null,
    snapshot.wow_orders_pct !== null ? `Orders WoW: ${snapshot.wow_orders_pct >= 0 ? '+' : ''}${snapshot.wow_orders_pct.toFixed(1)}%` : null,
    snapshot.wow_aov_pct !== null ? `AOV WoW: ${snapshot.wow_aov_pct >= 0 ? '+' : ''}${snapshot.wow_aov_pct.toFixed(1)}%` : null,
    snapshot.wow_new_customers_pct !== null ? `New customers WoW: ${snapshot.wow_new_customers_pct >= 0 ? '+' : ''}${snapshot.wow_new_customers_pct.toFixed(1)}%` : null,
  ].filter(Boolean).join('\n');

  // Actions history for the loop
  const actionsBlock = actionsHistory.length > 0
    ? actionsHistory.map(a => {
        let line = `  - [${a.status}] ${a.type}: "${a.title}"`;
        if (a.executed_at) line += ` (executed: ${a.executed_at.slice(0, 10)})`;
        if (a.measured_impact) line += ` | Impact: ${JSON.stringify(a.measured_impact)}`;
        return line;
      }).join('\n')
    : '  No previous actions';

  return `Analyze this store data for ${storeName}. Language: ${language}. Currency: ${currency}. Today: ${briefDate}.

YESTERDAY (${briefDate}):
- Revenue: ${cs}${snapshot.total_revenue.toFixed(2)}
- Net revenue (after refunds): ${cs}${snapshot.net_revenue.toFixed(2)}
- Orders: ${snapshot.total_orders}
- Average order value: ${cs}${snapshot.average_order_value.toFixed(2)}
- Sessions: ${snapshot.sessions}
- Conversion rate: ${(snapshot.conversion_rate * 100).toFixed(2)}%
- New customers: ${snapshot.new_customers}
- Returning customers: ${snapshot.returning_customers}
- Total customers: ${snapshot.total_customers}
- Refunds: ${cs}${snapshot.total_refunds.toFixed(2)}
- Cancelled orders: ${snapshot.cancelled_orders}
- Abandoned checkouts: ${abandonedCheckouts ?? 'unknown'}
- Abandoned cart rate: ${abandonedCartRate !== undefined ? (abandonedCartRate * 100).toFixed(1) + '%' : 'unknown'}

WEEK-OVER-WEEK CHANGES:
${wowBlock || 'No prior week data available'}

TOP PRODUCTS:
${topProductsText}

FRICTION SIGNALS (products viewed/carted but not purchased):
${frictionBlock}

${historicalBlock ? `HISTORICAL DATA (last 30 days):\n${historicalBlock}` : 'No historical data available.'}

PREVIOUS ACTIONS (last 14 days — for the improvement loop):
${actionsBlock}

STORE CONFIG:
- Focus areas: ${config.focus_areas.length > 0 ? config.focus_areas.join(', ') : 'none specified'}
${config.store_context ? `- Store context: ${config.store_context}` : ''}
${config.competitor_context ? `- Competitor context: ${config.competitor_context}` : ''}

${buildCustomerIntelBlock(input.customerIntelligence)}

Return the AnalystOutput JSON. Include ALL 5 analysis areas (conversion, merchandising, retention, seo, acquisition), plus weekly_patterns, calendar_opportunities, trends, actions_history, and signals.
${feedbackBlock}
Schema:
{
  "period": { "date": "${briefDate}", "revenue": <number>, "orders": <number>, "avg_order": <number>, "currency": "${currency}" },
  "top_products": [{ "name": "<exact name>", "units": <number>, "revenue": <number> }],
  "conversion": {
    "abandoned_carts": <number>,
    "cart_abandonment_rate": <0-1>,
    "products_viewed_not_purchased": [{ "name": "<name>", "views_or_carts": <number> }],
    "avg_order_value": <number>,
    "checkout_completion_rate": <0-1>
  },
  "merchandising": {
    "high_value_products": [{ "name": "<name>", "revenue_per_unit": <number>, "units": <number> }],
    "volume_products": [{ "name": "<name>", "units": <number>, "revenue": <number> }],
    "position_mismatch": [{ "name": "<name>", "issue": "<description>" }],
    "dead_products": [{ "name": "<name>", "days_without_sale": <number> }],
    "collection_performance": [{ "name": "<name>", "products": <number>, "has_description": <boolean> }]
  },
  "retention": {
    "repeat_rate": <0-1>,
    "new_customer_count": <number>,
    "overdue_customers": [{ "name": "<name>", "email": "<email>", "last_purchase": "<date>", "days_since": <number>, "usual_cycle_days": <number>, "total_spent": <number> }],
    "vip_customers": [{ "name": "<name>", "email": "<email>", "purchases": <number>, "total_spent": <number> }],
    "customer_segments": { "vip": <number>, "regular": <number>, "one_time": <number> }
  },
  "seo": {
    "missing_meta": [{ "name": "<name>", "handle": "<handle>" }],
    "missing_alt": [{ "name": "<name>", "handle": "<handle>", "image_url": "<url>" }],
    "short_descriptions": [{ "name": "<name>", "handle": "<handle>", "current_length": <number> }],
    "missing_collection_desc": [{ "name": "<name>", "handle": "<handle>" }]
  },
  "acquisition": {
    "new_customer_trend": "<growing|stable|declining|insufficient_data>",
    "first_purchase_products": [{ "name": "<name>", "count": <number> }],
    "entry_price_point": <number>
  },
  "weekly_patterns": [{ "day_of_week": "<day>", "avg_revenue": <number>, "avg_orders": <number>, "best_product": "<name>" }],
  "calendar_opportunities": [{ "event": "<name>", "date": "<YYYY-MM-DD>", "days_until": <number>, "relevance": "<why>" }],
  "trends": {
    "revenue_vs_last_week": <percentage>,
    "orders_vs_last_week": <percentage>,
    "growing_products": ["<names>"],
    "declining_products": ["<names>"]
  },
  "actions_history": ${JSON.stringify(actionsHistory)},
  "signals": ["<key observations>"]
}`;
}

// ── Run analyst agent ───────────────────────────────────────────────────────

export async function runAnalyst(input: AnalystInput): Promise<AnalystResult> {
  console.log('[analyst] Running analyst agent...');

  // Load previous actions for the improvement loop
  const actionsHistory = await loadActionsHistory(input.accountId);
  console.log(`[analyst] Loaded ${actionsHistory.length} previous actions for the loop`);

  // Load recent merchant feedback
  const recentFeedback = await loadRecentFeedback(input.accountId);
  const feedbackBlock = buildFeedbackBlock(recentFeedback);
  if (recentFeedback.length > 0) {
    console.log(`[analyst] Loaded ${recentFeedback.length} recent feedback entries`);
  }

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildAnalystUserPrompt(input, actionsHistory, feedbackBlock) },
    ],
  });

  const rawContent = completion.choices[0]?.message?.content;
  if (!rawContent) {
    throw new Error('[analyst] OpenAI returned empty content');
  }

  const output = JSON.parse(rawContent) as AnalystOutput;

  // Ensure actions_history is populated even if LLM omits it
  if (!output.actions_history) {
    output.actions_history = actionsHistory;
  }

  // Attach customer intelligence (real data, not LLM-generated)
  if (input.customerIntelligence) {
    output.customer_intelligence = input.customerIntelligence;
  }

  // Ensure all 5 areas have defaults
  if (!output.conversion) {
    output.conversion = { abandoned_carts: 0, cart_abandonment_rate: 0, products_viewed_not_purchased: [], avg_order_value: output.period.avg_order, checkout_completion_rate: 0 };
  }
  if (!output.merchandising) {
    output.merchandising = { high_value_products: [], volume_products: [], position_mismatch: [], dead_products: [], collection_performance: [] };
  }
  if (!output.retention) {
    output.retention = { repeat_rate: 0, new_customer_count: 0, overdue_customers: [], vip_customers: [], customer_segments: { vip: 0, regular: 0, one_time: 0 } };
  }
  if (!output.seo) {
    output.seo = { missing_meta: [], missing_alt: [], short_descriptions: [], missing_collection_desc: [] };
  }
  if (!output.acquisition) {
    output.acquisition = { new_customer_trend: 'insufficient_data', first_purchase_products: [], entry_price_point: 0 };
  }
  if (!output.calendar_opportunities) {
    output.calendar_opportunities = [];
  }

  const usage = {
    prompt_tokens: completion.usage?.prompt_tokens ?? 0,
    completion_tokens: completion.usage?.completion_tokens ?? 0,
    total_tokens: completion.usage?.total_tokens ?? 0,
  };

  console.log(`[analyst] Done — ${output.signals.length} signals, ${output.top_products.length} products, ${usage.total_tokens} tokens`);

  return { output, usage };
}
