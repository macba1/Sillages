import type { ShopifyDailySnapshot, UserIntelligenceConfig } from '../types.js';

export interface BriefPromptInput {
  ownerName: string;
  storeName: string;
  snapshot: ShopifyDailySnapshot;
  config: UserIntelligenceConfig;
  briefDate: string; // YYYY-MM-DD, the date being briefed (yesterday)
}

export function buildSystemPrompt(): string {
  return `You are the private intelligence analyst for a Shopify store owner. You have access to their real store data and deep knowledge of the beauty and personal care e-commerce market.

Your voice: elite insider. You speak directly to the owner by name. Short sentences. Declarative statements. You are confident — you never hedge, never qualify with "it seems" or "it appears", never say "data shows" or "this suggests". You state facts and you state implications. You treat the owner as an intelligent adult who wants the truth fast.

You produce a daily intelligence brief with exactly 6 sections. Return ONLY valid JSON matching the schema provided. No preamble, no explanation, no markdown outside the JSON.`;
}

export function buildUserPrompt(input: BriefPromptInput): string {
  const { ownerName, storeName, snapshot, config, briefDate } = input;

  const topProductsText = snapshot.top_products
    .slice(0, 3)
    .map(
      (p, i) =>
        `  ${i + 1}. ${p.title} — ${p.quantity_sold} units — $${p.revenue.toFixed(2)} revenue`,
    )
    .join('\n');

  const conversionPct = (snapshot.conversion_rate * 100).toFixed(2);
  const returningPct = (snapshot.returning_customer_rate * 100).toFixed(2);

  const focusNote =
    config.focus_areas.length > 0
      ? `The owner's priority focus areas are: ${config.focus_areas.join(', ')}.`
      : '';

  const storeContextNote = config.store_context
    ? `Store context: ${config.store_context}`
    : '';

  const competitorNote = config.competitor_context
    ? `Competitor context: ${config.competitor_context}`
    : '';

  const toneNote =
    config.brief_tone === 'analytical'
      ? 'Lean into metrics and percentages. Be precise.'
      : config.brief_tone === 'motivational'
        ? 'Be energising. Acknowledge wins loudly. Frame problems as solvable.'
        : 'Be direct and concise. No fluff.';

  return `Generate the daily intelligence brief for ${ownerName}, owner of ${storeName}.

Brief date: ${briefDate} (this covers yesterday's performance)

STORE DATA — YESTERDAY:
- Total revenue: $${snapshot.total_revenue.toFixed(2)}
- Net revenue (after refunds): $${snapshot.net_revenue.toFixed(2)}
- Orders: ${snapshot.total_orders}
- Average order value: $${snapshot.average_order_value.toFixed(2)}
- Sessions: ${snapshot.sessions.toLocaleString()}
- Conversion rate: ${conversionPct}%
- New customers: ${snapshot.new_customers}
- Returning customers: ${snapshot.returning_customers}
- Returning customer rate: ${returningPct}%
- Refunds: $${snapshot.total_refunds.toFixed(2)}
- Cancelled orders: ${snapshot.cancelled_orders}

TOP PRODUCTS:
${topProductsText || '  No product data available'}

${storeContextNote}
${competitorNote}
${focusNote}
${toneNote}

CURRENT BEAUTY MARKET CONTEXT (use this to populate THE SIGNAL section):
- Barrier skincare and ceramide-rich formulas are driving repeat purchase rates above 4x/year in the $50-150 price band
- Fragrance is the fastest growing beauty sub-category, up 22% YoY — especially layerable formats
- TikTok Shop is pulling impulse purchases away from DTC for products under $35 — if yours are priced there, that pressure is real
- Subscription fatigue is real — loyalty programme mechanics are outperforming subscription discounts for LTV
- Email open rates for beauty DTC are at 38-45% when sends are personalised by purchase history; generic sends are at 19-22%
- Hero product halo effect: when a store's #1 SKU grows >15% MoM it consistently lifts overall AOV by 8-12% within 60 days

OUTPUT FORMAT — return exactly this JSON structure:

{
  "section_yesterday": {
    "revenue": <number>,
    "orders": <number>,
    "aov": <number>,
    "sessions": <number>,
    "conversion_rate": <number>,
    "new_customers": <number>,
    "top_product": "<string — product name only>",
    "summary": "<ONE sentence. Direct, confident, tells them exactly what kind of day it was. Address ${ownerName} by name. No hedging.>"
  },
  "section_whats_working": {
    "items": [
      {
        "title": "<short label, 2-4 words>",
        "metric": "<the specific number or percentage>",
        "insight": "<1-2 sentences. Why this matters. What it signals. Confident, direct.>"
      }
    ]
  },
  "section_whats_not_working": {
    "items": [
      {
        "title": "<short label, 2-4 words>",
        "metric": "<the specific number or percentage>",
        "insight": "<1-2 sentences. What the problem is. What's at stake. No softening.>"
      }
    ]
  },
  "section_signal": {
    "headline": "<8-12 words. A sharp, declarative statement about what the market is doing.>",
    "market_context": "<2-3 sentences. What is happening in the beauty market right now that is relevant to this store.>",
    "store_implication": "<2-3 sentences. Cross this market context with ${storeName}'s actual numbers. Be specific about the opportunity or threat.>"
  },
  "section_gap": {
    "gap": "<1-2 sentences. The single most important gap between what the store is doing and what it could do. Be specific.>",
    "opportunity": "<1-2 sentences. What capturing this gap looks like in concrete terms.>",
    "estimated_upside": "<A specific, credible number or range. E.g. '+$X in monthly revenue' or '+X% conversion'. Base it on the actual data.>"
  },
  "section_activation": {
    "what": "<One sentence. The single action to take today.>",
    "why": "<2-3 sentences. The specific reason this action, right now, based on yesterday's data.>",
    "how": [
      "<Step 1 — specific, actionable, completable in under 5 minutes>",
      "<Step 2>",
      "<Step 3>",
      "<Step 4>",
      "<Step 5 — final step, should complete the action within 30 minutes total>"
    ],
    "expected_impact": "<One sentence. A specific, confident prediction. A number where possible.>"
  }
}

Rules:
- Address ${ownerName} by name in section_yesterday.summary only
- Provide exactly 2-3 items in whats_working and whats_not_working
- All numbers in section_yesterday must match the raw data exactly
- section_activation how[] must have 4-6 steps, each completable in under 5 minutes
- Return ONLY the JSON object. Nothing else.`;
}
