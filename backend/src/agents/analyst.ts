import { openai } from '../lib/openai.js';
import { analyzeHistoricalPatterns } from '../prompts/briefPrompt.js';
import type { ShopifyDailySnapshot, UserIntelligenceConfig } from '../types.js';
import type { AnalystOutput } from './types.js';

// ── Input ───────────────────────────────────────────────────────────────────

export interface AnalystInput {
  snapshot: ShopifyDailySnapshot;
  historicalSnapshots: ShopifyDailySnapshot[];
  config: UserIntelligenceConfig;
  storeName: string;
  currency: string;
  briefDate: string;
  language: 'en' | 'es';
}

// ── Result ──────────────────────────────────────────────────────────────────

export interface AnalystResult {
  output: AnalystOutput;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a data analyst embedded in a Shopify store. You ONLY analyze data — you never recommend actions, you never write marketing copy, you never suggest what to do. Your job is to find patterns, anomalies, and insights in the raw data.

You receive: yesterday's orders, products, customers, and 30-day historical data.

You return: a structured JSON object with your analysis. Be precise with numbers. Flag anything unusual. Detect patterns by day of week. Identify customer purchase cycles. Audit SEO issues in product data.

IMPORTANT:
- Currency: use the store's currency, never assume USD
- Language: your output is structured JSON, not prose. The "signals" array should use the language specified.
- Sessions/traffic: if session data is 0 or unavailable, do NOT include it in signals
- Be honest: if there's not enough data to detect a pattern, say so in signals
- SEO audit: check every product for missing meta_description, missing image alt text, short descriptions (<50 chars), missing collection descriptions. If no product metadata is available, return empty arrays.
- inactive_customers and customers_due_for_repurchase: if customer detail data is not available, return empty arrays
- weekly_patterns: only include days that have data points. Use the language-appropriate day names (Spanish if language=es).

Return ONLY valid JSON matching the AnalystOutput schema. No preamble, no explanation.`;

// ── Build user prompt ───────────────────────────────────────────────────────

function buildAnalystUserPrompt(input: AnalystInput): string {
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

  // Historical patterns (reuse existing analysis)
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

  return `Analyze this store data for ${storeName}. Language: ${language}. Currency: ${currency}.

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

WEEK-OVER-WEEK CHANGES:
${wowBlock || 'No prior week data available'}

TOP PRODUCTS:
${topProductsText}

${historicalBlock ? `HISTORICAL DATA (last 30 days):\n${historicalBlock}` : 'No historical data available.'}

STORE CONFIG:
- Focus areas: ${config.focus_areas.length > 0 ? config.focus_areas.join(', ') : 'none specified'}
${config.store_context ? `- Store context: ${config.store_context}` : ''}
${config.competitor_context ? `- Competitor context: ${config.competitor_context}` : ''}

Return the AnalystOutput JSON with these fields:
{
  "period": { "date": "${briefDate}", "revenue": <number>, "orders": <number>, "avg_order": <number>, "currency": "${currency}" },
  "top_products": [{ "name": "<exact product name>", "units": <number>, "revenue": <number> }],
  "customer_patterns": {
    "total_buyers": <number>,
    "repeat_buyers": <number>,
    "new_buyers": <number>,
    "returning_rate": <decimal 0-1>,
    "inactive_customers": []
  },
  "weekly_patterns": [{ "day_of_week": "<day name>", "avg_revenue": <number>, "avg_orders": <number>, "best_product": "<name>" }],
  "trends": {
    "revenue_vs_last_week": <percentage number>,
    "orders_vs_last_week": <percentage number>,
    "growing_products": ["<product names trending up>"],
    "declining_products": ["<product names trending down>"]
  },
  "seo_audit": {
    "products_without_description": [],
    "products_without_meta_description": [],
    "products_without_image_alt": [],
    "collections_without_description": [],
    "short_descriptions": []
  },
  "upcoming": {
    "best_day_this_week": { "day": "<day name>", "expected_revenue": <number>, "recommended_product": "<name>" },
    "customers_due_for_repurchase": []
  },
  "signals": ["<key observation 1>", "<key observation 2>", "..."]
}`;
}

// ── Run analyst agent ───────────────────────────────────────────────────────

export async function runAnalyst(input: AnalystInput): Promise<AnalystResult> {
  console.log('[analyst] Running analyst agent...');

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildAnalystUserPrompt(input) },
    ],
  });

  const rawContent = completion.choices[0]?.message?.content;
  if (!rawContent) {
    throw new Error('[analyst] OpenAI returned empty content');
  }

  const output = JSON.parse(rawContent) as AnalystOutput;

  const usage = {
    prompt_tokens: completion.usage?.prompt_tokens ?? 0,
    completion_tokens: completion.usage?.completion_tokens ?? 0,
    total_tokens: completion.usage?.total_tokens ?? 0,
  };

  console.log(`[analyst] Done — ${output.signals.length} signals, ${output.top_products.length} products, ${usage.total_tokens} tokens`);

  return { output, usage };
}
