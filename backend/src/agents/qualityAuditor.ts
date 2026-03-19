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

═══ RULE 2B: ACTION-TYPE-SPECIFIC BANS ═══
- welcome_email with a discount code or sales CTA ("compra", "pide", "haz tu pedido") → REJECT and rewrite as genuine thank-you with sensory product details and a natural recommendation.
- reactivation_email containing "te extrañamos", "te echamos de menos", "no te hemos visto", "hace X días que no vienes/compras", "we miss you", "it's been X days" → REJECT and rewrite with a concrete reason to return (new product, availability, recommendation).
- cart_recovery with pressure language ("tu carrito te espera", "completa tu pedido", "no te lo pierdas", urgency timers, countdown) → REJECT and rewrite focusing on product value and easy completion.

═══ RULE 3: SENSORY + SPECIFIC (CRITICAL — most common failure) ═══
Every customer-facing copy must have:
- At least 1 sensory detail (taste, smell, texture, sight): "se deshace", "huele a horno", "corteza crujiente", "ácido y dulce"
- BUT the detail MUST come from the Shopify product description or brand profile. NEVER invent details.
- If NO product description exists for a product → mention ONLY the product name, no adjectives.
- BANNED INVENTED DETAILS (instant REJECT): "abrazo cítrico", "abrazo dulce", "toque especial", "pura fantasía", "pura delicia", "sabores que te transportan", "suavidad única", "nueve sorpresas", "capricho perfecto", "experiencia única", "te transporta", "un clásico reinventado", "contiene nueve sorpresas", "te hará soñar", "magia en cada bocado", "explosión de sabor" — any sensory detail not verifiable in product data.
- The store's specific product name + a detail only true for THIS store
If a copy could work on a competitor's page → REWRITE it.
- "Ingredientes frescos" → FAIL (any bakery says this). "Almendra marcona molida" → PASS (only if in product description).
- "Hornada fresca" → FAIL. "La hornamos cada jueves a las 7am" → PASS (only if in brand profile).

═══ RULE 3B: NO GENERIC PLACEHOLDERS ═══
- Copy MUST NEVER address the customer as "Visitante", "Cliente", "Amigo/a", or any generic placeholder.
- If customer name is empty, start directly with the product or message. Example: "La Caja Merienda que elegiste..." instead of "Visitante, la Caja Merienda..."
- If you find "Visitante" or "Cliente" used as a greeting → REWRITE without it.

═══ RULE 4: SCREENSHOT TEST ═══
Would someone screenshot this and send it to a friend saying "tenemos que probar esto"? If no → REWRITE.
Max 1 exclamation mark per copy. Max 2 emojis. Soft CTA only.

═══ RULE 5: INSTAGRAM = 3 LINES ═══
Line 1: Hook. Line 2: Sensory payoff. Line 3: Soft CTA. If longer → trim.

═══ RULE 6: EMAIL STRUCTURE (cart_recovery, welcome_email, reactivation_email) ═══
Every email MUST follow this 4-line structure:
1. HOOK: Name + specific product + unexpected detail (curiosity gap)
2. SENSORY: One concrete detail — taste, texture, aroma, ingredient origin
3. RECOMMENDATION: Cross-category product with WHY (flavor contrast, complement). Must NOT be the same product already in the cart/purchase.
4. SOFT CTA: Easy next step, never urgent
- Total: MAX 4 lines, 50-125 words. If longer → CUT.
- Subject line: Must create curiosity. NEVER "te espera", "está lista", "preparada para ti".

═══ RULE 7: COPYWRITING FRAMEWORK VERIFICATION ═══
Verify every copy applies at least ONE of these frameworks:
- PAS (Problem-Agitate-Solve): desire → sensory craving → easy solution
- CURIOSITY GAP: subject line creates an information gap the reader needs to close
- LOSS AVERSION (soft): frame as what they'd miss, not what they must do
- SOCIAL PROOF (subtle): "la más pedida", "la que siempre se agota" — never fabricated
If copy uses NONE of these → REWRITE applying PAS at minimum.

═══ RULE 8: AI COPY TELLS — INSTANT REWRITE ═══
If ANY of these patterns appear, the copy is AI-generated garbage → REWRITE:
- Generic openers: "Hola [Name], esperamos que estés bien"
- Filler transitions: "That being said", "It's worth noting", "At its core"
- Vague benefits: "ingredientes de calidad", "hecho con cariño", "productos artesanales"
- Template-sounding: any sentence that would work for ANY bakery without changing a word
- Multiple exclamation marks or emoji clusters (🎂✨🎉)
- Rhetorical questions that nobody asks: "¿Sabías que la calidad importa?"

═══ QUALITY BENCHMARK ═══
Compare every copy against this level. If the copy is worse, REWRITE it to match:

GOOD instagram_post: "Me acabo de comer una tarta entera. ENTERA. Y es sin gluten. Y sin azúcar añadido. La masa se deshace, el relleno de fresa está fresco de esta mañana, y el mejor plot twist: no me siento culpable. nicolina.es 🍓"

GOOD discount_code: "Tu padre no quiere una corbata. Quiere sentarse en el sofá con un café y un trozo de algo que se deshaga en la boca. Algo que huela a horno de verdad, no a fábrica. Tarta Corazón Fresas, hecha por encargo con fresas de temporada. PAPA25 para un 25% → nicolina.es"

GOOD welcome_email: "Alicia, gracias por probar nuestro Volcán de Chocolate. Lo horneamos esta mañana con chocolate belga al 70% — se deshace en la boca y el centro sale caliente. Esperamos que lo disfrutes. Si te gusta el chocolate intenso, te va a encantar la Tarta de Cacao y Frambuesa — tiene ese punto ácido que equilibra perfecto."

GOOD reactivation_email: "Cristina, esta semana estrenamos receta: Tarta de Pistacho con masa de almendra. Sin gluten, como siempre. Solo la hacemos los viernes. ¿Te reservamos una?"

GOOD cart_recovery: "Cristina, la Tarta de Limón que elegiste la hacemos con limones de Málaga y crema pastelera casera. Si la pides antes del viernes, te la tenemos fresca para el finde."

BAD welcome_email: "Gracias por tu compra. Aquí tienes un 10% para tu próximo pedido." (sale, not thank you)
BAD reactivation_email: "Te extrañamos en Nicolina. Han pasado 29 días." (guilt trip)
BAD cart_recovery: "Tu carrito te espera. Completa tu pedido antes de que expire." (pressure)

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
  lines.push('\nVERIFY ALL OF THESE:');
  lines.push('- reactivation_email MUST have real recipients array with email, name, last_product from lost customers');
  lines.push('- reactivation_email MUST NOT contain "te extrañamos", "te echamos de menos", "hace X días" — give a REASON to return instead');
  lines.push('- welcome_email MUST NOT contain discount codes or sales CTAs — it is a genuine thank-you');
  lines.push('- cart_recovery MUST focus on product value, NOT pressure ("tu carrito te espera" is BANNED)');
  lines.push('- cart_recovery MUST have customer_email, customer_name, and products array from abandoned carts');
  lines.push('- yesterday_summary MUST include "Tienes X clientes. Y son habituales, Z compraron una vez..."');
  lines.push('- about_to_repeat customers MUST appear by name in the narrative');
  lines.push('- abandoned carts MUST list the product names, not just the amount');
  lines.push('- star customers MUST appear by name in whats_working');
  lines.push('If ANY of these are missing → ADD them. This is not optional.');
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
  const validTypes: GrowthAction['type'][] = ['instagram_post', 'discount_code', 'product_highlight', 'seo_fix', 'whatsapp_message', 'cart_recovery', 'welcome_email', 'reactivation_email'];
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
