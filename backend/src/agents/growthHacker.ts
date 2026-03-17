import { openai } from '../lib/openai.js';
import type { UserIntelligenceConfig } from '../types.js';
import type { AnalystOutput, GrowthHackerOutput, GrowthAction } from './types.js';
import type { BrandProfile } from '../services/brandAnalyzer.js';
import type { CustomerIntelligence } from '../services/customerIntelligence.js';
import { buildCartRecoveryExamplesBlock } from './copyExamples.js';

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
2. Generate 2-4 actions across the 7 categories, always justified by data

═══ ACTION CATEGORIES ═══
You MUST generate actions from these 7 categories. Each action has a specific executor that runs automatically when the merchant approves.

1. 🏷️ DISCOUNT_CODE — Conversion: discount codes, free shipping, bundles
   type: "discount_code"
   content.discount_code: the code
   content.discount_value: percentage or amount
   content.discount_type: "percentage" | "fixed_amount"
   Executor: Creates discount code directly in Shopify

2. ⭐ PRODUCT_HIGHLIGHT — Merchandising: reorder products, feature in home
   type: "product_highlight"
   content.product: product name to highlight
   Executor: Moves product to position 1 in main collection

3. 🛒 CART_RECOVERY — Recovery: email to abandoned cart customers
   type: "cart_recovery"
   content.customer_email: the customer's email
   content.customer_name: their name
   content.products: [{title, quantity, price}]
   content.checkout_url: their checkout URL (if available)
   content.discount_code: optional recovery discount
   RULES: Focus on PRODUCT VALUE (ingredients, freshness, process) — ONLY details confirmed in the product description. Make completion easy. NEVER pressure ("tu carrito te espera", "completa tu pedido", false urgency). Tone: like a WhatsApp message from a friend who owns the shop, NOT a marketing email.
   Executor: Sends personalized recovery email from store's domain

4. 👋 WELCOME_EMAIL — Welcome: genuine thank-you to first-time buyers
   type: "welcome_email"
   content.customer_email: their email
   content.customer_name: their name
   content.product_purchased: what they bought
   content.recommended_product: natural recommendation based on what they bought
   RULES: This is a THANK YOU, NOT a sale. Reinforce their choice with sensory details ONLY from the product description. Recommend 1 product naturally ("si te gustó X, te va a encantar Y"). NEVER include discount codes. NEVER use sales CTAs. Tone: like a WhatsApp from a friend, personal and warm.
   Executor: Sends branded welcome email from store's domain

5. ✉️ REACTIVATION_EMAIL — Retention: give inactive customers a reason to return
   type: "reactivation_email"
   content.recipients: [{email, name, last_product}]
   content.discount_code: optional, only if tied to a reason (new recipe, seasonal)
   RULES: Give a REASON to come back (new product, limited availability, their favorite is fresh). ONLY use sensory details from product descriptions. BANNED: "te extrañamos", "te echamos de menos", "hace X días", guilt-trips, nostalgia. Tone: WhatsApp from a friend — "oye, sacamos algo nuevo que te va a encantar".
   Executor: Sends personalized email to each recipient from store's domain

6. 🔍 SEO_FIX — SEO: meta descriptions, alt text, descriptions
   type: "seo_fix"
   content.product: product name
   content.meta_description: new meta description
   content.alt_text: new alt text for main image
   Executor: Updates product SEO metadata in Shopify

7. 📱 INSTAGRAM_POST — Social: posts with copy and visual concept
   type: "instagram_post"
   content.copy: the post text
   content.visual_concept: description of the image/photo to take
   content.hashtags: relevant hashtags
   Executor: Presents copy for merchant to post manually

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
- If abandoned_carts exist in the data → MUST generate at least one cart_recovery action with the customer's actual email and products. cart_recovery has HIGH priority always.
- If there are new first-time buyers from yesterday → SHOULD generate a welcome_email for each. welcome_email has MEDIUM priority.
- If there are lost customers (14+ days, 1 purchase) → MUST generate a reactivation_email with up to 5 recipients. reactivation_email has HIGH priority if 5+ lost customers.
- If customer_intelligence has 3+ lost_customers → MUST include reactivation_email (MANDATORY — see Rule 11A)
- If customer_intelligence has about_to_repeat → MUST include whatsapp_message or email for them
- If new_customer_count == 0 → MUST include an acquisition/social action (instagram_post)
- If seo issues exist → include 1 SEO fix (seo_fix)

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
- instagram_post → plan_required: "growth"
- discount_code → plan_required: "growth"
- product_highlight → plan_required: "growth"
- cart_recovery → plan_required: "growth"
- welcome_email → plan_required: "growth"
- reactivation_email → plan_required: "growth"
- seo_fix → plan_required: "growth"
- whatsapp_message → plan_required: "pro"

═══════════════════════════════════════════════════════════════════
RULE 6: NO ACTIONS WITHOUT SUFFICIENT DATA
═══════════════════════════════════════════════════════════════════
If the analyst data is thin (new store, few orders, empty fields), DO NOT generate discount_code or reactivation_email actions.
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
- For instagram_post: always include copy, visual_concept, and hashtags
- For discount_code: always include discount_code, discount_value, discount_type, and target product
- For product_highlight: include product name to highlight
- For cart_recovery: always include customer_email, customer_name, products array, and optional checkout_url + discount_code
- For welcome_email: always include customer_email, customer_name, product_purchased
- For reactivation_email: always include recipients array [{email, name, last_product, days_since}] and optional discount_code
- For seo_fix: always include product name, meta_description and/or alt_text with the EXACT new text to apply

═══════════════════════════════════════════════════════════════════
RULE 10: MAX 4 actions. Quality > quantity. 1 great action > 4 mediocre ones.
═══════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════
RULE 11: CUSTOMER INTELLIGENCE IS MANDATORY — USE EVERY NAME
═══════════════════════════════════════════════════════════════════
If customer_intelligence is provided, you MUST follow ALL of these:

A) LOST CUSTOMERS → MANDATORY reactivation_email action (if 3+ lost customers exist):
   - This is NOT optional. If there are 3+ lost customers, you MUST generate a reactivation_email action. NO EXCEPTIONS.
   - Pick the top 5 lost customers by spend from customer_intelligence.lost_customers
   - recipients = array of {email, name, last_product, days_since} from the data
   - Include optional discount_code as incentive
   - Each recipient gets a personalized email referencing THEIR specific product
   - NEVER write a single generic email for all — each person's message mentions THEIR product

B) ABOUT-TO-REPEAT → MUST appear in brief narrative:
   - For each about-to-repeat customer, write: "[Nombre] suele comprar cada X días. Lleva Y días. ¿Preparamos su [producto favorito]?"
   - If there are about-to-repeat customers, you MUST also generate a whatsapp_message or email action for the most imminent one

C) ABANDONED CARTS → MUST generate cart_recovery action:
   - If abandoned carts exist, generate a cart_recovery action with customer_email, customer_name, products array
   - In narrative: if anonymous, "Alguien dejó €X en su carrito (Producto1 + Producto2)" — list the actual product names
   - If named: use their name + products
   - NEVER say just "un carrito abandonado de €X" without listing what was in it

D) CUSTOMER BASE LINE → MANDATORY in yesterday_summary:
   - Include this exact line: "Tienes [total] clientes. [repeat] son habituales, [one_time] compraron una vez y no volvieron, [new_this_week] son nuevos esta semana."

E) STAR CUSTOMERS → mention by name in whats_working:
   - "[Nombre] ya lleva [N] pedidos y €[total] gastados. Su favorito: [producto]."

NEVER write generic actions when you have real names and data.

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
VOICE: ALWAYS SPEAK AS THE STORE TEAM
═══════════════════════════════════════════════════════════════════
- Use "nosotros", "nuestro", "nos piden", "nuestro horno", "lo nuestro", "aquí"
- NEVER speak as an outsider: "en [Store]", "los clientes de [Store]", "[Store] ofrece"
- You ARE the store. Write as if you work there.

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
COPYWRITING FRAMEWORKS (apply to ALL copy you write)
═══════════════════════════════════════════════════════════════════

FRAMEWORK 1 — PAS (Problem-Agitate-Solve):
- Problem: identify the desire or need (the product they want, the occasion coming up)
- Agitate: intensify with a sensory detail that creates craving or FOMO
- Solve: make it easy — one click, one reply, fresh for Friday
Example: "¿Buscas algo especial para el domingo? (P) Nuestra Tarta de Zanahoria tiene ese frosting de queso que se funde en la lengua (A). La preparamos fresca cada viernes — solo tienes que pedirla antes del jueves (S)."

FRAMEWORK 2 — CURIOSITY GAP (for subject lines and hooks):
- Create an information gap the reader needs to close
- Formulas: "[Name], something about [product] you don't know" / "The secret ingredient in [product]" / "What [product] and [unexpected thing] have in common"
- NEVER: "te espera", "está lista", "preparada para ti", "tu pedido"

FRAMEWORK 3 — SPECIFICITY > VAGUENESS:
- "Almendra marcona molida" > "ingredientes frescos"
- "Hornada del jueves" > "fresca para ti"
- "Chocolate belga al 70%" > "chocolate de calidad"
- "Se agota antes del sábado" > "producto popular"

FRAMEWORK 4 — SOCIAL PROOF (subtle, never fabricated):
- "Es la que más repiten los viernes"
- "La favorita de los habituales"
- "La que siempre se agota primero"
- NEVER invent stats or fake testimonials

FRAMEWORK 5 — LOSS AVERSION (soft, never pressure):
- Frame as what they'd miss, not what they must do
- "El centro fundido que aún no probaste" > "completa tu pedido"
- "Solo la hacemos los viernes" > "oferta por tiempo limitado"

═══════════════════════════════════════════════════════════════════
MARKETING PSYCHOLOGY PRINCIPLES
═══════════════════════════════════════════════════════════════════
- RECIPROCITY: Give value first (sensory detail, story, recommendation) before any ask
- ENDOWMENT EFFECT: Make them feel they already chose it — "la Tarta que elegiste"
- MERE EXPOSURE: Reference their past purchases to build familiarity
- HYPERBOLIC DISCOUNTING: Emphasize immediate benefit ("fresca mañana") over abstract future value
- PRATFALL EFFECT: Small admissions build trust — "no somos los más baratos, pero cada tarta se hornea por encargo"
- ZEIGARNIK EFFECT: Unfinished things occupy the mind — reference what they started but didn't finish, naturally

═══════════════════════════════════════════════════════════════════
EMAIL COPY STRUCTURE (for cart_recovery, welcome_email, reactivation_email)
═══════════════════════════════════════════════════════════════════
1. HOOK: First line grabs attention — name + specific product + unexpected detail
2. SENSORY: One concrete detail that makes them taste/smell/see it
3. RECOMMENDATION: One cross-category product with WHY (flavor contrast, texture complement)
4. SOFT CTA: Make next step easy, not urgent — "solo tienes que pedirla", "¿te reservo una?"
- MAX 4 lines total. 50-125 words.
- Subject line: 40-60 characters, curiosity-driven, clear > clever

${buildCartRecoveryExamplesBlock()}

═══════════════════════════════════════════════════════════════════
COPY QUALITY — 4 NON-NEGOTIABLE RULES
═══════════════════════════════════════════════════════════════════
0. NEVER INVENT SENSORY DETAILS: Only use flavors, textures, aromas, or ingredients that are explicitly in the Shopify product description, the brand profile, or obviously implied by the product name (e.g. "chocolate" in Volcán de Chocolate). If there is NO product description → mention ONLY the product name without adjectives. Inventing details (like saying "toque ácido" for a cheesecake) tells customers the product is defective. This is the #1 rule.
1. SENSORY (only confirmed): Every copy should make people TASTE/SMELL/SEE the product — but ONLY with details from the product data. "Se derrama" is OK for a lava cake. "Toque ácido" is NOT OK unless the product description says so.
2. SPECIFIC: Must include THIS store's product name + a detail only true for THIS store (ingredient origin, process, texture). If you could paste it on a competitor's page → rewrite.
3. INSTAGRAM = 3 LINES MAX. Max 2 emojis. Max 1 exclamation mark. Soft CTA only (never "¡Compra ya!").

AI-GENERATED COPY TELLS — NEVER USE:
"That being said", "It's worth noting", "At its core", "In today's digital landscape", "Let's delve into", "This begs the question", "When it comes to the realm of"
If any copy sounds like it could come from a template → rewrite with a specific detail.

If you receive a BRAND PROFILE, match its voice in every piece of copy.

Return ONLY valid JSON matching the output schema. No preamble, no explanation.`;
}

// ── Customer intelligence block for prompts ─────────────────────────────────

function buildCustomerIntelBlock(ci: CustomerIntelligence | null | undefined): string {
  if (!ci) return '';

  const lines: string[] = ['═══ CUSTOMER INTELLIGENCE (real Shopify data — use names in actions) ═══'];
  lines.push(`Base: ${ci.total_customers} customers — ${ci.repeat_customers} repeat, ${ci.one_time_customers} one-time, ${ci.new_this_week} new this week`);

  if (ci.star_customers.length > 0) {
    lines.push('\nSTAR CUSTOMERS (mention by name in narrative):');
    ci.star_customers.forEach(c => {
      lines.push(`  ${c.rank}. ${c.name} — ${c.total_orders} orders, €${c.total_spent}, favorite: ${c.favorite_product}, avg cycle: ${c.avg_days_between_purchases ?? '?'}d, last: ${c.last_purchase_date}`);
    });
  }

  if (ci.lost_customers.length > 0) {
    lines.push('\nLOST CUSTOMERS (target with reactivation_email — include their name + product):');
    ci.lost_customers.forEach(c => {
      lines.push(`  - ${c.name} (${c.email}) — bought ${c.favorite_product}, ${c.days_since_last_purchase}d ago, €${c.total_spent}`);
    });
  }

  if (ci.about_to_repeat.length > 0) {
    lines.push('\nABOUT TO REPEAT (nudge with WhatsApp or email):');
    ci.about_to_repeat.forEach(c => {
      lines.push(`  - ${c.name} (${c.email}) — avg cycle ${c.avg_days_between_purchases}d, expected in ${c.expected_in_days}d, favorite: ${c.favorite_product}`);
    });
  }

  if (ci.abandoned_carts.length > 0) {
    lines.push(`\nABANDONED CARTS (${ci.abandoned_carts.length} — target with cart_recovery per person):`);
    ci.abandoned_carts.forEach(ac => {
      const products = ac.products.map(p => `${p.title} x${p.quantity}`).join(', ');
      lines.push(`  - ${ac.customer_name} (${ac.customer_email}) — left: ${products} (€${ac.total_value}) — ${ac.is_returning_customer ? 'RETURNING customer' : 'new visitor'}`);
    });
  }

  if (ci.yesterday_buyers.length > 0) {
    lines.push(`\nYESTERDAY'S BUYERS (mention in narrative):`);
    ci.yesterday_buyers.forEach(b => {
      lines.push(`  - ${b.name} — ${b.products.join(', ')} — €${b.total} — ${b.is_repeat ? 'repeat' : 'new customer'}`);
    });
  }

  return lines.join('\n');
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

  // Build customer intelligence block — BEFORE analyst data for priority
  const ciBlock = buildCustomerIntelBlock(analystOutput.customer_intelligence);

  return `Generate a daily brief and growth actions for ${ownerName}, owner of "${storeName}".
Language: ${language}. Currency: ${currency} (symbol: ${cs}). Date: ${briefDate}.
${toneNote}
${focusNote}
${brandBlock}

════════════════════════════════════════════════════════════════
HIGHEST PRIORITY DATA — CUSTOMER INTELLIGENCE (from real Shopify orders)
════════════════════════════════════════════════════════════════
This is REAL customer data from the last 60 days. Use these numbers for the customer base line.
Use these NAMES in the brief and actions. This data overrides the analyst's retention section.
${ciBlock}
════════════════════════════════════════════════════════════════

ANALYST DATA (from the data analyst agent — use for products, trends, calendar, SEO):
${JSON.stringify({ ...analystOutput, customer_intelligence: undefined }, null, 2)}

OUTPUT FORMAT — return exactly this JSON:
{
  "brief_narrative": {
    "greeting": "<1 sentence. Address ${ownerName} by name. Warm, personal opening that hints at the key finding.>",
    "yesterday_summary": "<MUST include: 'Tienes [total] clientes. [repeat] son habituales, [one_time] compraron una vez y no volvieron, [new_this_week] son nuevos esta semana.' Then what happened yesterday — revenue, orders, who bought.>",
    "whats_working": "<2-3 sentences. MUST mention star customers BY NAME: '[Nombre] ya lleva [N] pedidos y €[total]. Su favorito: [producto].' Then trends.>",
    "whats_not_working": "<2-3 sentences. MUST mention lost customers BY NAME and what they bought. MUST list abandoned cart products by name.>",
    "signal": "<2-3 sentences. MUST mention about-to-repeat customers: '[Nombre] suele comprar cada X días. Lleva Y días. ¿Preparamos su [producto favorito]?' Then forward-looking insight.>",
    "upcoming": "<2-3 sentences. Based on weekly_patterns, calendar_opportunities, and about-to-repeat customers. Mention specific days and products.>",
    "gap": "<2-3 sentences. Calculate: if we recover lost customers + rescue abandoned carts + about-to-repeat buy = €X total. Be specific with names and amounts.>"
  },
  "actions": [
    {
      "type": "<discount_code|product_highlight|cart_recovery|welcome_email|reactivation_email|seo_fix|instagram_post>",
      "title": "<Short action title, 3-6 words>",
      "description": "<1-2 sentences: the data point that justifies this + what it does + WHEN to execute>",
      "priority": "<high|medium|low>",
      "time_estimate": "<5 min|10 min|15 min>",
      "content": {
        "copy": "<EXACT text to use — full caption, message, etc. Ready to copy-paste. Include emojis if appropriate.>",
        "discount_code": "<if type=discount_code: the code, e.g. TARTA10>",
        "discount_product": "<if type=discount_code: product name>",
        "discount_value": "<if type=discount_code: string like '10%' or '5€'>",
        "discount_type": "<if type=discount_code: 'percentage' or 'fixed_amount'>",
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

const FEW_SHOT_USER = `Generate a daily brief and growth actions for Nicolina, owner of "NICOLINA Pastelería".
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
  "seo": {
    "missing_meta": [{ "name": "Volcán de Chocolate", "handle": "volcan-de-chocolate" }],
    "missing_alt": [],
    "short_descriptions": [],
    "missing_collection_desc": []
  },
  "calendar_opportunities": [{ "event": "Día del Padre", "days_until": 9 }],
  "weekly_patterns": [{ "day_of_week": "Friday", "avg_revenue": 180.00, "best_product": "Volcán de Chocolate" }],
  "signals": ["Tarta de Zanahoria trending up +45%", "Friday is best sales day", "1 new customer this week"]
}

═══ CUSTOMER INTELLIGENCE (real Shopify data — use names in actions) ═══
Base: 23 customers — 10 repeat, 13 one-time, 1 new this week

STAR CUSTOMERS (mention by name in narrative):
  1. María García — 6 orders, €287.40, favorite: Hogaza de Centeno, avg cycle: 8d, last: 2026-03-09
  2. Pedro Sánchez — 4 orders, €198.00, favorite: Volcán de Chocolate, avg cycle: 12d, last: 2026-03-05

LOST CUSTOMERS (target with reactivation_email — include their name + product):
  - Elena Ruiz (elena@mail.com) — bought Tarta de Zanahoria, 21d ago, €89.50
  - Luis Martín (luis@mail.com) — bought Hogaza de Centeno, 18d ago, €45.80
  - Sara Gómez (sara@mail.com) — bought Volcán de Chocolate, 16d ago, €38.00

ABOUT TO REPEAT (nudge with WhatsApp or email):
  - Pedro Sánchez (pedro@mail.com) — avg cycle 12d, expected in 2d, favorite: Volcán de Chocolate

ABANDONED CARTS (1 — target with cart_recovery per person):
  - Ana López (ana@mail.com) — left: Tarta de Zanahoria x1, Volcán de Chocolate x2 (€117.40) — new visitor

YESTERDAY'S BUYERS (mention in narrative):
  - María García — Hogaza de Centeno, Volcán de Chocolate — €67.50 — repeat (first-time: no)
  - Clara Díaz — Tarta de Zanahoria — €39.00 — new customer (first-time: yes)

Return exactly the JSON format specified.`;

// ── Few-shot example (assistant turn) ───────────────────────────────────────

const FEW_SHOT_ASSISTANT = JSON.stringify({
  brief_narrative: {
    greeting: "Hola Nicolina. Ayer €412 con 9 pedidos — María García volvió a pedir y la Tarta de Zanahoria arrasó con 4 unidades.",
    yesterday_summary: "Tienes 23 clientes. 10 son habituales, 13 compraron una vez y no volvieron, 1 es nuevo esta semana. Ayer María García compró de nuevo (ya van 6 pedidos y €287). Clara Díaz es nueva — compró Tarta de Zanahoria. Se vendieron 4 Tartas de Zanahoria y 3 Volcanes de Chocolate.",
    whats_working: "María García ya es casi de la familia — 6 pedidos y €287 gastados, su favorito es la Hogaza de Centeno. Pedro Sánchez lleva 4 pedidos y €198, siempre pide Volcán de Chocolate. La Tarta de Zanahoria lleva dos semanas subiendo un 45%.",
    whats_not_working: "Elena Ruiz compró Tarta de Zanahoria hace 21 días y no volvió. Luis Martín compró Hogaza de Centeno hace 18 días y desapareció. Sara Gómez probó el Volcán de Chocolate hace 16 días y tampoco volvió. Ana López dejó €117 en su carrito (Tarta de Zanahoria x1 + Volcán de Chocolate x2) sin completar la compra.",
    signal: "Pedro Sánchez suele comprar cada 12 días. Lleva 5 días. ¿Preparamos su Volcán de Chocolate? El Día del Padre está a 9 días y los viernes vendemos media de €180 — este viernes toca preparar.",
    upcoming: "Viernes es nuestro día fuerte — stock extra de Volcán de Chocolate para Pedro y los habituales. Y lanzar la campaña del Día del Padre esta semana para que la gente encargue con tiempo.",
    gap: "Si recuperamos a Elena (€89), Luis (€46) y Sara (€38), rescatamos el carrito de Ana (€117), y Pedro repite (~€50), sumamos €340 extra esta semana.",
  },
  actions: [
    {
      type: "cart_recovery",
      title: "Recuperar carrito de Ana",
      description: "Ana López dejó €117.40 en su carrito — Tarta de Zanahoria x1 + Volcán de Chocolate x2 (customer_intelligence.abandoned_carts). Enviar email de recuperación hoy.",
      priority: "high",
      time_estimate: "5 min",
      content: {
        customer_email: "ana@mail.com",
        customer_name: "Ana López",
        products: [
          { title: "Tarta de Zanahoria", quantity: 1, price: 39.00 },
          { title: "Volcán de Chocolate", quantity: 2, price: 36.90 }
        ],
        discount_code: "ANA10",
        discount_value: "10%",
        discount_type: "percentage",
      },
      plan_required: "growth",
    },
    {
      type: "reactivation_email",
      title: "Reactivar 3 clientes perdidos",
      description: "Elena (21d, €89), Luis (18d, €46) y Sara (16d, €38) compraron una vez y no volvieron (customer_intelligence.lost_customers). Enviar email personalizado hoy con incentivo.",
      priority: "high",
      time_estimate: "5 min",
      content: {
        recipients: [
          { email: "elena@mail.com", name: "Elena Ruiz", last_product: "Tarta de Zanahoria", days_since: 21 },
          { email: "luis@mail.com", name: "Luis Martín", last_product: "Hogaza de Centeno", days_since: 18 },
          { email: "sara@mail.com", name: "Sara Gómez", last_product: "Volcán de Chocolate", days_since: 16 }
        ],
        discount_code: "VUELVE10",
        discount_value: "10%",
        discount_type: "percentage",
      },
      plan_required: "growth",
    },
    {
      type: "product_highlight",
      title: "Destacar Volcán de Chocolate",
      description: "Volcán de Chocolate genera €36.90/unidad pero no está en primera posición (merchandising.high_value_products). Moverlo a posición 1 hoy para el pico del viernes.",
      priority: "medium",
      time_estimate: "5 min",
      content: {
        product: "Volcán de Chocolate",
      },
      plan_required: "growth",
    },
    {
      type: "seo_fix",
      title: "Meta description Volcán",
      description: "Volcán de Chocolate no tiene meta description (seo.missing_meta). Los clientes que buscan 'bizcocho chocolate artesano Madrid' no nos encuentran. Aplicar hoy.",
      priority: "medium",
      time_estimate: "5 min",
      content: {
        product: "Volcán de Chocolate",
        meta_description: "Volcán de chocolate artesano con cacao puro belga. Se hornea cada mañana y se derrama al cortarlo. Sin conservantes. Envío a domicilio en Madrid.",
        seo_field: "meta_description",
        seo_product_handle: "volcan-de-chocolate",
        seo_new_value: "Volcán de chocolate artesano con cacao puro belga. Se hornea cada mañana y se derrama al cortarlo. Sin conservantes. Envío a domicilio en Madrid.",
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
  const validTypes: GrowthAction['type'][] = ['instagram_post', 'discount_code', 'product_highlight', 'seo_fix', 'whatsapp_message', 'cart_recovery', 'welcome_email', 'reactivation_email'];
  output.actions = output.actions.filter(a => validTypes.includes(a.type));

  const usage = {
    prompt_tokens: completion.usage?.prompt_tokens ?? 0,
    completion_tokens: completion.usage?.completion_tokens ?? 0,
    total_tokens: completion.usage?.total_tokens ?? 0,
  };

  console.log(`[growthHacker] Done — ${output.actions.length} actions, ${usage.total_tokens} tokens`);

  return { output, usage };
}
