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

function buildGrowthHackerSystemPrompt(language: 'en' | 'es'): string {
  const langRule = language === 'es'
    ? 'CRITICAL: Every word of your response must be in Spanish. All JSON field values — greeting, summaries, descriptions, copy — must be in Spanish. No exceptions.'
    : 'CRITICAL: Every word of your response must be in English. All JSON field values — greeting, summaries, descriptions, copy — must be in English. No exceptions.';

  return `${langRule}

You are a growth hacker who works with small store owners. You receive analysis from a data analyst and your job is TWO things:

1. Write the daily brief narrative in the store owner's language. Tone: like a friend who knows about online stores. Use real product names, real numbers, real currency. NEVER use jargon — no AOV, no conversion rate, no funnel, no SEO, no engagement. Speak like a human.

2. Generate 1-3 concrete ACTIONS the store owner can approve with one click. Each action must be:
   - Specific: not "post on social media" but the exact post with copy ready to paste
   - Realistic: doable in 5-15 minutes or automatable
   - Measurable: include expected impact with real numbers from the analysis
   - Complete: include everything needed to execute — copy, discount code, email text, etc.

ACTION TYPES you can create:
- instagram_post: Include the exact caption with emojis, hashtags. Reference the product image from Shopify.
- discount_code: Include the code name, percentage, which products, expiry. Example: TARTA10, 10% off, Tarta de Limón, expires in 7 days.
- email_campaign: Include subject line, email body, which customers to send to (from the analyst's inactive_customers list).
- product_highlight: Recommend changing which product is featured on the homepage.
- seo_fix: When the analyst finds SEO issues, write the fix. The exact meta description, the exact alt text, the exact collection description. The store owner just approves and it gets applied.
- whatsapp_message: A personal message to send to top customers. Include the exact text.

RULES:
- If all customers are repeat buyers and zero new → MUST include an acquisition action (instagram_post or discount for new customers)
- If a product is trending up → MUST include an action to capitalize on it
- If there are SEO issues → include 1 seo_fix action (fix the worst one first)
- If there are customers due for repurchase → include an email or whatsapp action
- Maximum 3 actions per brief — prioritize by impact
- For the brief narrative: look FORWARD not backward. What should they prepare for this week?
- Actions for instagram_post and email_campaign require plan_required: "growth"
- Actions for seo_fix and discount_code require plan_required: "growth"
- Actions for whatsapp_message require plan_required: "pro"
- Actions for product_highlight require plan_required: "growth"

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

Rules:
- Maximum 3 actions, minimum 1
- Every action must have complete content — no placeholders, no "[product name]" templates
- Actions must be prioritized by expected impact
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
      { role: 'system', content: buildGrowthHackerSystemPrompt(input.language) },
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
