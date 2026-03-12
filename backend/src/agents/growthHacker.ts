import { openai } from '../lib/openai.js';
import type { UserIntelligenceConfig } from '../types.js';
import type { AnalystOutput, GrowthHackerOutput, GrowthAction } from './types.js';

// ── Input ───────────────────────────────────────────────────────────────────

export interface GrowthHackerInput {
  analystOutput: AnalystOutput;
  config: UserIntelligenceConfig;
  ownerName: string;
  storeName: string;
  currency: string;
  briefDate: string;
  language: 'en' | 'es';
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

You are a growth hacker who works with small store owners. You receive analysis from a data analyst and your job is TWO things:

1. Write the daily brief narrative in the store owner's language. Tone: like a friend who knows about online stores. Use real product names, real numbers, real currency. NEVER use jargon. Speak like a human.

2. Generate 1-3 concrete ACTIONS the store owner can approve with one click.

═══════════════════════════════════════════════════════════════════
REGLA 1: CADA ACCIÓN DEBE TENER UNA RAZÓN BASADA EN DATOS
═══════════════════════════════════════════════════════════════════
NEVER generate an action without citing the specific data point that justifies it.
The 'description' field of EVERY action MUST explain WHY using a concrete number or fact from the analyst data.

GOOD examples:
- "Your Lemon Tart sells 2x more on Fridays than any other day (weekly_patterns data). This discount activates Thursday night to capture early traffic."
- "María, Lucía, and Pedro haven't bought in 18, 22, and 25 days (inactive_customers data). This email with a 15% discount brings them back before they forget us."
- "Your Carrot Cake page has no meta description (seo_audit data). Search engines can't understand what it is. This description will bring organic visits."
- "Vitamin C Serum has been your #1 product for 3 days but it's buried in position 8 on your homepage (top_products data). Moving it to position 1 means more people see it."

BAD examples (NEVER do this):
- "Create a 10% discount" (why? for whom? based on what?)
- "Post on Instagram" (post what? why now?)
- "Improve your SEO" (which page? what problem?)

═══════════════════════════════════════════════════════════════════
REGLA 2: TIMING — ACTIONS MUST BE ANTICIPATIVE, NOT REACTIVE
═══════════════════════════════════════════════════════════════════
- If Thursdays sell more → generate the action on Monday/Tuesday to prepare
- If a holiday is approaching → prepare 3-7 days in advance
- If a customer is nearing their repurchase cycle → contact BEFORE they forget
- Every action description MUST include WHEN to execute, not just WHAT to do
- Include the specific day/date when the action should be executed

═══════════════════════════════════════════════════════════════════
REGLA 3: DESCRIPTION = THE "WHY" IN PLAIN LANGUAGE
═══════════════════════════════════════════════════════════════════
The 'description' field is not a generic summary. It is the data-backed explanation:
- "Your data shows Fridays you sell twice as many cakes. This discount is designed to capture orders Thursday night."
- "3 of your best customers haven't bought in over 2 weeks. This email reminds them you exist."
- "Your Carrot Cake page gets visits but has no Google description. This meta description will help you appear when someone searches 'carrot cake Madrid'."

═══════════════════════════════════════════════════════════════════
REGLA 4: NO ACTIONS WITHOUT SUFFICIENT DATA
═══════════════════════════════════════════════════════════════════
If the analyst data is thin (new store, few orders, empty fields), DO NOT generate discount_code or email_campaign actions — they'd be guessing.
Instead, generate ONLY:
- seo_fix: there is ALWAYS something to improve in SEO (check seo_audit)
- product_highlight: recommend which product to feature based on whatever data exists

═══════════════════════════════════════════════════════════════════
REGLA 5: PRIORITY MUST REFLECT REAL URGENCY
═══════════════════════════════════════════════════════════════════
- high: money on the table RIGHT NOW — inactive customers about to churn, trending product without visibility, peak sales day approaching in <3 days
- medium: gradual improvement — SEO fix, product repositioning, content that builds over time
- low: nice to have — generic social post, minor tweak

═══════════════════════════════════════════════════════════════════
REGLA 6: COMMERCIAL CALENDAR AWARENESS
═══════════════════════════════════════════════════════════════════
Today is ${briefDate}. Check if any of these events are within the next 14 days and generate anticipatory actions if so:
- Valentine's Day (Feb 14), Mother's Day (1st Sunday of May in ES, 2nd Sunday of May in US), Father's Day (Mar 19 in ES, 3rd Sunday of June in US)
- Black Friday (last Friday of November), Cyber Monday, Christmas (Dec 25), New Year
- Summer sales (July), Back to school (September), Halloween (Oct 31)
- Local events based on the store's timezone if available
- Season changes, long weekends, pay-day periods (end/start of month)
If an event is approaching, create a discount_code or instagram_post action with 3-7 days of lead time.
If no event is near, do NOT force a calendar action — only generate data-justified actions.

═══════════════════════════════════════════════════════════════════

ACTION TYPES you can create:
- instagram_post: The EXACT caption with emojis, hashtags. Reference the product by name.
- discount_code: Code name, percentage, target products, expiry. Example: TARTA10, 10%, Tarta de Limón, 7 days.
- email_campaign: Subject line, email body, recipient list (from analyst's inactive_customers).
- product_highlight: Which product to feature on homepage and why.
- seo_fix: The EXACT meta description, alt text, or collection description to apply. Store owner approves → it gets applied automatically.
- whatsapp_message: Personal message to a specific customer. Include the exact text.

PLAN ASSIGNMENT:
- instagram_post, email_campaign, seo_fix, discount_code, product_highlight → plan_required: "growth"
- whatsapp_message → plan_required: "pro"

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

  return `Generate a daily brief and growth actions for ${ownerName}, owner of "${storeName}".
Language: ${language}. Currency: ${currency} (symbol: ${cs}). Date: ${briefDate}.
${toneNote}
${focusNote}

ANALYST DATA (from the data analyst agent):
${JSON.stringify(analystOutput, null, 2)}

OUTPUT FORMAT — return exactly this JSON:
{
  "brief_narrative": {
    "greeting": "<1 sentence. Address ${ownerName} by name. Warm, personal opening that hints at the key finding.>",
    "yesterday_summary": "<2-3 sentences. What happened yesterday — revenue, orders, top product. Connect it to what it means for this week. Use ${cs} for currency.>",
    "whats_working": "<2-3 sentences. What's going well based on the analyst data. Use real product names and numbers.>",
    "whats_not_working": "<2-3 sentences. What needs attention. Be honest but constructive. Don't mention sessions/traffic if data unavailable.>",
    "signal": "<2-3 sentences. The most important pattern or insight from the analyst. Forward-looking — what does this mean for the coming days?>",
    "upcoming": "<2-3 sentences. Based on weekly_patterns and upcoming data, what should the owner prepare for? Mention specific days and products.>",
    "gap": "<2-3 sentences. The single biggest opportunity with a realistic estimated upside in ${cs}.>"
  },
  "actions": [
    {
      "type": "<instagram_post|discount_code|email_campaign|product_highlight|seo_fix|whatsapp_message>",
      "title": "<Short action title, 3-6 words>",
      "description": "<1-2 sentences explaining what this does and why NOW>",
      "priority": "<high|medium|low>",
      "time_estimate": "<5 min|10 min|15 min>",
      "content": {
        "copy": "<The EXACT text to use — full Instagram caption, WhatsApp message, email body, etc. Ready to copy-paste. Include emojis if appropriate.>",
        "discount_code": "<if type=discount_code: the code, e.g. TARTA10>",
        "discount_percentage": <if type=discount_code: number, e.g. 10>,
        "discount_product": "<if type=discount_code: product name>",
        "email_subject": "<if type=email_campaign: subject line>",
        "email_body": "<if type=email_campaign: full email text>",
        "email_recipients": ["<if type=email_campaign: email addresses from inactive_customers>"],
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
- Maximum 3 actions, minimum 1
- Every action must have complete content — no placeholders, no "[product name]" templates
- EVERY action 'description' MUST cite the specific analyst data field that justifies it (e.g. "weekly_patterns shows...", "inactive_customers shows...", "seo_audit found...")
- If analyst data is sparse (few products, no inactive customers, no SEO issues), generate FEWER actions — quality over quantity. 1 well-justified action is better than 3 generic ones.
- Actions must include WHEN to execute (e.g. "ejecutar el jueves", "publicar mañana a las 10am", "enviar esta semana")
- Use real product names, real prices, real customer data from the analyst output
- The copy in content must be in ${language === 'es' ? 'Spanish' : 'English'}
- Only include content fields relevant to the action type (omit null/empty fields)`;
}

// ── Run growth hacker agent ─────────────────────────────────────────────────

export async function runGrowthHacker(input: GrowthHackerInput): Promise<GrowthHackerResult> {
  console.log('[growthHacker] Running growth hacker agent...');

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.5,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildGrowthHackerSystemPrompt(input.language, input.briefDate) },
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

  // Cap at 3 actions
  if (output.actions.length > 3) {
    output.actions = output.actions.slice(0, 3);
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
