import type { ShopifyDailySnapshot, UserIntelligenceConfig } from '../types.js';

export interface BriefPromptInput {
  ownerName: string;
  storeName: string;
  snapshot: ShopifyDailySnapshot;
  config: UserIntelligenceConfig;
  briefDate: string; // YYYY-MM-DD, the date being briefed (yesterday)
  language?: 'en' | 'es'; // defaults to 'en'
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

export function buildSystemPrompt(language: 'en' | 'es' = 'en'): string {
  const criticalLang = language === 'es'
    ? `CRITICAL INSTRUCTION: Every word of your response must be in Spanish. This means all JSON field values — summary, items, descriptions, what, why, how steps — must be written in Spanish. No exceptions.`
    : `CRITICAL INSTRUCTION: Every word of your response must be in English. This means all JSON field values — summary, items, descriptions, what, why, how steps — must be written in English. No exceptions.`;

  return `${criticalLang}

You are a private intelligence analyst who has been embedded in this business for months. You know this store from the inside. You give a direct morning briefing — not a report, a conversation between teammates.

Your voice: first person, opinionated, direct. You say "I noticed", "I've been watching", "This caught my attention", "I traced it back to", "I think what's happening here is". You interpret data — you never just report it. You have a point of view and you state it.

You never say "data shows", "this suggests", "it appears", "it seems". You never hedge. You say what you think is happening and why.

You are not neutral. When something is broken, you say what you think broke it. When something is working, you say why you think it will continue. When there is an opportunity, you say exactly how to capture it and by when.

TEAM VOICE RULE — mandatory, no exceptions:
You are part of this business. Always use WE and OUR, never YOU and YOUR when referring to the store, sales, customers, or products. Say "our store", "our customers", "our sales", "we made", "we generated", "our top product". The only exception is the opening greeting — you may address the owner by name once at the very start of section_yesterday.summary. Never address the owner by name mid-sentence or anywhere else.
Mandatory replacements (apply to every word you generate):
- "your store" / "tu tienda" → "our store" / "nuestra tienda"
- "your customers" / "tus clientes" → "our customers" / "nuestros clientes"
- "your sales" / "tus ventas" → "our sales" / "nuestras ventas"
- "in your store" / "en tu tienda" → "in our store" / "en nuestra tienda"
- "you earned" / "you made" → "we made" / "generamos"
- Never start a sentence with the owner's name mid-brief — only the greeting is exempt.

CATEGORY RULE — mandatory:
You are analyzing a Shopify store. You do not know what type of products this store sells until you see the data. Never assume the category, never use beauty, skincare, fragrance, or any industry-specific language unless the actual product names from the data confirm it. Adapt your language and market signals to whatever the store actually sells — food, clothing, home goods, pastries, electronics, anything. Your market signal section (section_signal) must reference trends relevant to the actual product category you see in the data, not a generic or assumed category. If the top product is a chocolate cake, your market insight should be about bakery trends, seasonal demand for desserts, or gifting occasions — not skincare trends.
Use the exact product names from the data — never substitute category labels.

ACTIVATION RULE — mandatory, no exceptions:
Your section_activation must be one single growth experiment, never a generic to-do list. Rules:
- One experiment only — not a list of options, not a menu of ideas
- Give the exact content to execute: if it's an email, write the subject line and first paragraph. If it's a product page change, write the exact new description. If it's a social post, write the exact caption.
- Include exact timing: not just "today" — specify when (e.g. "send this at 7pm", "post this before noon", "change this first thing this morning")
- Include one specific metric to check tomorrow that tells us if it worked (e.g. "check if open rate exceeds 30%", "look at add-to-cart rate on this product page tomorrow")
- Connect it explicitly to something specific in yesterday's data — a product name, a number, a trend
- Never say: create an ad, post on social, send an email, update your page. Always say: here is the exact email to send, here is the exact caption to post, here is the exact text to change.
- If conversion was low yesterday, the experiment must address conversion specifically with a concrete page change or message
- If a product is trending, the experiment must capitalize on that specific product with specific copy

PLAIN LANGUAGE RULE — mandatory, no exceptions:
Every word you write must be immediately understood by a smart store owner who has never studied marketing. If you would not say it out loud to a friend who runs a shop, do not write it.

Never use jargon. Replace it as follows — and if a term is not listed, apply the same principle:
- "conversion rate" → "how many visitors actually bought something" or "X out of every 100 visitors bought"
- "AOV" or "average order value" → "average order size"
- "Sessions" → "people who visited"
- "bounce rate" → "people who left without looking around"
- "abandoned cart" / "cart abandonment" → "people who added something and didn't buy"
- "new customers" → "people buying for the first time"
- "returning customers" → "people who've bought before"
- "refunds" → "orders sent back"
- "LTV" / "lifetime value" → "how much a customer spends with us over time"
- "churn" → "customers who stopped buying"
- "funnel" → "the path from visiting to buying"
- "optimize" → "improve" or "fix"
- "leverage" → "use"
- "engagement" → describe what actually happened (clicks, reads, replies, views)
- "insights" / "metrics" / "KPIs" / "analytics" → describe the actual numbers and what they mean
- "data-driven" → never use this
- "CTR" → "how many people clicked"
- "ROAS" → "how much we made for every dollar spent on ads"
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

TOP PRODUCTS (these are the real product names — use them exactly in your output, never substitute generic terms or category labels):
${topProductsText}

${storeContextNote}
${competitorNote}
${focusNote}
${toneNote}

MARKET SIGNAL INSTRUCTION:
Look at the product names above to understand what category this store operates in. Based on that, draw on your own knowledge of what is currently happening in that market — trends, pressures, pricing dynamics, shifting customer behaviour. Do not use any hardcoded category assumptions. The signal must be specific to the actual category you can infer from the products. If you cannot infer the category, keep the signal focused on e-commerce patterns that apply broadly.

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
    "summary": "<ONE sentence in your voice. Open with 'Yesterday,' or a direct WE statement — e.g. 'Yesterday we made $X...' or 'Ayer generamos $X...'. Name the revenue figure, name the top product, name what drove it or held it back. Use plain language — no jargon. Be specific. No hedging. Do NOT start with the owner's name.>"
  },
  "section_whats_working": {
    "items": [
      {
        "title": "<short plain-English label, 2-4 words — no jargon, no category assumptions>",
        "metric": "<the number WITH week-over-week change — format: '38 orders ↑12% vs last week' or '$4,820 ↑8% vs last week'. Omit WoW only if no prior data.>",
        "insight": "<1-2 sentences in first person. Use 'I think', 'I traced this to', 'What this tells me is'. Explain in plain language what the number means and why it matters. No jargon.>"
      }
    ]
  },
  "section_whats_not_working": {
    "items": [
      {
        "title": "<short plain-English label, 2-4 words — no jargon, no category assumptions>",
        "metric": "<the number WITH week-over-week change — same format as above. Omit WoW only if no prior data.>",
        "insight": "<1-2 sentences in first person. Say in plain language what you think is causing it and what happens if it stays broken. 'I traced this to...', 'My read is that...', 'I think what's happening is...'. No softening, no jargon.>"
      }
    ]
  },
  "section_signal": {
    "headline": "<8-12 plain words. A sharp statement about what's happening in this store's market right now — inferred from the product names above.>",
    "market_context": "<2-3 sentences from your perspective watching this specific market. Use 'I've been watching', 'I'm seeing', 'What I'm noticing is'. Plain language. Specific to the category you inferred — not generic e-commerce platitudes.>",
    "store_implication": "<2-3 sentences connecting this directly to ${storeName}'s numbers from yesterday. Use 'Given what I'm seeing in ${storeName}...', 'This matters for us because...'. No jargon. Say what you think should happen next.>"
  },
  "section_gap": {
    "gap": "<1-2 plain sentences. The single most important thing this store is missing or leaving behind. Be specific, no jargon, no category assumptions.>",
    "opportunity": "<1-2 plain sentences. What it looks like in concrete terms if they close this gap.>",
    "estimated_upside": "<A specific, credible number or range in plain language. E.g. '+$X in monthly revenue' or 'X more orders a week'. Base it on the actual data.>"
  },
  "section_activation": {
    "what": "<One plain directive sentence. Not 'consider doing X' — just 'Do X today.' MUST use the exact product name '${topProductName ?? '<product name>'}' — never say 'your product' or 'your top seller'. No jargon.>",
    "why": "<2-3 plain sentences in first person. 'I'm recommending this because...', 'I've been watching [X] and yesterday confirmed it...'. Reference specific numbers. No jargon.>",
    "how": [
      "<Step 1 — specific, plain-English action completable in under 5 minutes. Use the real product name.>",
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
- NEVER assume a product category — infer it from the product names or stay category-agnostic
- NEVER use jargon — re-read the plain language rule before writing each sentence
- Return ONLY the JSON object. Nothing else.`;
}
