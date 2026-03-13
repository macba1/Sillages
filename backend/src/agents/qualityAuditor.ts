import { openai } from '../lib/openai.js';
import type { AnalystOutput, GrowthHackerOutput, QualityAuditOutput, GrowthAction } from './types.js';
import type { BrandProfile } from '../services/brandAnalyzer.js';

// ── Input ───────────────────────────────────────────────────────────────────

export interface QualityAuditorInput {
  growthOutput: GrowthHackerOutput;
  analystOutput: AnalystOutput;
  storeName: string;
  ownerName: string;
  currency: string;
  briefDate: string;
  language: 'en' | 'es';
  brandProfile?: BrandProfile | null;
}

// ── Result ──────────────────────────────────────────────────────────────────

export interface QualityAuditorResult {
  output: QualityAuditOutput;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ── System prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(language: 'en' | 'es'): string {
  const langRule = language === 'es'
    ? 'CRITICAL: Every word of your output must be in Spanish. No exceptions. No English words mixed in.'
    : 'CRITICAL: Every word of your output must be in English. No exceptions.';

  return `${langRule}

You are the last quality check before a daily brief reaches a small store owner. Review the brief narrative and actions. Fix anything that breaks these 5 rules.

═══ RULE 1: ZERO JARGON (highest priority) ═══
Scan EVERY word. If you find ANY of these, REWRITE the entire sentence in plain friend language:
- "tasa de abandono" / "cart abandonment rate" → "1 persona dejó cosas en el carrito sin comprar"
- "tasa de conversión" / "conversion rate" → remove or say "de cada 100 que entraron, X compraron"
- "AOV" / "average order value" → "cada cliente gasta de media €X"
- Any of: CTR, ROI, ROAS, KPI, SEO, LTV, retention, acquisition, funnel, embudo, engagement, churn, bounce rate, omnichannel, touchpoint, optimize, leverage → rewrite in words a 15-year-old would use.

Example fix:
❌ "La tasa de abandono de carrito es del 12.5%, lo que sugiere oportunidades de conversión"
✅ "1 persona dejó cosas en el carrito sin comprar ayer — un empujoncito podría convertir eso en venta"

═══ RULE 2: NEVER GENERIC COPY ═══
The competitor test: could you paste this copy on another store's Instagram and it would work? If YES → REJECT and rewrite.
❌ "¡Descubre nuestras deliciosas tartas!" — works for any bakery
❌ "¿Ya pensaste en el regalo perfecto?" — works for any store
❌ "No dejes escapar tu antojo" — works for any food brand
✅ Must include: THIS store's specific product name + a detail only true for THIS store (ingredient, process, origin, texture)

═══ RULE 3: SENSORY DETAIL IN EVERY COPY ═══
Every piece of customer-facing copy must include at least ONE sensory detail:
- What it LOOKS like: "dorado", "el chocolate se derrama", "corteza crujiente"
- What it SMELLS like: "huele a vainilla natural cuando abres la caja"
- What it FEELS like in your mouth: "miga esponjosa", "denso y húmedo"
- What it TASTES like: "ácido y dulce a la vez", "cacao puro, intenso"

If a copy has zero sensory words → add them. Dead copy = copy you can't taste/smell/see.

═══ RULE 4: SCREENSHOT TEST ═══
Read each piece of copy and ask: would someone screenshot this and send it to a friend saying "tenemos que probar esto"?
If the answer is no → rewrite until the answer is yes.
Also: max 1 exclamation mark per copy, max 2 emojis, soft CTA only (never "¡Compra ya!").

═══ RULE 5: INSTAGRAM MAX 3 LINES ═══
Instagram posts must be 3 lines max before "...more":
Line 1: Hook (specific detail, question, or contrast)
Line 2: Sensory/emotional payoff
Line 3: Soft CTA (link, "solo por encargo", "solo X unidades")

═══ OUTPUT ═══
Return corrected brief_narrative + actions. Set audit_passed=false if you changed anything. List every fix in audit_notes.
Return ONLY valid JSON.`;

}

// ── Build user prompt ───────────────────────────────────────────────────────

function buildUserPrompt(input: QualityAuditorInput): string {
  const { growthOutput, analystOutput, storeName, ownerName, currency, briefDate, language } = input;

  const sym: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', MXN: 'MX$', COP: 'COP$' };
  const cs = sym[currency] ?? `${currency} `;

  const brandBlock = input.brandProfile
    ? `\n═══ BRAND PROFILE (use for voice/tone verification) ═══
- Voice: ${input.brandProfile.brand_voice}
- Values: ${input.brandProfile.brand_values}
- Emotion: ${input.brandProfile.brand_emotion}
- Content style: ${input.brandProfile.content_style}
- Target audience: ${input.brandProfile.target_audience}
- USPs: ${input.brandProfile.unique_selling_points}
- Differentiation: ${input.brandProfile.competitor_differentiation}\n`
    : '';

  return `Review and fix this brief and actions for ${ownerName}, owner of "${storeName}".
Language: ${language}. Currency: ${currency} (symbol: ${cs}). Date: ${briefDate}.
${brandBlock}
═══ BRIEF NARRATIVE (from Growth Hacker) ═══
${JSON.stringify(growthOutput.brief_narrative, null, 2)}

═══ ACTIONS (from Growth Hacker) ═══
${JSON.stringify(growthOutput.actions, null, 2)}

═══ ANALYST DATA (raw data to reference for fixes) ═══
Period: ${cs}${analystOutput.period.revenue} revenue, ${analystOutput.period.orders} orders, ${cs}${analystOutput.period.avg_order} avg
Top products: ${analystOutput.top_products.map(p => `${p.name} (${p.units}u, ${cs}${p.revenue})`).join(', ')}
Conversion: abandoned_carts=${analystOutput.conversion.abandoned_carts}, rate=${analystOutput.conversion.cart_abandonment_rate}
Retention: repeat_rate=${analystOutput.retention.repeat_rate}, new=${analystOutput.retention.new_customer_count}
VIP customers: ${analystOutput.retention.vip_customers.map(c => `${c.name} (${c.purchases} compras, ${cs}${c.total_spent})`).join(', ') || 'none'}
Overdue customers: ${analystOutput.retention.overdue_customers.map(c => `${c.name} (${c.days_since}d sin comprar, ${cs}${c.total_spent})`).join(', ') || 'none'}
Calendar: ${analystOutput.calendar_opportunities.map(c => `${c.event} in ${c.days_until}d`).join(', ') || 'none'}
Weekly patterns: ${analystOutput.weekly_patterns.map(w => `${w.day_of_week}: ${cs}${w.avg_revenue} avg`).join(', ') || 'none'}
Signals: ${analystOutput.signals.join(' | ')}

═══ OUTPUT FORMAT ═══
{
  "brief_narrative": {
    "greeting": "<corrected>",
    "yesterday_summary": "<corrected>",
    "whats_working": "<corrected>",
    "whats_not_working": "<corrected>",
    "signal": "<corrected>",
    "upcoming": "<corrected>",
    "gap": "<corrected>"
  },
  "actions": [<corrected actions with same schema as input>],
  "audit_passed": <true|false>,
  "audit_notes": ["<what you changed and why>"]
}`;
}

// ── Run quality auditor ─────────────────────────────────────────────────────

export async function runQualityAuditor(input: QualityAuditorInput): Promise<QualityAuditorResult> {
  console.log('[quality-audit] Running quality auditor...');

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildSystemPrompt(input.language) },
      { role: 'user', content: buildUserPrompt(input) },
    ],
  });

  const rawContent = completion.choices[0]?.message?.content;
  if (!rawContent) {
    throw new Error('[quality-audit] OpenAI returned empty content');
  }

  const output = JSON.parse(rawContent) as QualityAuditOutput;

  // Validate actions
  if (!output.actions || !Array.isArray(output.actions)) {
    output.actions = input.growthOutput.actions; // fallback to original
  }

  // Cap at 4 actions
  if (output.actions.length > 4) {
    output.actions = output.actions.slice(0, 4);
  }

  // Validate action types
  const validTypes: GrowthAction['type'][] = ['instagram_post', 'discount_code', 'email_campaign', 'product_highlight', 'seo_fix', 'whatsapp_message'];
  output.actions = output.actions.filter(a => validTypes.includes(a.type));

  // Ensure audit fields exist
  if (typeof output.audit_passed !== 'boolean') output.audit_passed = false;
  if (!Array.isArray(output.audit_notes)) output.audit_notes = ['Audit completed'];

  const usage = {
    prompt_tokens: completion.usage?.prompt_tokens ?? 0,
    completion_tokens: completion.usage?.completion_tokens ?? 0,
    total_tokens: completion.usage?.total_tokens ?? 0,
  };

  console.log(`[quality-audit] Done — passed=${output.audit_passed}, ${output.audit_notes.length} notes, ${output.actions.length} actions, ${usage.total_tokens} tokens`);
  if (!output.audit_passed) {
    output.audit_notes.forEach(note => console.log(`[quality-audit]   → ${note}`));
  }

  return { output, usage };
}
