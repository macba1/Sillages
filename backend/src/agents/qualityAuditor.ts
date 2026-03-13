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

You are the last quality check before a daily brief reaches a store owner. Your ONLY job: find and REWRITE anything that breaks these rules.

═══ RULE 1: ZERO JARGON ═══
If you find ANY of these words ANYWHERE in the output, REWRITE that sentence:
"tasa de abandono", "cart abandonment", "tasa de conversión", "conversion rate", "AOV", "average order value", "CTR", "ROI", "ROAS", "KPI", "SEO", "LTV", "retention", "retención", "acquisition", "adquisición", "funnel", "embudo", "engagement", "churn", "bounce rate", "omnichannel", "touchpoint", "optimize", "leverage"

Rewrite in plain language a friend would use. Example:
❌ "La tasa de abandono de carrito es del 12.5%"
✅ "1 persona dejó cosas en el carrito sin comprar ayer"

═══ RULE 2: BANNED PHRASES ═══
If ANY of these appear, REWRITE the copy completely:
"¡No te lo pierdas!", "¡Haz tu pedido ahora!", "Pura fantasía", "Te transporta", "Un clásico reinventado", "Descubre nuestra selección", "Celebra con nuestras deliciosas", "Personaliza tu regalo", "¡Te encantará!", "No te arrepentirás", "Un abrazo dulce", "Explosión de sabor", "Una experiencia única", "No dejes escapar tu antojo", "¿Ya pensaste en el regalo perfecto?"
Also banned: any phrase with ¡...! that sounds like a TV ad.

═══ RULE 3: SENSORY + SPECIFIC ═══
Every customer-facing copy must have:
- At least 1 sensory detail (taste, smell, texture, sight): "se deshace", "huele a horno", "corteza crujiente", "ácido y dulce"
- The store's specific product name + a detail only true for THIS store
If a copy could work on a competitor's page → REWRITE it.

═══ RULE 4: SCREENSHOT TEST ═══
Would someone screenshot this and send it to a friend saying "tenemos que probar esto"? If no → REWRITE.
Max 1 exclamation mark per copy. Max 2 emojis. Soft CTA only.

═══ RULE 5: INSTAGRAM = 3 LINES ═══
Line 1: Hook. Line 2: Sensory payoff. Line 3: Soft CTA. If longer → trim.

═══ QUALITY BENCHMARK ═══
Compare every copy against this level. If the copy is worse, REWRITE it to match:

GOOD instagram_post: "Me acabo de comer una tarta entera. ENTERA. Y es sin gluten. Y sin azúcar añadido. La masa se deshace, el relleno de fresa está fresco de esta mañana, y el mejor plot twist: no me siento culpable. nicolina.es 🍓"

GOOD discount_code: "Tu padre no quiere una corbata. Quiere sentarse en el sofá con un café y un trozo de algo que se deshaga en la boca. Algo que huela a horno de verdad, no a fábrica. Tarta Corazón Fresas, hecha por encargo con fresas de temporada. PAPA25 para un 25% → nicolina.es"

GOOD email: Subject: "María ya ha repetido 6 veces" — Body: "La Hogaza de Pasas y Nueces que pediste hace 3 semanas la horneamos los martes y viernes a las 6 de la mañana. María la pide cada semana. Este viernes quedan 4. ¿Te reservo una?"

If any copy in the input is NOT at this level → REWRITE it until it is.

═══ OUTPUT ═══
Return corrected brief_narrative + actions. audit_passed=false if you changed anything. List fixes in audit_notes.
Return ONLY valid JSON.`;

}

// ── Customer intelligence summary for auditor ──────────────────────────────

function buildCustomerIntelSummary(analystOutput: AnalystOutput): string {
  const ci = analystOutput.customer_intelligence;
  if (!ci) return '';

  const lines: string[] = ['\n═══ CUSTOMER INTELLIGENCE (verify actions reference real customers) ═══'];
  if (ci.star_customers.length > 0) {
    lines.push(`Stars: ${ci.star_customers.map(c => `${c.name} (${c.total_orders} orders)`).join(', ')}`);
  }
  if (ci.lost_customers.length > 0) {
    lines.push(`Lost: ${ci.lost_customers.map(c => `${c.name} (${c.days_since_last_purchase}d)`).join(', ')}`);
  }
  if (ci.about_to_repeat.length > 0) {
    lines.push(`About to repeat: ${ci.about_to_repeat.map(c => `${c.name} (in ${c.expected_in_days}d)`).join(', ')}`);
  }
  if (ci.abandoned_carts.length > 0) {
    lines.push(`Abandoned carts: ${ci.abandoned_carts.map(c => `${c.customer_name} (€${c.total_value})`).join(', ')}`);
  }
  lines.push('VERIFY: Every email_campaign targets a specific person. Every discount references the abandoned product. No generic "email inactive customers".');
  return lines.join('\n');
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
${buildCustomerIntelSummary(analystOutput)}

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

// ── Few-shot: user submits bad copy ─────────────────────────────────────────

const AUDIT_FEW_SHOT_USER = `Review and fix this brief and actions for Laura, owner of "La Tahona de Lucía".
Language: es. Currency: EUR (symbol: €). Date: 2026-03-10.

═══ BRIEF NARRATIVE (from Growth Hacker) ═══
{
  "greeting": "Hola Laura, esperamos que estés bien.",
  "yesterday_summary": "Ayer generamos €412.50 con 9 pedidos. La tasa de conversión fue del 4.2% y el AOV subió a €45.83.",
  "whats_working": "Los productos están funcionando bien con buen engagement de los clientes.",
  "whats_not_working": "La tasa de abandono de carrito es del 18%, lo que sugiere oportunidades de optimización del funnel.",
  "signal": "El Día del Padre se acerca. Podemos aprovechar esta oportunidad para nuestras promociones.",
  "upcoming": "Preparar promociones para el Día del Padre y optimizar la retención.",
  "gap": "Mejorar la conversión podría generar €50 adicionales."
}

═══ ACTIONS (from Growth Hacker) ═══
[
  {
    "type": "instagram_post",
    "title": "Post Tarta Zanahoria",
    "description": "Publicar un post atractivo para generar engagement.",
    "content": { "copy": "¡Descubre nuestra deliciosa Tarta de Zanahoria! Hecha con amor y los mejores ingredientes. ¡Te encantará! 🥕🎂 #bakery #glutenfree #yummy" }
  },
  {
    "type": "discount_code",
    "title": "Descuento carritos",
    "description": "Crear descuento para recuperar carritos abandonados.",
    "content": { "copy": "¡No te lo pierdas! Usa TARTA10 para un 10% de descuento en tu próxima compra. ¡Haz tu pedido ahora! 🎉", "discount_code": "TARTA10", "discount_percentage": 10 }
  }
]

═══ ANALYST DATA (raw data to reference for fixes) ═══
Period: €412.50 revenue, 9 orders, €45.83 avg
Top products: Tarta de Zanahoria (4u, €156.00), Volcán de Chocolate (3u, €110.70)
Conversion: abandoned_carts=2, rate=0.18
Retention: repeat_rate=0.44, new=1
VIP customers: María García (6 compras, €287.40)
Overdue customers: Elena Ruiz (21d sin comprar, €89.50)
Calendar: Día del Padre in 9d

═══ OUTPUT FORMAT ═══
{
  "brief_narrative": { ... },
  "actions": [...],
  "audit_passed": <true|false>,
  "audit_notes": ["..."]
}`;

// ── Few-shot: assistant fixes everything ────────────────────────────────────

const AUDIT_FEW_SHOT_ASSISTANT = JSON.stringify({
  brief_narrative: {
    greeting: "Hola Laura. Ayer €412 con 9 pedidos — la Tarta de Zanahoria arrasó con 4 unidades.",
    yesterday_summary: "Se vendieron 4 Tartas de Zanahoria y 3 Volcanes de Chocolate. María García volvió a pedir — ya van 6 veces. Solo 1 cara nueva esta semana, necesitamos más.",
    whats_working: "La Tarta de Zanahoria lleva dos semanas subiendo sin parar. María García ya es casi de la familia — 6 pedidos y €287 gastados. Algo estamos haciendo muy bien con ella.",
    whats_not_working: "Elena Ruiz lleva 21 días sin comprar, y antes venía cada 2 semanas. Y solo hemos captado 1 cliente nuevo — los que nos conocen repiten, pero no estamos llegando a gente nueva.",
    signal: "El Día del Padre está a 9 días. Los viernes vendemos de media €180. Es momento de preparar la campaña para que la gente encargue con tiempo.",
    upcoming: "Viernes es nuestro día fuerte — stock extra de Volcán de Chocolate. Y mover la campaña del Día del Padre esta semana.",
    gap: "Si recuperamos a Elena y captamos 2 clientes nuevos con la campaña del Día del Padre, podríamos sumar €130-180 extra.",
  },
  actions: [
    {
      type: "instagram_post",
      title: "Post Tarta Zanahoria",
      description: "Tarta de Zanahoria trending up +45%. 4 vendidas ayer. Publicar mañana a las 10am.",
      content: {
        copy: "Me acabo de comer una tarta entera. ENTERA. Y es sin gluten. Y sin azúcar añadido. La masa se deshace, el relleno de zanahoria rallada del día tiene ese punto dulce que no empalaga, y el mejor plot twist: no me siento culpable. latahonadelucia.es 🥕",
      },
    },
    {
      type: "discount_code",
      title: "Descuento Día del Padre",
      description: "Día del Padre en 9 días. 2 carritos abandonados ayer. Lanzar hoy.",
      content: {
        copy: "Tu padre no quiere una corbata. Quiere sentarse en el sofá con un café y un trozo de algo que se deshaga en la boca. Algo que huela a horno de verdad, no a fábrica. Volcán de Chocolate, hecho por encargo con cacao puro. PAPA25 para un 25% → latahonadelucia.es",
        discount_code: "PAPA25",
        discount_percentage: 25,
      },
    },
  ],
  audit_passed: false,
  audit_notes: [
    "Reescribí yesterday_summary: tenía 'tasa de conversión', 'AOV' — reemplazado con lenguaje de amigo",
    "Reescribí whats_working: 'buen engagement de los clientes' es genérico — ahora menciona a María García por nombre y su historial real",
    "Reescribí whats_not_working: 'tasa de abandono de carrito 18%' y 'optimización del funnel' — ahora dice '2 personas dejaron cosas en el carrito' y menciona a Elena por nombre",
    "Reescribí signal: 'aprovechar esta oportunidad para nuestras promociones' es genérico — ahora tiene datos concretos de viernes €180",
    "Reescribí instagram copy COMPLETO: '¡Descubre nuestra deliciosa Tarta!' es plantilla genérica sin detalle sensorial. Nuevo copy tiene textura (se deshace), frescura (zanahoria rallada del día), emoción (no me siento culpable)",
    "Reescribí discount copy COMPLETO: '¡No te lo pierdas! ¡Haz tu pedido ahora!' son frases prohibidas. Nuevo copy tiene sensorial (se deshaga en la boca, huela a horno), contraste (corbata vs tarta), especificidad (cacao puro, hecho por encargo)",
    "Eliminé hashtags genéricos #bakery #glutenfree #yummy",
    "Eliminé emojis irrelevantes 🎂🎉, dejé solo 🥕 relevante",
  ],
}, null, 2);

// ── Run quality auditor ─────────────────────────────────────────────────────

export async function runQualityAuditor(input: QualityAuditorInput): Promise<QualityAuditorResult> {
  console.log('[quality-audit] Running quality auditor...');

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildSystemPrompt(input.language) },
      { role: 'user', content: AUDIT_FEW_SHOT_USER },
      { role: 'assistant', content: AUDIT_FEW_SHOT_ASSISTANT },
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
