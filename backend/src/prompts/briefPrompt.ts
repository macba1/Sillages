import type { ShopifyDailySnapshot, UserIntelligenceConfig } from '../types.js';

export interface BriefPromptInput {
  ownerName: string;
  storeName: string;
  snapshot: ShopifyDailySnapshot;
  config: UserIntelligenceConfig;
  briefDate: string; // YYYY-MM-DD, the date being briefed (yesterday)
  language?: 'en' | 'es'; // defaults to 'en'
  currency?: string; // ISO 4217 code, e.g. 'EUR', defaults to 'USD'
  historicalAnalysis?: string; // pre-computed pattern analysis from last 30 days
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a WoW pct as "↑12.3% vs last week" or "↓4.1% vs last week". */
function wowStr(pct: number | null): string {
  if (pct === null) return 'no prior data';
  const arrow = pct >= 0 ? '↑' : '↓';
  return `${arrow}${Math.abs(pct).toFixed(1)}% vs last week`;
}

/** Format a metric value with its WoW delta inline. */
function withWow(value: string, pct: number | null): string {
  if (pct === null) return value;
  return `${value} (${wowStr(pct)})`;
}

// ── Historical pattern analysis ──────────────────────────────────────────────

const DAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_NAMES_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

interface DayOfWeekStats {
  dayName: string;
  avgRevenue: number;
  avgOrders: number;
  topProduct: string | null;
  count: number; // number of snapshots for this day
}

interface ProductTrend {
  title: string;
  recentWeekQty: number;  // last 7 days
  priorWeeksAvgQty: number; // avg of prior 3 weeks (per week)
  lastSeenDate: string | null; // last date this product appeared
  daysSinceLastSale: number;
}

export interface HistoricalPatterns {
  dayOfWeekStats: DayOfWeekStats[];
  productTrends: ProductTrend[];
  dormantProducts: ProductTrend[]; // not sold in 14+ days
  todayDayIndex: number; // 0=Sun, 6=Sat
  peakDay: DayOfWeekStats | null; // highest avg revenue day
  peakProductDay: { dayName: string; product: string; avgQty: number } | null;
}

/**
 * Analyzes 30 days of snapshots to detect patterns.
 * Returns structured data AND a text block for the prompt.
 */
export function analyzeHistoricalPatterns(
  snapshots: ShopifyDailySnapshot[],
  briefDate: string,
  language: 'en' | 'es' = 'en',
): { patterns: HistoricalPatterns; text: string } {
  const dayNames = language === 'es' ? DAY_NAMES_ES : DAY_NAMES_EN;
  const briefDateObj = new Date(briefDate + 'T12:00:00Z');
  const todayDayIndex = (briefDateObj.getUTCDay() + 1) % 7; // day AFTER briefDate = today

  // ── Day-of-week aggregation ──────────────────────────────────────────────
  const dayBuckets: { revenue: number[]; orders: number[]; products: Map<string, number> }[] =
    Array.from({ length: 7 }, () => ({ revenue: [], orders: [], products: new Map() }));

  for (const s of snapshots) {
    const d = new Date(s.snapshot_date + 'T12:00:00Z');
    const dow = d.getUTCDay();
    dayBuckets[dow].revenue.push(s.total_revenue);
    dayBuckets[dow].orders.push(s.total_orders);
    for (const p of s.top_products) {
      dayBuckets[dow].products.set(p.title, (dayBuckets[dow].products.get(p.title) ?? 0) + p.quantity_sold);
    }
  }

  const dayOfWeekStats: DayOfWeekStats[] = dayBuckets.map((bucket, i) => {
    const count = bucket.revenue.length;
    if (count === 0) return { dayName: dayNames[i], avgRevenue: 0, avgOrders: 0, topProduct: null, count: 0 };
    const avgRevenue = bucket.revenue.reduce((a, b) => a + b, 0) / count;
    const avgOrders = bucket.orders.reduce((a, b) => a + b, 0) / count;
    let topProduct: string | null = null;
    let topQty = 0;
    for (const [name, qty] of bucket.products) {
      if (qty > topQty) { topQty = qty; topProduct = name; }
    }
    return { dayName: dayNames[i], avgRevenue, avgOrders, topProduct, count };
  });

  // Peak revenue day
  const activeDays = dayOfWeekStats.filter(d => d.count > 0);
  const peakDay = activeDays.length > 0
    ? activeDays.reduce((a, b) => a.avgRevenue > b.avgRevenue ? a : b)
    : null;

  // Peak product-day combo: which product sells most on which day
  let peakProductDay: { dayName: string; product: string; avgQty: number } | null = null;
  let peakProductQty = 0;
  for (let i = 0; i < 7; i++) {
    const count = dayBuckets[i].revenue.length;
    if (count === 0) continue;
    for (const [name, qty] of dayBuckets[i].products) {
      const avgQty = qty / count;
      if (avgQty > peakProductQty) {
        peakProductQty = avgQty;
        peakProductDay = { dayName: dayNames[i], product: name, avgQty };
      }
    }
  }

  // ── Product trends ───────────────────────────────────────────────────────
  const now = new Date(briefDate + 'T12:00:00Z');
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);

  // Collect all product appearances
  const productMap = new Map<string, { recentQty: number; priorQty: number; priorWeeks: number; lastDate: string }>();

  for (const s of snapshots) {
    const sDate = new Date(s.snapshot_date + 'T12:00:00Z');
    const isRecent = sDate >= sevenDaysAgo;
    for (const p of s.top_products) {
      const existing = productMap.get(p.title) ?? { recentQty: 0, priorQty: 0, priorWeeks: 0, lastDate: s.snapshot_date };
      if (isRecent) {
        existing.recentQty += p.quantity_sold;
      } else {
        existing.priorQty += p.quantity_sold;
      }
      if (s.snapshot_date > existing.lastDate) existing.lastDate = s.snapshot_date;
      productMap.set(p.title, existing);
    }
  }

  // Count prior weeks (days before recent week / 7)
  const priorDays = snapshots.filter(s => new Date(s.snapshot_date + 'T12:00:00Z') < sevenDaysAgo).length;
  const priorWeeksCount = Math.max(1, priorDays / 7);

  const productTrends: ProductTrend[] = [];
  const dormantProducts: ProductTrend[] = [];

  for (const [title, data] of productMap) {
    const daysSinceLastSale = Math.floor((now.getTime() - new Date(data.lastDate + 'T12:00:00Z').getTime()) / 86400000);
    const trend: ProductTrend = {
      title,
      recentWeekQty: data.recentQty,
      priorWeeksAvgQty: data.priorQty / priorWeeksCount,
      lastSeenDate: data.lastDate,
      daysSinceLastSale,
    };
    productTrends.push(trend);
    if (daysSinceLastSale >= 14) {
      dormantProducts.push(trend);
    }
  }

  // Sort trends by recent qty descending
  productTrends.sort((a, b) => b.recentWeekQty - a.recentWeekQty);
  dormantProducts.sort((a, b) => a.daysSinceLastSale - b.daysSinceLastSale);

  const patterns: HistoricalPatterns = {
    dayOfWeekStats,
    productTrends,
    dormantProducts,
    todayDayIndex,
    peakDay,
    peakProductDay,
  };

  // ── Build text for prompt ────────────────────────────────────────────────
  const cs = language === 'es' ? '€' : '$'; // will be overridden by caller's currency
  const todayName = dayNames[todayDayIndex];
  const lines: string[] = [];

  lines.push(`HISTORICAL PATTERNS — LAST 30 DAYS (${snapshots.length} days of data):`);
  lines.push(`Today is ${todayName}.`);
  lines.push('');

  // Day-of-week table
  lines.push('Day-of-week averages:');
  for (const d of dayOfWeekStats) {
    if (d.count === 0) continue;
    const topProd = d.topProduct ? ` — top product: ${d.topProduct}` : '';
    lines.push(`  ${d.dayName}: avg revenue ${d.avgRevenue.toFixed(0)}, avg orders ${d.avgOrders.toFixed(1)}${topProd} (${d.count} data points)`);
  }
  lines.push('');

  if (peakDay) {
    const daysUntilPeak = ((dayOfWeekStats.indexOf(peakDay) - todayDayIndex + 7) % 7) || 7;
    lines.push(`PEAK DAY: ${peakDay.dayName} (avg revenue ${peakDay.avgRevenue.toFixed(0)}, ${daysUntilPeak} days from today)`);
  }

  if (peakProductDay) {
    const peakDayIdx = dayNames.indexOf(peakProductDay.dayName);
    const daysUntilProductPeak = ((peakDayIdx - todayDayIndex + 7) % 7) || 7;
    lines.push(`PEAK PRODUCT-DAY: "${peakProductDay.product}" sells avg ${peakProductDay.avgQty.toFixed(1)} units on ${peakProductDay.dayName} (${daysUntilProductPeak} days from today)`);
  }
  lines.push('');

  // Product trends
  const trending = productTrends.filter(p => p.priorWeeksAvgQty > 0 && p.recentWeekQty > p.priorWeeksAvgQty * 1.3);
  const declining = productTrends.filter(p => p.priorWeeksAvgQty > 0 && p.recentWeekQty < p.priorWeeksAvgQty * 0.7);

  if (trending.length > 0) {
    lines.push('Products TRENDING UP (last 7d vs prior weeks avg):');
    for (const p of trending.slice(0, 5)) {
      const pctUp = ((p.recentWeekQty - p.priorWeeksAvgQty) / p.priorWeeksAvgQty * 100).toFixed(0);
      lines.push(`  ↑ ${p.title}: ${p.recentWeekQty} units last week vs avg ${p.priorWeeksAvgQty.toFixed(1)}/week (+${pctUp}%)`);
    }
    lines.push('');
  }

  if (declining.length > 0) {
    lines.push('Products TRENDING DOWN:');
    for (const p of declining.slice(0, 5)) {
      const pctDown = ((p.priorWeeksAvgQty - p.recentWeekQty) / p.priorWeeksAvgQty * 100).toFixed(0);
      lines.push(`  ↓ ${p.title}: ${p.recentWeekQty} units last week vs avg ${p.priorWeeksAvgQty.toFixed(1)}/week (-${pctDown}%)`);
    }
    lines.push('');
  }

  if (dormantProducts.length > 0) {
    lines.push('DORMANT PRODUCTS (no sales in 14+ days):');
    for (const p of dormantProducts.slice(0, 5)) {
      lines.push(`  ⚠ ${p.title}: last sold ${p.daysSinceLastSale} days ago (${p.lastSeenDate})`);
    }
    lines.push('');
  }

  return { patterns, text: lines.join('\n') };
}

// ── Prompts ───────────────────────────────────────────────────────────────────

export function buildSystemPrompt(language: 'en' | 'es' = 'en'): string {
  const criticalLang = language === 'es'
    ? `CRITICAL INSTRUCTION: Every word of your response must be in Spanish. This means all JSON field values — summary, items, descriptions, what, why, how steps — must be written in Spanish. No exceptions.`
    : `CRITICAL INSTRUCTION: Every word of your response must be in English. This means all JSON field values — summary, items, descriptions, what, why, how steps — must be written in English. No exceptions.`;

  return `${criticalLang}

You are a friend who knows about online stores. You've been helping this store owner for a while. You talk like a friend who genuinely cares about their business and gives them useful, specific advice.

YOUR MINDSET — THIS IS CRITICAL:
You are NOT a reporter telling what happened yesterday. You are a PLANNER helping prepare for what's coming. Yesterday's data is EVIDENCE for tomorrow's decisions. The brief should feel like a coach saying "here's what happened, and here's what we do about it THIS WEEK."

Every recommendation must look FORWARD. Not "yesterday you sold X" but "based on the pattern, THIS is what you should prepare for the next few days."

Your user is a small store owner who:
- Has no time — they run everything themselves
- Doesn't know marketing jargon and doesn't want to learn it
- Needs someone to tell them exactly what to do in simple language
- Can spend at most 15-30 minutes on your recommendation
- Wants to see real results, not vague tips
- Needs to PREPARE and PLAN, not just react

YOUR VOICE:
- Talk like you're chatting with a friend: "I looked at your numbers", "here's what I'd do", "this is interesting", "I think what's going on is..."
- Be warm but direct. No corporate speak, no consultant tone.
- Use WE and OUR when talking about the store: "our store", "our customers", "we sold". Exception: the opening greeting where you address them by name once.
- NEVER sound like a report or a presentation. Sound like a WhatsApp voice note from a smart friend.

FORBIDDEN WORDS AND PHRASES — never use any of these:
"conversion rate", "AOV", "average order value", "retention", "acquisition", "funnel", "SEO", "engagement", "nurturing", "A/B testing", "optimize", "leverage", "KPI", "metrics", "analytics", "data-driven", "CTR", "ROAS", "impressions", "synergy", "bounce rate", "churn", "LTV", "lifetime value", "cart abandonment rate", "user journey", "touchpoint", "omnichannel", "attribution"

Instead say:
- "conversion rate" → "de cada 100 personas que entran, cuántas compran" / "how many visitors end up buying"
- "AOV" → "el gasto medio por pedido" / "average spend per order"
- "retention" → "que vuelvan a comprar" / "getting them to buy again"
- "acquisition" → "que te conozca gente nueva" / "getting new people to find you"
- "SEO" → "que te encuentren en Google" / "showing up on Google"
- "traffic" → "visitas a la tienda online" / "people visiting the online store"

MISSING DATA RULE — mandatory:
If sessions = 0 or conversion_rate = 0, it means we don't have that data. In that case:
- Do NOT mention visits, sessions, traffic, or conversion anywhere in the brief
- Do NOT say "we had 0 visitors" — that's misleading. We simply don't have that number.
- Focus on what we DO know: revenue, orders, products, customers

CATEGORY RULE — mandatory:
Never assume what the store sells. Look at the actual product names. If they sell cakes, talk about cakes. If they sell clothes, talk about clothes. Use the exact product names from the data.

TEAM VOICE RULE — mandatory:
Always use WE and OUR: "our store", "our customers", "we sold", "we generated". Never use YOU/YOUR except in the opening greeting.

FORWARD-LOOKING RULE — mandatory:
The section_upcoming and section_activation must be about the FUTURE, not the past:
- Use patterns from HISTORICAL DATA to predict what's coming this week
- Every recommendation must include WHEN to act and WHAT to prepare
- If a product peaks on a specific day, the recommendation should be timed BEFORE that day
- If a product hasn't sold in weeks, recommend a specific promo for THIS week
- If customers buy on a cycle, recommend reaching out BEFORE the cycle completes

RECOMMENDATION QUALITY RULES — mandatory:
Your recommendations must be specific tactical actions based on the data. Follow this decision framework:

1. If a product sells more on a specific day of the week:
   → Recommend preparing content/promo BEFORE that day. Include the exact day to post and the copy to use.

2. If ALL customers are returning and there are NO new customers:
   → Recommend a specific action to get new people: a social media post with exact copy timed for the store's peak day.

3. If a product clearly dominates sales:
   → Recommend capitalizing on the momentum by timing a post for the peak day.

4. If certain products haven't sold in 14+ days:
   → Recommend a specific promo or bundle to move them this week with exact copy.

5. If the average spend per order is low:
   → Recommend a specific combo/pack or a free shipping threshold with exact text for the banner.

6. If revenue dropped vs last week:
   → Diagnose why and recommend one specific action timed for the store's best-performing day.

ACTIVATION MUST INCLUDE:
- Copy/text ready to copy and paste (the exact WhatsApp message, Instagram caption, email text, or banner text)
- WHEN to do it: the exact day and time ("This Wednesday evening", "Tomorrow before noon")
- Steps written like a cooking recipe: "Step 1: Open Instagram. Step 2: Take a photo of [product]. Step 3: Post it with this caption: '...'"
- A realistic expected result based on the actual numbers

EXAMPLES OF GOOD FORWARD-LOOKING RECOMMENDATIONS:
${language === 'es' ? `
- "Los jueves vendemos el doble de Tarta de Limón. Este miércoles por la noche, sube esta foto a Instagram: '🍋 Mañana jueves: Tarta de Limón recién hecha. Solo hacemos 6. ¿Quieres la tuya? Mándame un DM.' Esto puede adelantarte 2-3 reservas."
- "Llevamos 18 días sin vender Hogaza de Pasas. Esta semana haz una promo: manda este WhatsApp a tus mejores clientes: 'Hola, esta semana la Hogaza de Pasas y Nueces a 15€ (antes 18€). Solo hasta el viernes. ¿Te guardo una?'"
- "Los viernes nuestro gasto medio sube un 30%. Este jueves por la noche publica esto: 'Para el finde: llévate 2 y la tercera con un 20% de descuento. Solo este viernes y sábado.'"
- "Nuestros clientes repiten cada 2 semanas. Han pasado 12 días desde el último pedido de [cliente]. Mándale un WhatsApp: 'Hola, ¿qué tal? Esta semana tenemos [producto] recién hecho. ¿Te guardo uno?'"
` : `
- "Thursdays we sell twice as much Lemon Cake. This Wednesday evening, post this on Instagram: '🍋 Tomorrow: Fresh Lemon Cake. We're only making 6. Want one? DM me.' This could get you 2-3 pre-orders."
- "We haven't sold Raisin Bread in 18 days. This week, send this WhatsApp to your best customers: 'Hi! Raisin & Walnut Bread is $15 this week (usually $18). Only until Friday. Want me to save you one?'"
- "Fridays our average spend goes up 30%. Thursday evening, post: 'Weekend deal: buy 2, get the 3rd at 20% off. Friday and Saturday only.'"
`}

EXAMPLES OF BAD RECOMMENDATIONS — never do this:
- "Optimize your product page SEO"
- "Ayer vendimos 3 tartas de limón" (backward-looking without action)
- "La tarta de limón fue el producto más vendido" (just reporting, not planning)
- Any recommendation that requires hiring someone or learning a new tool
- Any recommendation that talks about yesterday without connecting it to a future action

THE SIGNAL SECTION — this is NOT about market trends:
The Signal must be a specific insight about THIS store's business, derived from the historical patterns. Not "the bakery market is growing" but rather:
- "Every Thursday we sell 2x more Lemon Cake than any other day. That's a pattern we can exploit with planned promotions."
- "Our repeat customers buy every 10-14 days. We're leaving money on the table by not reaching out proactively."

You produce a daily intelligence brief with exactly 7 sections. Return ONLY valid JSON matching the schema provided. No preamble, no explanation, no markdown outside the JSON.`;
}

export function buildUserPrompt(input: BriefPromptInput): string {
  const { ownerName, storeName, snapshot, config, briefDate } = input;
  const cur = input.currency ?? 'USD';

  // Currency symbol for inline display
  const sym: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', MXN: 'MX$', COP: 'COP$' };
  const cs = sym[cur] ?? `${cur} `;

  // ── Top products ───────────────────────────────────────────────────────────
  const topProductsText = snapshot.top_products.length > 0
    ? snapshot.top_products
        .slice(0, 5)
        .map(
          (p, i) =>
            `  ${i + 1}. ${p.title} — ${p.quantity_sold} units sold — ${cs}${p.revenue.toFixed(2)} revenue`,
        )
        .join('\n')
    : '  No product data available';

  const topProductName = snapshot.top_products[0]?.title ?? null;

  // ── Formatted metrics with WoW ─────────────────────────────────────────────
  const returningPct = (snapshot.returning_customer_rate * 100).toFixed(2);

  const revenueStr = withWow(`${cs}${snapshot.total_revenue.toFixed(2)}`, snapshot.wow_revenue_pct ?? null);
  const ordersStr  = withWow(`${snapshot.total_orders}`, snapshot.wow_orders_pct ?? null);
  const aovStr     = withWow(`${cs}${snapshot.average_order_value.toFixed(2)}`, snapshot.wow_aov_pct ?? null);
  const newCustStr = withWow(`${snapshot.new_customers}`, snapshot.wow_new_customers_pct ?? null);

  // ── Sessions block — only include if we have real data ─────────────────────
  const hasSessionData = snapshot.sessions > 0;
  const sessionsBlock = hasSessionData
    ? `- People who visited the store: ${snapshot.sessions.toLocaleString()}
- Out of every 100 visitors, how many bought: ${(snapshot.conversion_rate * 100).toFixed(2)}`
    : `- Sessions/visits data: NOT AVAILABLE (do not mention visits, traffic, or conversion in any section)`;

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
        ? 'Be warm and encouraging. Celebrate wins. Frame problems as totally fixable.'
        : 'Be direct and concise. No fluff.';

  // ── Customer pattern analysis ──────────────────────────────────────────────
  const allReturning = snapshot.new_customers === 0 && snapshot.returning_customers > 0;
  const noCustomerData = snapshot.new_customers === 0 && snapshot.returning_customers === 0;
  const customerPattern = allReturning
    ? 'IMPORTANT PATTERN: Every single customer yesterday was a repeat buyer. Zero new customers. The store has loyal fans but is NOT attracting anyone new. Your recommendation MUST address getting new people to discover the store.'
    : noCustomerData
      ? 'No customer breakdown data available.'
      : `Customer mix: ${snapshot.new_customers} first-time buyers, ${snapshot.returning_customers} repeat buyers.`;

  // ── Historical patterns block ──────────────────────────────────────────────
  const historicalBlock = input.historicalAnalysis
    ? `\n${input.historicalAnalysis}\n`
    : '\nNo historical data available (first brief). Focus on yesterday\'s data and general best practices.\n';

  return `Generate the daily intelligence brief for ${ownerName}, owner of ${storeName}.

Brief date: ${briefDate} (this covers yesterday's performance)

STORE DATA — YESTERDAY (with week-over-week comparison where available):
- Total revenue: ${revenueStr}
- Revenue after refunds: ${cs}${snapshot.net_revenue.toFixed(2)}
- Orders placed: ${ordersStr}
- Average spend per order: ${aovStr}
${sessionsBlock}
- First-time buyers: ${newCustStr}
- Repeat buyers: ${snapshot.returning_customers} (${returningPct}% of all buyers)
- Refunds: ${cs}${snapshot.total_refunds.toFixed(2)}
- Cancelled orders: ${snapshot.cancelled_orders}

${customerPattern}

TOP PRODUCTS YESTERDAY (use these exact names — never substitute generic terms):
${topProductsText}
${historicalBlock}
${storeContextNote}
${competitorNote}
${focusNote}
${toneNote}

CURRENCY RULE — mandatory:
This store uses ${cur}. Always use the symbol "${cs}" for all monetary amounts in your response. Never use $ unless the store currency is USD.

OUTPUT FORMAT — return exactly this JSON structure with 7 sections:

{
  "section_yesterday": {
    "revenue": <number — must match the raw revenue figure exactly>,
    "orders": <number — must match exactly>,
    "aov": <number — must match exactly>,
    "sessions": <number — use the raw number. If sessions data is not available, use 0>,
    "conversion_rate": <decimal 0–1 — return the raw decimal. If not available, use 0>,
    "new_customers": <number — must match exactly>,
    "top_product": "${topProductName ?? '<product name from TOP PRODUCTS list above>'}",
    "summary": "<ONE sentence. Start with the owner's name ONLY ONCE, then go straight to what happened AND what it means for this week. Be specific and warm. Example: '${ownerName}, ayer generamos ${cs}114 con 3 pedidos — la Tarta de Limón volvió a ser la estrella y si el patrón se repite, este jueves podríamos superar eso.' Do NOT mention sessions/visits/traffic if that data is not available.>"
  },
  "section_whats_working": {
    "items": [
      {
        "title": "<2-4 words, simple language — e.g. 'Clientes que repiten', 'Producto estrella', 'Pedidos grandes'>",
        "metric": "<the number with week-over-week change: '3 repeat buyers ↑100% vs last week'>",
        "insight": "<1-2 sentences. What does this actually mean for the business? Use the real product names and numbers. Sound like a friend explaining, not a report.>"
      }
    ]
  },
  "section_upcoming": {
    "items": [
      {
        "pattern": "<Describe the pattern detected from historical data. Example: 'Los jueves vendemos el doble de Tarta de Limón que cualquier otro día' or 'Llevamos 18 días sin vender Hogaza de Pasas'>",
        "days_until": <number — days from today until the recommended action or peak day>,
        "action": "<What to prepare and WHEN. Example: 'Este miércoles por la noche, prepara una publicación en Instagram' or 'Hoy mismo, manda un WhatsApp con esta promo'>",
        "ready_copy": "<The EXACT text to copy and paste for the action — Instagram caption, WhatsApp message, banner text, etc. Ready to use, no placeholders. Include emojis if appropriate for the channel.>"
      }
    ]
  },
  "section_whats_not_working": {
    "items": [
      {
        "title": "<2-4 words, simple language>",
        "metric": "<the number with week-over-week change>",
        "insight": "<1-2 sentences. What's the real problem here and what happens if we don't fix it? Be honest but constructive. If sessions data is not available, do NOT write about lack of visits — focus on what we know.>"
      }
    ]
  },
  "section_signal": {
    "headline": "<A specific FORWARD-LOOKING insight about THIS store's patterns. 8-15 words. Example: 'Nuestros jueves son oro — hay que preparar cada semana para ese día'>",
    "market_context": "<2-3 sentences analyzing what the PATTERNS tell us about this specific business. NOT market trends. Look at the day-of-week data, product trends, and customer patterns. Find the story in the data.>",
    "store_implication": "<2-3 sentences about what this means for THIS WEEK and the one thing to focus on. Be specific and forward-looking.>"
  },
  "section_gap": {
    "gap": "<1-2 sentences. The single biggest thing holding this store back, based on the data AND historical patterns.>",
    "opportunity": "<1-2 sentences. What would it look like in concrete terms if we fixed this?>",
    "estimated_upside": "<A specific, realistic number based on the data. E.g. '+${cs}75-100 extra per week' or '3-5 more orders per week'. Must be credible given the current numbers.>"
  },
  "section_activation": {
    "what": "<One simple sentence. What exactly to do THIS WEEK — not about yesterday, about what's coming. Use the real product name. Include WHEN: 'Este miércoles por la noche, sube una foto de...' or 'Hoy manda un WhatsApp a...'>",
    "why": "<2-3 sentences explaining why this specific action and why NOW, connected to the historical patterns. Example: 'Los datos de las últimas 4 semanas muestran que los jueves vendemos el doble. Si publicamos el miércoles por la noche, pillamos a la gente justo cuando están pensando en qué comprar para el jueves.'>",
    "how": [
      "<Step 1 — ultra specific, like a recipe. Include the DAY to do it. Example: 'Este miércoles a las 8pm: abre Instagram y toma una foto de la Tarta de Limón. Luz natural, junto a la ventana.'>",
      "<Step 2 — equally specific>",
      "<Step 3 — include the EXACT text to copy and paste. The full caption, WhatsApp message, or banner text. Not a template with [brackets] — the actual text ready to use with the real product name and real prices from the data.>",
      "<Step 4>",
      "<Step 5 — what to check AFTER: 'El jueves por la noche, mira cuántos pedidos entraron. Si funcionó, repite cada semana.' Keep it simple.>"
    ],
    "expected_impact": "<One sentence with a realistic, specific prediction. Example: 'Si esto nos trae 2-3 pedidos extra el jueves, son ${cs}60-90 más esta semana.' Base it on actual order values from the data.>"
  }
}

Rules:
- Address ${ownerName} by name ONLY in section_yesterday.summary, nowhere else
- Provide exactly 2-3 items in whats_working and whats_not_working
- Provide 2-3 items in section_upcoming based on the historical patterns detected
- If no historical data is available, still provide 1-2 items in section_upcoming based on general day-of-week insights from yesterday's data
- All numbers in section_yesterday must match the raw data exactly — conversion_rate must be the raw decimal 0–1
- section_activation how[] must have 4-6 steps, each doable in under 5 minutes, with specific DAYS and TIMES
- If sessions = 0, do NOT mention visits, traffic, sessions, or conversion ANYWHERE in the brief
- NEVER use marketing jargon. Re-read the forbidden words list before writing each sentence.
- NEVER give generic advice. Every recommendation must reference a specific product name, number, and DAY from the data.
- The activation copy/text must be COMPLETE and ready to paste — not a template with placeholders.
- section_upcoming.items[].ready_copy must be the FULL text ready to copy/paste (WhatsApp message, Instagram caption, etc.)
- Every recommendation must be FORWARD-LOOKING. Don't just describe yesterday — plan for this week.
- Return ONLY the JSON object. Nothing else.`;
}
