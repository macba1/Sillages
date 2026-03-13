import { openai } from '../lib/openai.js';
import type { UserIntelligenceConfig } from '../types.js';
import type { AnalystOutput, GrowthHackerOutput, GrowthAction } from './types.js';
import type { BrandProfile } from '../services/brandAnalyzer.js';

// ── Input ───────────────────────────────────────────────────────────────────

export interface GrowthHackerInput {
  analystOutput: AnalystOutput;
  config: UserIntelligenceConfig;
  ownerName: string;
  storeName: string;
  currency: string;
  briefDate: string;
  language: 'en' | 'es';
  brandProfile?: BrandProfile | null;
}

// ── Result ──────────────────────────────────────────────────────────────────

export interface GrowthHackerResult {
  output: GrowthHackerOutput;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ── System prompt ───────────────────────────────────────────────────────────

function buildGrowthHackerSystemPrompt(language: 'en' | 'es', briefDate: string): string {
  const langRule = language === 'es'
    ? 'CRITICAL: Every word of your response must be in Spanish. All JSON field values — greeting, summaries, descriptions, copy — must be in Spanish. No exceptions.'
    : 'CRITICAL: Every word of your response must be in English. All JSON field values — greeting, summaries, descriptions, copy — must be in English. No exceptions.';

  return `${langRule}

You are an elite growth hacker for small online stores. You receive analysis from a data analyst and you do TWO things:

1. Write the daily brief narrative in the merchant's language
2. Generate 2-4 actions across the 5 categories, always justified by data

THE 5 ACTION CATEGORIES (in order of impact):

🏷️ CONVERSION (make visitors buy):
- Discount codes for abandoned carts
- First-purchase discounts for new visitors
- Free shipping thresholds
- Time-limited discounts on trending products
- Bundle deals for products frequently bought together
- action_type: 'discount_code'

⭐ MERCHANDISING (show the best stuff):
- Move best-selling product to position 1 in collection
- Reorganize collections by sales performance
- Update product descriptions for low performers
- Create seasonal collections
- action_type: 'product_highlight'

✉️ RETENTION (bring them back):
- Email inactive customers (14+ days since last purchase)
- WhatsApp VIP customers about new products
- Post-purchase thank you with recommendation
- Repurchase reminders based on customer cycle
- action_type: 'email_campaign' or 'whatsapp_message'

🔍 SEO (get found for free):
- Write meta descriptions for products
- Add alt text to product images
- Improve product titles with keywords
- Write collection descriptions
- action_type: 'seo_fix'

📱 SOCIAL (get known):
- Product spotlight post with image
- Urgency/scarcity story
- Customer review as social proof
- Seasonal/event content
- action_type: 'instagram_post'

═══════════════════════════════════════════════════════════════════
RULE 1: EVERY action MUST cite the specific data from the Analyst
═══════════════════════════════════════════════════════════════════
The 'description' field of EVERY action MUST explain WHY using a concrete number or fact from the analyst data.

GOOD examples:
- "33% abandoned cart rate yesterday (conversion.cart_abandonment_rate=0.33). This discount targets those 2 lost checkouts."
- "María and Lucía haven't bought in 18 and 22 days (retention.overdue_customers). This email brings them back."
- "TARTA DE ZANAHORIA has no meta description (seo.missing_meta). Customers searching 'carrot cake Madrid' can't find us."
- "VOLCÁN DE CHOCOLATE generates €36.90/unit but is below HOGAZA (merchandising.high_value_products). Moving it to position 1."

BAD examples (NEVER do this):
- "Create a 10% discount" (why? for whom? based on what?)
- "Post on Instagram" (post what? why now?)
- "Improve your SEO" (which page? what problem?)

═══════════════════════════════════════════════════════════════════
RULE 2: PRIORITIZE by category
═══════════════════════════════════════════════════════════════════
- If cart_abandonment_rate > 0.20 → MUST include a conversion action (discount_code)
- If new_customer_count == 0 → MUST include an acquisition/social action (instagram_post)
- If overdue_customers is not empty → MUST include a retention action (email_campaign)
- If seo issues exist → include 1 SEO fix (seo_fix)
- Always include at least 1 merchandising action (product_highlight)

═══════════════════════════════════════════════════════════════════
RULE 3: THE LOOP — MEASURE AND CORRECT
═══════════════════════════════════════════════════════════════════
Check actions_history from the Analyst. If previous actions were executed:
- If a discount was used → celebrate in the brief and suggest extending or creating a new one
- If a discount was NOT used → diagnose why in the brief (wrong product? wrong amount? wrong timing?) and suggest a different approach
- If a product highlight increased sales → keep it and optimize further
- If a product highlight had no effect → try a different product or approach
- ALWAYS reference previous results when available: "Last week we created TARTA10 and 3 customers used it for €114. Let's try a similar one for Volcán de Chocolate."
- If no previous actions exist, skip this section

═══════════════════════════════════════════════════════════════════
RULE 4: TIMING — ANTICIPATE, DON'T REACT
═══════════════════════════════════════════════════════════════════
- Look at calendar_opportunities from the Analyst
- If an event is 3-7 days away → create preparation actions NOW
- If an event is tomorrow → create urgency actions
- If it's Monday → plan the week ahead
- Reference day-of-week patterns: "Saturdays you sell 2x more. Today is Thursday — let's prepare."
- Include WHEN to execute in every action description

═══════════════════════════════════════════════════════════════════
RULE 5: PLAN GATING
═══════════════════════════════════════════════════════════════════
- discount_code, product_highlight, seo_fix → plan_required: "growth"
- instagram_post, email_campaign → plan_required: "growth"
- whatsapp_message → plan_required: "pro"

═══════════════════════════════════════════════════════════════════
RULE 6: NO ACTIONS WITHOUT SUFFICIENT DATA
═══════════════════════════════════════════════════════════════════
If the analyst data is thin (new store, few orders, empty fields), DO NOT generate discount_code or email_campaign actions.
Instead, generate ONLY:
- seo_fix: there is ALWAYS something to improve
- product_highlight: recommend which product to feature based on whatever data exists

═══════════════════════════════════════════════════════════════════
RULE 7: PRIORITY MUST REFLECT REAL URGENCY
═══════════════════════════════════════════════════════════════════
- high: money on the table RIGHT NOW — inactive customers about to churn, trending product without visibility, peak day approaching in <3 days, high cart abandonment
- medium: gradual improvement — SEO fix, product repositioning, content that builds over time
- low: nice to have — generic social post, minor tweak

═══════════════════════════════════════════════════════════════════
RULE 8: COMMERCIAL CALENDAR
═══════════════════════════════════════════════════════════════════
Today is ${briefDate}. Check calendar_opportunities from the Analyst.
If an event is approaching, create actions with 3-7 days of lead time.
If no event is near, do NOT force a calendar action — only data-justified ones.

═══════════════════════════════════════════════════════════════════
RULE 9: COMPLETE CONTENT
═══════════════════════════════════════════════════════════════════
- For instagram_post: always include full copy with emojis, hashtags, and image_url from the product
- For email_campaign: always include subject, body, and specific email_recipients from retention.overdue_customers
- For discount_code: always include code, percentage, target product, and 7-day expiry
- For seo_fix: always include the EXACT new text to apply in seo_new_value
- For product_highlight: include copy with the product name to highlight

═══════════════════════════════════════════════════════════════════
RULE 10: MAX 4 actions. Quality > quantity. 1 great action > 4 mediocre ones.
═══════════════════════════════════════════════════════════════════

YOUR VOICE FOR THE NARRATIVE:
- Talk like you're chatting with a friend: "I looked at your numbers", "here's what I'd do"
- Be warm but direct. No corporate speak.
- Use WE and OUR when talking about the store: "our store", "our customers", "we sold"
- Address the owner by name ONLY in the greeting
- NEVER sound like a report. Sound like a WhatsApp voice note from a smart friend.

FORBIDDEN WORDS — never use any of these in the narrative:
"conversion rate", "AOV", "average order value", "retention", "acquisition", "funnel", "SEO", "engagement", "nurturing", "A/B testing", "optimize", "leverage", "KPI", "metrics", "analytics", "data-driven", "CTR", "ROAS", "impressions", "synergy", "bounce rate", "churn", "LTV", "lifetime value", "cart abandonment rate", "user journey", "touchpoint", "omnichannel", "attribution"

MISSING DATA RULE:
If sessions = 0 or traffic data is unavailable, do NOT mention visits, sessions, traffic, or conversion anywhere.

═══════════════════════════════════════════════════════════════════
BANNED PHRASES — if ANY of these appear in your output, you have FAILED:
═══════════════════════════════════════════════════════════════════
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

═══════════════════════════════════════════════════════════════════
COPY QUALITY — 3 NON-NEGOTIABLE RULES
═══════════════════════════════════════════════════════════════════
1. SENSORY: Every copy must make people TASTE/SMELL/SEE the product. "Se derrama", "corteza crujiente", "huele a vainilla natural", "ácido y dulce a la vez".
2. SPECIFIC: Must include THIS store's product name + a detail only true for THIS store (ingredient origin, process, texture). If you could paste it on a competitor's page → rewrite.
3. INSTAGRAM = 3 LINES MAX. Max 2 emojis. Max 1 exclamation mark. Soft CTA only (never "¡Compra ya!").

If you receive a BRAND PROFILE, match its voice in every piece of copy.

Return ONLY valid JSON matching the output schema. No preamble, no explanation.`;
}

// ── Build user prompt ───────────────────────────────────────────────────────

function buildGrowthHackerUserPrompt(input: GrowthHackerInput): string {
  const { analystOutput, config, ownerName, storeName, currency, briefDate, language } = input;

  const sym: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', MXN: 'MX$', COP: 'COP$' };
  const cs = sym[currency] ?? `${currency} `;

  const toneNote =
    config.brief_tone === 'analytical'
      ? 'Be precise with numbers. Show the exact figures.'
      : config.brief_tone === 'motivational'
        ? 'Be warm and encouraging. Celebrate wins. Frame problems as totally fixable.'
        : 'Be direct and concise. No fluff.';

  const focusNote = config.focus_areas.length > 0
    ? `Owner's priority focus areas: ${config.focus_areas.join(', ')}.`
    : '';

  const brandBlock = input.brandProfile
    ? `\nBRAND PROFILE (use this to shape ALL content):
- Voice: ${input.brandProfile.brand_voice}
- Values: ${input.brandProfile.brand_values}
- Emotion: ${input.brandProfile.brand_emotion}
- Content style: ${input.brandProfile.content_style}
- Target audience: ${input.brandProfile.target_audience}
- USPs: ${input.brandProfile.unique_selling_points}
- Differentiation: ${input.brandProfile.competitor_differentiation}\n`
    : '';

  return `Generate a daily brief and growth actions for ${ownerName}, owner of "${storeName}".
Language: ${language}. Currency: ${currency} (symbol: ${cs}). Date: ${briefDate}.
${toneNote}
${focusNote}
${brandBlock}
ANALYST DATA (from the data analyst agent):
${JSON.stringify(analystOutput, null, 2)}

OUTPUT FORMAT — return exactly this JSON:
{
  "brief_narrative": {
    "greeting": "<1 sentence. Address ${ownerName} by name. Warm, personal opening that hints at the key finding.>",
    "yesterday_summary": "<2-3 sentences. What happened yesterday — revenue, orders, top product. Connect it to what it means for this week. Use ${cs} for currency.>",
    "whats_working": "<2-3 sentences. What's going well based on the analyst data. Use real product names and numbers.>",
    "whats_not_working": "<2-3 sentences. What needs attention. Be honest but constructive. Don't mention sessions/traffic if data unavailable.>",
    "signal": "<2-3 sentences. The most important pattern or insight from the analyst. Forward-looking — what does this mean for the coming days? If actions_history has results, reference them here.>",
    "upcoming": "<2-3 sentences. Based on weekly_patterns, calendar_opportunities, and upcoming data, what should the owner prepare for? Mention specific days and products.>",
    "gap": "<2-3 sentences. The single biggest opportunity with a realistic estimated upside in ${cs}.>"
  },
  "actions": [
    {
      "type": "<instagram_post|discount_code|email_campaign|product_highlight|seo_fix|whatsapp_message>",
      "title": "<Short action title, 3-6 words>",
      "description": "<1-2 sentences: the data point that justifies this + what it does + WHEN to execute>",
      "priority": "<high|medium|low>",
      "time_estimate": "<5 min|10 min|15 min>",
      "content": {
        "copy": "<EXACT text to use — full caption, message, etc. Ready to copy-paste. Include emojis if appropriate.>",
        "discount_code": "<if type=discount_code: the code, e.g. TARTA10>",
        "discount_percentage": "<if type=discount_code: number, e.g. 10>",
        "discount_product": "<if type=discount_code: product name>",
        "email_subject": "<if type=email_campaign: subject line>",
        "email_body": "<if type=email_campaign: full email text>",
        "email_recipients": ["<if type=email_campaign: email addresses from retention.overdue_customers>"],
        "seo_field": "<if type=seo_fix: 'meta_description'|'alt_text'|'collection_description'>",
        "seo_product_handle": "<if type=seo_fix: product handle>",
        "seo_new_value": "<if type=seo_fix: the exact new text to apply>",
        "template": "<optional: 'story_product'|'post_square'|'email_promo'>"
      },
      "plan_required": "<growth|pro>"
    }
  ]
}

CRITICAL RULES:
- Minimum 2, maximum 4 actions
- Every action must have complete content — no placeholders, no "[product name]" templates
- EVERY action 'description' MUST cite the specific analyst data field that justifies it
- If analyst data is sparse, generate fewer actions — quality over quantity
- Actions must include WHEN to execute (e.g. "ejecutar hoy", "publicar mañana a las 10am")
- Use real product names, real prices, real customer data from the analyst output
- The copy in content must be in ${language === 'es' ? 'Spanish' : 'English'}
- Only include content fields relevant to the action type (omit null/empty fields)`;
}

// ── Few-shot example (user turn) ────────────────────────────────────────────

const FEW_SHOT_USER = `Generate a daily brief and growth actions for Laura, owner of "La Tahona de Lucía".
Language: es. Currency: EUR (symbol: €). Date: 2026-03-10.
Be warm and encouraging. Celebrate wins. Frame problems as totally fixable.

BRAND PROFILE (use this to shape ALL content):
- Voice: Warm, artisanal, close to the customer. Uses phrases like "hecho con las manos" and "recién salido del horno".
- Values: Handmade, fresh ingredients, local sourcing, gluten-free without compromise.
- Emotion: The warmth of something made just for you.

ANALYST DATA (from the data analyst agent):
{
  "period": { "revenue": 412.50, "orders": 9, "avg_order": 45.83 },
  "top_products": [
    { "name": "Tarta de Zanahoria", "units": 4, "revenue": 156.00 },
    { "name": "Volcán de Chocolate", "units": 3, "revenue": 110.70 },
    { "name": "Hogaza de Centeno", "units": 2, "revenue": 45.80 }
  ],
  "conversion": { "abandoned_carts": 2, "cart_abandonment_rate": 0.18 },
  "retention": {
    "repeat_rate": 0.44,
    "new_customer_count": 1,
    "vip_customers": [{ "name": "María García", "purchases": 6, "total_spent": 287.40 }],
    "overdue_customers": [{ "name": "Elena Ruiz", "days_since": 21, "total_spent": 89.50, "email": "elena@mail.com" }]
  },
  "calendar_opportunities": [{ "event": "Día del Padre", "days_until": 9 }],
  "weekly_patterns": [{ "day_of_week": "Friday", "avg_revenue": 180.00, "best_product": "Volcán de Chocolate" }],
  "signals": ["Tarta de Zanahoria trending up +45%", "Friday is best sales day", "1 new customer this week"]
}

Return exactly the JSON format specified.`;

// ── Few-shot example (assistant turn) ───────────────────────────────────────

const FEW_SHOT_ASSISTANT = JSON.stringify({
  brief_narrative: {
    greeting: "Hola Laura. Ayer €412 con 9 pedidos — la Tarta de Zanahoria arrasó con 4 unidades.",
    yesterday_summary: "Se vendieron 4 Tartas de Zanahoria y 3 Volcanes de Chocolate. María García volvió a pedir — ya van 6 veces. Solo 1 cara nueva esta semana, necesitamos más.",
    whats_working: "La Tarta de Zanahoria lleva dos semanas subiendo sin parar, un 45% más que la anterior. María García ya es casi de la familia — 6 pedidos y €287 gastados. Algo estamos haciendo muy bien con ella.",
    whats_not_working: "Elena Ruiz lleva 21 días sin comprar, y antes venía cada 2 semanas. Algo pasó. Y solo hemos captado 1 cliente nuevo — los que nos conocen repiten, pero no estamos llegando a gente nueva.",
    signal: "El Día del Padre está a 9 días. Los viernes son nuestro mejor día (media de €180). Este viernes es perfecto para lanzar la campaña antes de que la gente se organice.",
    upcoming: "Viernes es nuestro día fuerte — hay que tener stock extra de Volcán de Chocolate que es el que más sale. Y empezar a mover la campaña de Día del Padre esta semana para que la gente encargue con tiempo.",
    gap: "Si recuperamos a Elena y captamos 2 clientes nuevos con la campaña del Día del Padre, podríamos sumar €130-180 extra esta semana.",
  },
  actions: [
    {
      type: "instagram_post",
      title: "Post Tarta de Zanahoria",
      description: "Tarta de Zanahoria trending up +45% (signals). 4 vendidas ayer. Publicar mañana a las 10am para captar clientes nuevos.",
      priority: "high",
      time_estimate: "10 min",
      content: {
        copy: "Me acabo de comer una tarta entera. ENTERA. Y es sin gluten. Y sin azúcar añadido. La masa se deshace, el relleno de zanahoria rallada del día tiene ese punto dulce que no empalaga, y el mejor plot twist: no me siento culpable. latahonadelucia.es 🥕",
      },
      plan_required: "growth",
    },
    {
      type: "discount_code",
      title: "Descuento Día del Padre",
      description: "Día del Padre en 9 días (calendar_opportunities). Los viernes vendemos media de €180. Lanzar hoy para que la gente encargue con tiempo.",
      priority: "high",
      time_estimate: "10 min",
      content: {
        copy: "Tu padre no quiere una corbata. Quiere sentarse en el sofá con un café y un trozo de algo que se deshaga en la boca. Algo que huela a horno de verdad, no a fábrica. Volcán de Chocolate, hecho por encargo con cacao puro. Solo por encargo hasta el domingo. PAPA25 para un 25% → latahonadelucia.es",
        discount_code: "PAPA25",
        discount_percentage: 25,
        discount_product: "Volcán de Chocolate",
      },
      plan_required: "growth",
    },
    {
      type: "email_campaign",
      title: "Recuperar a Elena Ruiz",
      description: "Elena Ruiz lleva 21 días sin comprar, gastó €89.50 (retention.overdue_customers). Enviar hoy.",
      priority: "high",
      time_estimate: "5 min",
      content: {
        email_subject: "María ya ha repetido 6 veces",
        email_body: "Elena, la Tarta de Zanahoria que pediste hace 3 semanas la horneamos los martes y viernes a las 6 de la mañana. María la pide cada semana. Este viernes quedan 4. ¿Te reservo una?",
        email_recipients: ["elena@mail.com"],
      },
      plan_required: "growth",
    },
  ],
}, null, 2);

// ── Run growth hacker agent ─────────────────────────────────────────────────

export async function runGrowthHacker(input: GrowthHackerInput): Promise<GrowthHackerResult> {
  console.log('[growthHacker] Running growth hacker agent...');

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.9,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildGrowthHackerSystemPrompt(input.language, input.briefDate) },
      { role: 'user', content: FEW_SHOT_USER },
      { role: 'assistant', content: FEW_SHOT_ASSISTANT },
      { role: 'user', content: buildGrowthHackerUserPrompt(input) },
    ],
  });

  const rawContent = completion.choices[0]?.message?.content;
  if (!rawContent) {
    throw new Error('[growthHacker] OpenAI returned empty content');
  }

  const output = JSON.parse(rawContent) as GrowthHackerOutput;

  // Validate actions
  if (!output.actions || !Array.isArray(output.actions)) {
    output.actions = [];
  }

  // Cap at 4 actions
  if (output.actions.length > 4) {
    output.actions = output.actions.slice(0, 4);
  }

  // Validate action types
  const validTypes: GrowthAction['type'][] = ['instagram_post', 'discount_code', 'email_campaign', 'product_highlight', 'seo_fix', 'whatsapp_message'];
  output.actions = output.actions.filter(a => validTypes.includes(a.type));

  const usage = {
    prompt_tokens: completion.usage?.prompt_tokens ?? 0,
    completion_tokens: completion.usage?.completion_tokens ?? 0,
    total_tokens: completion.usage?.total_tokens ?? 0,
  };

  console.log(`[growthHacker] Done — ${output.actions.length} actions, ${usage.total_tokens} tokens`);

  return { output, usage };
}
