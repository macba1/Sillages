import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { openai } from '../lib/openai.js';

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

// ── Cross-category product map ───────────────────────────────────────────────
// Rule: NEVER recommend from the same category as the cart product.
// Track what's already been recommended in this batch to avoid repeats.

type Category = 'tarta' | 'chocolate' | 'pan_bizcocho' | 'desayuno_snack';

const PRODUCT_CATEGORIES: Record<string, Category> = {
  'TARTA BEBÉ': 'tarta',
  'TARTA DE ZANAHORIA': 'tarta',
  'TARTA DE CUMPLEAÑOS (12 porciones)': 'tarta',
  'TARTA DE CHOCOLATE Y NATA': 'tarta',
  'TARTA DE QUESO': 'tarta',
  'TARTA DE LIMÓN': 'tarta',
  'VOLCÁN DE CHOCOLATE': 'chocolate',
  'Cookie XXL de Chocolate y Avellanas': 'chocolate',
  'COOKIES CHOCOLATE': 'chocolate',
  'COOKIE PEPITAS CHOCOLATE': 'chocolate',
  'BIZCOCHO DE LA CASA': 'pan_bizcocho',
  'PAN DE MOLDE SEMILLAS': 'pan_bizcocho',
  'PALMERITAS DE HOJALDRE': 'pan_bizcocho',
  'BIZCOCHO MARMOLADO': 'pan_bizcocho',
  'CAJA MERIENDA (9 unidades)': 'desayuno_snack',
  'DONA KINDER': 'desayuno_snack',
  'CRACKERS NATURAL': 'desayuno_snack',
  'GRANOLA': 'desayuno_snack',
  'TORTITAS': 'desayuno_snack',
};

// Cross-category recommendations with sensory notes
const CROSS_RECS: Record<Category, Array<{ product: string; sensory: string }>> = {
  tarta: [
    { product: 'Cookie XXL de Chocolate y Avellanas', sensory: 'crujiente por fuera, tierna por dentro, con trozos de avellana tostada' },
    { product: 'VOLCÁN DE CHOCOLATE', sensory: 'centro fundido de chocolate que se derrama al partirlo' },
    { product: 'GRANOLA', sensory: 'avena dorada con almendras tostadas y un toque de canela' },
    { product: 'BIZCOCHO MARMOLADO', sensory: 'dos masas que se entrelazan: vainilla suave y cacao intenso' },
    { product: 'PALMERITAS DE HOJALDRE', sensory: 'capas crujientes de hojaldre con azúcar caramelizado' },
    { product: 'PAN DE MOLDE SEMILLAS', sensory: 'corteza dorada con semillas de lino, girasol y sésamo' },
  ],
  chocolate: [
    { product: 'TARTA DE QUESO', sensory: 'textura cremosa y densa, con un punto ácido que equilibra' },
    { product: 'TARTA DE ZANAHORIA', sensory: 'húmeda, con nueces y un frosting de queso que contrasta' },
    { product: 'GRANOLA', sensory: 'avena crujiente con frutos secos, perfecta para el desayuno' },
    { product: 'PALMERITAS DE HOJALDRE', sensory: 'ligeras, crujientes, con ese caramelo que se forma al hornear' },
    { product: 'TARTA DE LIMÓN', sensory: 'cítrica y fresca, con una base de mantequilla que se deshace' },
  ],
  pan_bizcocho: [
    { product: 'TARTA DE ZANAHORIA', sensory: 'especiada con canela y jengibre, corona de frosting de queso' },
    { product: 'Cookie XXL de Chocolate y Avellanas', sensory: 'del tamaño de tu mano, con chocolate fundido en cada bocado' },
    { product: 'VOLCÁN DE CHOCOLATE', sensory: 'corteza firme que esconde un corazón líquido de chocolate' },
    { product: 'TARTA DE QUESO', sensory: 'suave, sin gluten, con una cremosidad que atrapa' },
  ],
  desayuno_snack: [
    { product: 'TARTA DE LIMÓN', sensory: 'fresca y cítrica, base crujiente de mantequilla' },
    { product: 'VOLCÁN DE CHOCOLATE', sensory: 'para esos días que necesitas algo intenso y reconfortante' },
    { product: 'BIZCOCHO MARMOLADO', sensory: 'esponjoso, con vetas de cacao que cruzan la vainilla' },
    { product: 'TARTA DE CHOCOLATE Y NATA', sensory: 'capas de chocolate y nata montada, para compartir' },
    { product: 'Cookie XXL de Chocolate y Avellanas', sensory: 'enorme, crujiente por fuera, blanda por dentro' },
  ],
};

function getCategory(productTitle: string): Category {
  return PRODUCT_CATEGORIES[productTitle] ?? 'tarta';
}

function pickRecommendation(
  cartProducts: string[],
  alreadyRecommended: Set<string>,
): { product: string; sensory: string } | null {
  // Determine the main cart product's category
  const mainCategory = getCategory(cartProducts[0] ?? '');
  const candidates = CROSS_RECS[mainCategory] ?? [];

  // Filter out products already in cart and already recommended in this batch
  for (const candidate of candidates) {
    if (cartProducts.includes(candidate.product)) continue;
    if (alreadyRecommended.has(candidate.product)) continue;
    return candidate;
  }

  // If all filtered out, pick from any other category
  for (const [, recs] of Object.entries(CROSS_RECS)) {
    for (const candidate of recs) {
      if (cartProducts.includes(candidate.product)) continue;
      if (alreadyRecommended.has(candidate.product)) continue;
      if (getCategory(candidate.product) !== mainCategory) return candidate;
    }
  }

  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== LOADING CURRENT ACTIONS ===');
  const { data: currentActions } = await supabase
    .from('pending_actions')
    .select('id, content')
    .eq('account_id', ANDREA_ID)
    .eq('type', 'cart_recovery')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (!currentActions || currentActions.length === 0) {
    console.log('No cart_recovery actions found');
    return;
  }

  console.log(`Found ${currentActions.length} actions to regenerate\n`);

  // Extract cart data
  const carts = currentActions.map(a => {
    const c = a.content as Record<string, unknown>;
    return {
      actionId: a.id,
      customer_name: String(c.customer_name ?? ''),
      customer_email: String(c.customer_email ?? ''),
      products: (c.products as Array<{ title: string; quantity: number; price: number }>) ?? [],
    };
  });

  // Pick unique recommendations for each cart
  const alreadyRecommended = new Set<string>();
  const recommendations: Array<{ product: string; sensory: string } | null> = [];

  for (const cart of carts) {
    const cartTitles = cart.products.map(p => p.title);
    const rec = pickRecommendation(cartTitles, alreadyRecommended);
    recommendations.push(rec);
    if (rec) alreadyRecommended.add(rec.product);
  }

  console.log('=== RECOMMENDATIONS ASSIGNED ===');
  for (let i = 0; i < carts.length; i++) {
    const rec = recommendations[i];
    console.log(`  ${carts[i].customer_name}: ${carts[i].products.map(p => p.title).join(', ')} → REC: ${rec?.product ?? 'NONE'}`);
  }

  // Build batch context so GPT knows all 7 emails
  const batchContext = carts.map((c, i) =>
    `Email ${i + 1}: ${c.customer_name} — cart: ${c.products.map(p => p.title).join(', ')} — rec: ${recommendations[i]?.product ?? 'none'}`
  ).join('\n');

  console.log('\n=== REGENERATING WITH MARKETING SKILLS ===\n');

  for (let i = 0; i < carts.length; i++) {
    const cart = carts[i];
    const rec = recommendations[i];
    const productList = cart.products.map(p => `${p.title} x${p.quantity} (€${p.price})`).join(', ');
    const cartTotal = cart.products.reduce((s, p) => s + p.price * p.quantity, 0);

    const systemPrompt = `Eres Andrea, dueña de NICOLINA, una pastelería artesanal sin gluten en Madrid. Escribes emails de recuperación de carrito.

MARKETING FRAMEWORKS QUE DEBES APLICAR:

1. PAS (Problem-Agitate-Solve): Identifica el deseo (el producto), agita con un detalle sensorial que genere antojo, resuelve haciéndolo fácil.

2. CURIOSITY GAP en asunto: El asunto debe crear una brecha de curiosidad. El lector debe pensar "¿qué será?" y abrir. Fórmulas:
   - "[Nombre], algo sobre [producto] que no sabes"
   - "El ingrediente secreto de [producto]"
   - "[Nombre], ¿sabías esto de [producto]?"
   - Una pregunta inesperada sobre el producto
   NUNCA: "te espera", "está lista", "preparada para ti", "tu pedido", "tu carrito"

3. SPECIFICITY > VAGUENESS: Usa detalles concretos. "Almendra marcona molida" mejor que "ingredientes frescos". "Hornada del jueves" mejor que "fresca para ti".

4. SOCIAL PROOF sutil: "es la que más repiten", "la favorita de los viernes", "la que siempre se agota primero". Sin inventar datos.

5. LOSS AVERSION suave: No presionar, pero sí hacer sentir lo que se pierde. "El centro fundido que no probaste" > "completa tu pedido".

REGLAS ABSOLUTAS:
- Escribe en español. Sin palabras en inglés.
- MÁXIMO 4 LÍNEAS de copy. Corto, directo, sensorial.
- El asunto debe generar curiosidad genuina, no clickbait.
- INCLUIR SIEMPRE la recomendación del producto indicado con un detalle sensorial específico.
- Tono: amiga que tiene una pastelería y te escribe un WhatsApp. NO marketing automation.
- SIN descuentos — el token no puede crearlos ahora.
- MÁXIMO 1 emoji. MÁXIMO 1 signo de exclamación en todo el email.
- PROHIBIDO: "un abrazo dulce", "explosión de sabor", "experiencia única", "no te lo pierdas", "te encantará", "descubre", "haz tu pedido", "compra ya", "pide ahora", "pura fantasía", "te espera", "está lista para ti", frases con ¡...! que suenen a teletienda.

Este es el email ${i + 1} de ${carts.length}. Los otros emails del batch son:
${batchContext}
NO repitas hooks, aperturas, estructuras ni frases de los otros emails. Cada email debe sentirse completamente diferente.

Devuelve SOLO JSON válido:
{
  "title": "<asunto curioso, 5-10 palabras>",
  "description": "<1 línea: por qué enviar esto>",
  "content": {
    "customer_email": "${cart.customer_email}",
    "customer_name": "${cart.customer_name}",
    "products": ${JSON.stringify(cart.products)},
    "recommended_product": "<el producto recomendado>",
    "recommended_sensory": "<detalle sensorial del recomendado>",
    "copy": "<cuerpo del email, MÁXIMO 4 líneas>"
  }
}`;

    const recBlock = rec
      ? `PRODUCTO A RECOMENDAR (obligatorio, NO está en el carrito): ${rec.product}
DETALLE SENSORIAL del recomendado: ${rec.sensory}`
      : 'No hay recomendación disponible — céntrate solo en el producto del carrito.';

    const userPrompt = `Cliente: ${cart.customer_name} (${cart.customer_email})
Productos en carrito: ${productList}
Total carrito: €${cartTotal.toFixed(2)}

${recBlock}

Genera el email de cart_recovery. Recuerda: 4 líneas máximo, asunto curioso, recomendación incluida, sin descuento.`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.85,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });

      const raw = completion.choices[0]?.message?.content;
      if (!raw) { console.log(`  ✗ Empty response for ${cart.customer_name}`); continue; }

      const action = JSON.parse(raw) as {
        title: string;
        description: string;
        content: Record<string, unknown>;
      };

      // Update existing action
      await supabase
        .from('pending_actions')
        .update({
          title: action.title,
          description: action.description,
          content: {
            ...action.content,
            priority: 'high',
            time_estimate: '5 min',
            plan_required: 'growth',
          },
        })
        .eq('id', cart.actionId);

      const tokens = completion.usage?.total_tokens ?? 0;
      console.log(`── ${i + 1}. ${cart.customer_name} (${tokens} tok) ──`);
      console.log(`ASUNTO: ${action.title}`);
      console.log(`RECOMENDACIÓN: ${action.content.recommended_product}`);
      console.log(`COPY:\n${action.content.copy}\n`);

    } catch (err) {
      console.log(`  ✗ Failed for ${cart.customer_name}: ${(err as Error).message}`);
    }
  }

  console.log('=== DONE — 7 actions updated, nothing sent ===');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
