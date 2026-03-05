import type { ShopifyDailySnapshot, UserIntelligenceConfig } from '../types.js';

export interface BriefPromptInput {
  ownerName: string;
  storeName: string;
  snapshot: ShopifyDailySnapshot;
  config: UserIntelligenceConfig;
  briefDate: string; // YYYY-MM-DD, the date being briefed (yesterday)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a WoW pct as "↑12.3% vs last week" or "↓4.1% vs last week". */
function wowStr(pct: number | null): string {
  if (pct === null) return 'no prior data';
  const arrow = pct >= 0 ? '↑' : '↓';
  return `${arrow}${Math.abs(pct).toFixed(1)}% vs last week`;
}

/** Format a metric value with its WoW delta inline, e.g. "$4,820 ↑12.3% vs last week". */
function withWow(value: string, pct: number | null): string {
  if (pct === null) return value;
  return `${value} (${wowStr(pct)})`;
}

// ── Prompts ───────────────────────────────────────────────────────────────────

export function buildSystemPrompt(): string {
  return `You are a private intelligence analyst who has been watching this Shopify store every single day for months. You know this business. You have formed opinions about it. You give a direct morning briefing — not a report, a conversation.

Your voice: first person, opinionated, direct. You say "I noticed", "I've been watching", "This caught my attention", "I traced it back to", "I think what's happening here is". You interpret data — you never just report it. You have a point of view and you state it.

You never say "data shows", "this suggests", "it appears", "it seems". You never hedge. You say what you think is happening and why. You treat the owner as a business partner who wants your honest read, not a sanitised summary.

You are not neutral. When something is broken, you say what you think broke it. When something is working, you say why you think it will continue. When there is an opportunity, you say exactly how to capture it and by when.

You produce a daily intelligence brief with exactly 6 sections. Return ONLY valid JSON matching the schema provided. No preamble, no explanation, no markdown outside the JSON.`;
}

export function buildUserPrompt(input: BriefPromptInput): string {
  const { ownerName, storeName, snapshot, config, briefDate } = input;

  // ── Top products ───────────────────────────────────────────────────────────
  const topProductsText = snapshot.top_products.length > 0
    ? snapshot.top_products
        .slice(0, 5)
        .map(
          (p, i) =>
            `  ${i + 1}. ${p.title} — ${p.quantity_sold} units — $${p.revenue.toFixed(2)} revenue`,
        )
        .join('\n')
    : '  No product data available';

  // The #1 product by revenue — used to enforce real product name in activation
  const topProductName = snapshot.top_products[0]?.title ?? null;

  // ── Formatted metrics with WoW ─────────────────────────────────────────────
  const conversionPct = (snapshot.conversion_rate * 100).toFixed(2);
  const returningPct = (snapshot.returning_customer_rate * 100).toFixed(2);

  const revenueStr = withWow(`$${snapshot.total_revenue.toFixed(2)}`, snapshot.wow_revenue_pct ?? null);
  const ordersStr  = withWow(`${snapshot.total_orders}`, snapshot.wow_orders_pct ?? null);
  const aovStr     = withWow(`$${snapshot.average_order_value.toFixed(2)}`, snapshot.wow_aov_pct ?? null);
  const newCustStr = withWow(`${snapshot.new_customers}`, snapshot.wow_new_customers_pct ?? null);

  // ── Config notes ───────────────────────────────────────────────────────────
  const focusNote = config.focus_areas.length > 0
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

STORE DATA — YESTERDAY (with week-over-week comparison where available):
- Total revenue: ${revenueStr}
- Net revenue (after refunds): $${snapshot.net_revenue.toFixed(2)}
- Orders: ${ordersStr}
- Average order value: ${aovStr}
- Sessions: ${snapshot.sessions.toLocaleString()}
- Conversion rate: ${conversionPct}%
- New customers: ${newCustStr}
- Returning customers: ${snapshot.returning_customers} (${returningPct}% of buyers)
- Refunds: $${snapshot.total_refunds.toFixed(2)}
- Cancelled orders: ${snapshot.cancelled_orders}

TOP PRODUCTS (real product names — use these exactly in your output, never substitute generic terms):
${topProductsText}

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
    "revenue": <number — must match the raw revenue figure exactly>,
    "orders": <number — must match exactly>,
    "aov": <number — must match exactly>,
    "sessions": <number — must match exactly>,
    "conversion_rate": <decimal 0–1 — return the raw decimal, e.g. 0.0235 for 2.35%. Do NOT convert to a percentage.>,
    "new_customers": <number — must match exactly>,
    "top_product": "${topProductName ?? '<product name from TOP PRODUCTS list above>'}",
    "summary": "<ONE sentence spoken in your voice as the analyst. Start with 'I' or address ${ownerName} directly. Name the revenue, name what drove it or killed it. Example: 'I tracked $4,820 across 38 orders yesterday, ${ownerName} — your Vitamin C Serum carried the day but mobile conversion is where I'd be looking.' Be specific. No hedging.>"
  },
  "section_whats_working": {
    "items": [
      {
        "title": "<short label, 2-4 words>",
        "metric": "<value WITH week-over-week change — format: '38 orders ↑12% vs last week' or '$4,820 ↑8% vs last week'. Omit WoW only if no prior data.>",
        "insight": "<1-2 sentences in first person. Use 'I think', 'I traced this to', 'What this tells me is'. Interpret what the metric means — don't just restate it. Example: 'I think this is driven by your repeat buyers catching the restock — it won't hold unless you push a reorder prompt this week.'>"
      }
    ]
  },
  "section_whats_not_working": {
    "items": [
      {
        "title": "<short label, 2-4 words>",
        "metric": "<value WITH week-over-week change — same format as above. Omit WoW only if no prior data.>",
        "insight": "<1-2 sentences in first person. Say what you think is causing it. 'I traced this to...', 'My read is that...', 'I think what's happening is...'. No softening. Say what's broken and what the consequence is if it stays broken.>"
      }
    ]
  },
  "section_signal": {
    "headline": "<8-12 words. A sharp, declarative statement about what the market is doing.>",
    "market_context": "<2-3 sentences from your perspective as someone actively watching the market. Use 'I've been watching', 'I'm seeing', 'What I'm noticing is'. Share your interpretation — not just the facts.>",
    "store_implication": "<2-3 sentences connecting the market signal directly to ${storeName}'s actual numbers from yesterday. Use 'Given what I'm seeing in ${storeName}...', 'This matters for you because...'. State what you think should happen as a result.>"
  },
  "section_gap": {
    "gap": "<1-2 sentences. The single most important gap between what the store is doing and what it could do. Be specific.>",
    "opportunity": "<1-2 sentences. What capturing this gap looks like in concrete terms.>",
    "estimated_upside": "<A specific, credible number or range. E.g. '+$X in monthly revenue' or '+X% conversion'. Base it on the actual data.>"
  },
  "section_activation": {
    "what": "<One directive sentence. Not 'consider doing X' — just 'Do X today.' MUST name the actual product — use '${topProductName ?? 'the top product by name'}', not 'your product' or 'your top seller'.>",
    "why": "<2-3 sentences in first person explaining exactly why you're recommending this right now. 'I'm recommending this because...', 'I've been watching [X] and yesterday confirmed it...'. Reference specific numbers from yesterday's data.>",
    "how": [
      "<Step 1 — specific, actionable, completable in under 5 minutes. Use real product names.>",
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
- All numbers in section_yesterday must match the raw data exactly — do not round or approximate. conversion_rate must be the decimal 0–1 value (e.g. 0.0235), not a percentage
- section_activation how[] must have 4-6 steps, each completable in under 5 minutes
- Every metric in whats_working and whats_not_working must include the WoW comparison where data is available
- NEVER use generic product references ("your product", "your top seller", "your best item") — always use the exact product name from the TOP PRODUCTS list
- Return ONLY the JSON object. Nothing else.`;
}
