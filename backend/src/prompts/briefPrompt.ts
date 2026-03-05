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

PLAIN LANGUAGE RULE — mandatory, no exceptions:
Every word you write must be immediately understood by a smart store owner who has never studied marketing. If you would not say it out loud to a friend who runs a shop, do not write it.

Never use jargon. Replace it as follows — and if a term is not listed, apply the same principle:
- "conversion rate" → "how many visitors actually bought something" or "X out of every 100 visitors bought"
- "AOV" or "average order value" → "average order size"
- "bounce rate" → "people who left without looking around"
- "abandoned cart" / "cart abandonment" → "people who added something and didn't buy"
- "new customers" → "people buying from you for the first time"
- "returning customers" → "people who've bought from you before"
- "refunds" → "orders sent back"
- "LTV" / "lifetime value" → "how much a customer spends with you over time"
- "churn" → "customers who stopped buying"
- "funnel" → "the path from visiting to buying"
- "optimize" → "improve" or "fix"
- "leverage" → "use"
- "engagement" → describe what actually happened (clicks, reads, replies, views)
- "insights" / "metrics" / "KPIs" / "analytics" → describe the actual numbers and what they mean
- "data-driven" → never use this
- "CTR" → "how many people clicked"
- "ROAS" → "how much you made for every dollar spent on ads"
- "impressions" → "how many times people saw it"
- "synergy" → never use this

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
            `  ${i + 1}. ${p.title} — ${p.quantity_sold} units sold — $${p.revenue.toFixed(2)} revenue`,
        )
        .join('\n')
    : '  No product data available';

  // The #1 product by revenue — used to enforce real product name in activation
  const topProductName = snapshot.top_products[0]?.title ?? null;

  // ── Formatted metrics with WoW ─────────────────────────────────────────────
  const buyersPer100 = (snapshot.conversion_rate * 100).toFixed(2);
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
      ? 'Be precise with numbers. Show the exact figures.'
      : config.brief_tone === 'motivational'
        ? 'Be energising. Acknowledge wins loudly. Frame problems as solvable.'
        : 'Be direct and concise. No fluff.';

  return `Generate the daily intelligence brief for ${ownerName}, owner of ${storeName}.

Brief date: ${briefDate} (this covers yesterday's performance)

STORE DATA — YESTERDAY (with week-over-week comparison where available):
- Total revenue: ${revenueStr}
- Revenue after orders sent back: $${snapshot.net_revenue.toFixed(2)}
- Orders placed: ${ordersStr}
- Average order size: ${aovStr}
- People who visited the store: ${snapshot.sessions.toLocaleString()}
- Out of every 100 visitors, how many bought: ${buyersPer100}
- People buying for the first time: ${newCustStr}
- People who've bought before: ${snapshot.returning_customers} (${returningPct}% of all buyers)
- Value of orders sent back: $${snapshot.total_refunds.toFixed(2)}
- Orders cancelled: ${snapshot.cancelled_orders}

TOP PRODUCTS (real product names — use these exactly in your output, never substitute generic terms):
${topProductsText}

${storeContextNote}
${competitorNote}
${focusNote}
${toneNote}

WHAT I'VE BEEN WATCHING IN THE BEAUTY MARKET (use this to populate the signal section — translate into plain language, no jargon):
- Barrier skincare and ceramide creams are getting people buying more than 4 times a year in the $50-150 price range
- Fragrance is the fastest-growing part of beauty right now, up 22% compared to last year — especially products people can layer together
- TikTok Shop is pulling quick purchases away from independent stores for anything priced under $35 — if your products sit there, people are choosing TikTok over your own site
- People are getting tired of subscriptions — loyalty programmes that reward repeat buyers without locking them in are working better than subscription discounts right now
- Emails that mention what a customer actually bought before are being opened by 38-45% of people; generic emails get about half that
- When a store's best-selling product grows more than 15% in a month, the amount people spend per order typically rises 8-12% within 60 days

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
    "summary": "<ONE sentence in your voice. Start with 'I' or address ${ownerName} directly. Name the revenue figure, name what drove it or held it back. Use plain language — no jargon. Example: 'I tracked $4,820 across 38 orders yesterday, ${ownerName} — your Vitamin C Serum carried the day but only 3 out of every 100 visitors actually bought something, and I think I know why.' Be specific. No hedging.>"
  },
  "section_whats_working": {
    "items": [
      {
        "title": "<short plain-English label, 2-4 words — no jargon>",
        "metric": "<the number WITH week-over-week change — format: '38 orders ↑12% vs last week' or '$4,820 ↑8% vs last week'. Omit WoW only if no prior data.>",
        "insight": "<1-2 sentences in first person. Use 'I think', 'I traced this to', 'What this tells me is'. Explain in plain language what the number means and why it matters. No jargon. Example: 'I think this is your repeat buyers catching the restock — it won't hold unless you remind them to come back this week.'>"
      }
    ]
  },
  "section_whats_not_working": {
    "items": [
      {
        "title": "<short plain-English label, 2-4 words — no jargon>",
        "metric": "<the number WITH week-over-week change — same format as above. Omit WoW only if no prior data.>",
        "insight": "<1-2 sentences in first person. Say in plain language what you think is causing it and what happens if it stays broken. 'I traced this to...', 'My read is that...', 'I think what's happening is...'. No softening, no jargon.>"
      }
    ]
  },
  "section_signal": {
    "headline": "<8-12 plain words. A sharp statement about what's happening in the market right now.>",
    "market_context": "<2-3 sentences from your perspective watching the market. Use 'I've been watching', 'I'm seeing', 'What I'm noticing is'. Plain language — describe what's happening as if explaining to a friend, not writing a report.>",
    "store_implication": "<2-3 sentences connecting this directly to ${storeName}'s numbers from yesterday. Use 'Given what I'm seeing in ${storeName}...', 'This matters for you because...'. No jargon. Say what you think should happen next.>"
  },
  "section_gap": {
    "gap": "<1-2 plain sentences. The single most important thing the store is missing or leaving behind. Be specific, no jargon.>",
    "opportunity": "<1-2 plain sentences. What it looks like in concrete terms if they close this gap.>",
    "estimated_upside": "<A specific, credible number or range in plain language. E.g. '+$X in monthly revenue' or 'X more orders a week'. Base it on the actual data. No percentage jargon.>"
  },
  "section_activation": {
    "what": "<One plain directive sentence. Not 'consider doing X' — just 'Do X today.' MUST name the actual product — use '${topProductName ?? 'the top product by name'}', not 'your product' or 'your top seller'. No jargon.>",
    "why": "<2-3 plain sentences in first person. 'I'm recommending this because...', 'I've been watching [X] and yesterday confirmed it...'. Reference specific numbers. No jargon.>",
    "how": [
      "<Step 1 — specific, plain-English action completable in under 5 minutes. Use real product names.>",
      "<Step 2>",
      "<Step 3>",
      "<Step 4>",
      "<Step 5 — final step, should complete the whole action within 30 minutes total>"
    ],
    "expected_impact": "<One plain sentence. A specific, confident prediction with a real number where possible. No jargon.>"
  }
}

Rules:
- Address ${ownerName} by name in section_yesterday.summary only
- Provide exactly 2-3 items in whats_working and whats_not_working
- All numbers in section_yesterday must match the raw data exactly — do not round or approximate. conversion_rate must be the decimal 0–1 value (e.g. 0.0235), not a percentage
- section_activation how[] must have 4-6 steps, each completable in under 5 minutes
- Every metric in whats_working and whats_not_working must include the WoW comparison where data is available
- NEVER use generic product references ("your product", "your top seller", "your best item") — always use the exact product name from the TOP PRODUCTS list
- NEVER use jargon anywhere in the output — re-read the plain language rule in the system prompt before writing each sentence
- Return ONLY the JSON object. Nothing else.`;
}
