import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { openai } from '../lib/openai.js';

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

// ── Cross-category product map ───────────────────────────────────────────────
type Category = 'tarta' | 'chocolate' | 'pan_bizcocho' | 'desayuno_snack' | 'dona' | 'otros';

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
  'GRANOLA': 'desayuno_snack',
  'TORTITAS': 'desayuno_snack',
  'CRACKERS NATURAL': 'desayuno_snack',
  'DONA KINDER': 'dona',
  'DONA PEANUT REESE': 'dona',
  'DONA BANANA CROC': 'dona',
  'DONA RAFAELLO': 'dona',
  'DONA CHOCOLATE': 'dona',
  'PORCIONES TARTAS': 'tarta',
  'VELAS DORADAS': 'otros',
  'VELA FELICIDADES': 'otros',
  'NUTELINA': 'chocolate',
};

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
  dona: [
    { product: 'TARTA DE QUESO', sensory: 'cremosa, densa, con un punto ácido que sorprende' },
    { product: 'GRANOLA', sensory: 'avena tostada con almendras y canela, crujiente en cada cucharada' },
    { product: 'BIZCOCHO MARMOLADO', sensory: 'esponjoso, con vetas de cacao que cruzan la masa de vainilla' },
    { product: 'Cookie XXL de Chocolate y Avellanas', sensory: 'del tamaño de tu mano, crujiente por fuera, blanda por dentro' },
    { product: 'PALMERITAS DE HOJALDRE', sensory: 'finas, crujientes, con azúcar caramelizado en cada capa' },
  ],
  otros: [
    { product: 'TARTA DE QUESO', sensory: 'textura cremosa y densa, con un punto ácido que equilibra' },
    { product: 'VOLCÁN DE CHOCOLATE', sensory: 'centro fundido de chocolate que se derrama al partirlo' },
  ],
};

function getCategory(title: string): Category {
  return PRODUCT_CATEGORIES[title] ?? 'otros';
}

function getMainCategory(products: Array<{ title: string }>): Category {
  // Find the first non-"otros" product category
  for (const p of products) {
    const cat = getCategory(p.title);
    if (cat !== 'otros') return cat;
  }
  return 'tarta';
}

function pickRecommendation(
  cartProducts: string[],
  alreadyRecommended: Set<string>,
  mainCategory: Category,
): { product: string; sensory: string } | null {
  const candidates = CROSS_RECS[mainCategory] ?? CROSS_RECS.tarta;
  for (const c of candidates) {
    if (cartProducts.includes(c.product)) continue;
    if (alreadyRecommended.has(c.product)) continue;
    return c;
  }
  // Fallback: any other category
  for (const [, recs] of Object.entries(CROSS_RECS)) {
    for (const c of recs) {
      if (cartProducts.includes(c.product)) continue;
      if (alreadyRecommended.has(c.product)) continue;
      if (getCategory(c.product) !== mainCategory) return c;
    }
  }
  return null;
}

// ── Target carts (15-17 March, with email, no "Visitante" without real name) ─
interface CartTarget {
  customer_name: string;
  customer_email: string;
  products: Array<{ title: string; quantity: number; price: number }>;
  total_price: number;
  abandoned_at: string;
  priority: 'high' | 'medium' | 'low';
}

async function main() {
  // 1. Clean old cart_recovery actions
  console.log('=== CLEANING OLD ACTIONS ===');
  const { error: delErr } = await supabase
    .from('pending_actions')
    .delete()
    .eq('account_id', ANDREA_ID)
    .eq('type', 'cart_recovery');
  if (delErr) console.log('Delete error:', delErr.message);
  else console.log('Old cart_recovery actions deleted');

  // 2. Load target carts
  console.log('\n=== LOADING TARGET CARTS ===');
  const { data: carts } = await supabase
    .from('abandoned_carts')
    .select('customer_name, customer_email, total_price, abandoned_at, products')
    .eq('account_id', ANDREA_ID)
    .gte('abandoned_at', '2026-03-14T00:00:00Z')
    .order('abandoned_at', { ascending: false });

  if (!carts || carts.length === 0) {
    console.log('No carts found');
    return;
  }

  // Filter: must have email, exclude "Visitante" without real name
  const targets: CartTarget[] = carts
    .filter(c => {
      if (!c.customer_email) return false;
      if (c.customer_name === 'Visitante' || !c.customer_name) return false;
      return true;
    })
    .map(c => {
      const date = c.abandoned_at.slice(0, 10);
      let priority: 'high' | 'medium' | 'low' = 'low';
      if (date === '2026-03-17') priority = 'high';
      else if (date === '2026-03-16') priority = 'medium';
      return {
        customer_name: c.customer_name,
        customer_email: c.customer_email,
        products: c.products as Array<{ title: string; quantity: number; price: number }>,
        total_price: c.total_price,
        abandoned_at: c.abandoned_at,
        priority,
      };
    });

  console.log(`${targets.length} carts to process:\n`);
  targets.forEach((t, i) => {
    const prods = t.products.map(p => p.title).join(', ');
    console.log(`  ${i + 1}. [${t.priority.toUpperCase()}] ${t.customer_name} — €${t.total_price} — ${prods}`);
  });

  // 3. Assign cross-category recommendations (no repeats)
  const alreadyRecommended = new Set<string>();
  const recommendations: Array<{ product: string; sensory: string } | null> = [];

  for (const cart of targets) {
    const cartTitles = cart.products.map(p => p.title);
    const mainCat = getMainCategory(cart.products);
    const rec = pickRecommendation(cartTitles, alreadyRecommended, mainCat);
    recommendations.push(rec);
    if (rec) alreadyRecommended.add(rec.product);
  }

  console.log('\n=== RECOMMENDATIONS ===');
  targets.forEach((t, i) => {
    console.log(`  ${t.customer_name} → ${recommendations[i]?.product ?? 'NONE'}`);
  });

  // 4. Build batch context
  const batchContext = targets.map((t, i) =>
    `Email ${i + 1} [${t.priority}]: ${t.customer_name} — carrito: ${t.products.map(p => p.title).join(', ')} — rec: ${recommendations[i]?.product ?? 'none'}`
  ).join('\n');

  // 5. Generate emails
  console.log('\n=== GENERATING EMAILS ===\n');

  const results: Array<{
    name: string;
    priority: string;
    title: string;
    copy: string;
    recommended: string;
    email: string;
  }> = [];

  for (let i = 0; i < targets.length; i++) {
    const cart = targets[i];
    const rec = recommendations[i];
    const productList = cart.products.map(p => `${p.title} x${p.quantity} (€${p.price})`).join(', ');
    const cartTotal = cart.total_price;

    const systemPrompt = `Eres Andrea, dueña de NICOLINA, una pastelería artesanal sin gluten en Madrid. Escribes emails de recuperación de carrito.

MARKETING FRAMEWORKS:

1. PAS (Problem-Agitate-Solve): Identifica el deseo (el producto), agita con un detalle sensorial que genere antojo, resuelve haciéndolo fácil.

2. CURIOSITY GAP en asunto: El asunto debe crear una brecha de curiosidad. Fórmulas:
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
- SIN descuentos.
- MÁXIMO 1 emoji. MÁXIMO 1 signo de exclamación en todo el email.
- PROHIBIDO: "un abrazo dulce", "explosión de sabor", "experiencia única", "no te lo pierdas", "te encantará", "descubre", "haz tu pedido", "compra ya", "pide ahora", "pura fantasía", "te espera", "está lista para ti", "tu carrito", "completar tu pedido", "un clásico", "irresistible", "no podrás resistirte".

Este es el email ${i + 1} de ${targets.length}. Los otros emails del batch son:
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
      ? `PRODUCTO A RECOMENDAR (obligatorio, NO está en el carrito): ${rec.product}\nDETALLE SENSORIAL del recomendado: ${rec.sensory}`
      : 'No hay recomendación disponible — céntrate solo en el producto del carrito.';

    const userPrompt = `Cliente: ${cart.customer_name} (${cart.customer_email})
Productos en carrito: ${productList}
Total carrito: €${cartTotal.toFixed(2)}
Prioridad: ${cart.priority.toUpperCase()} (${cart.priority === 'high' ? 'hoy' : cart.priority === 'medium' ? 'ayer' : 'hace 2-3 días'})

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

      // Insert into pending_comms
      const { error: insertErr } = await supabase
        .from('pending_comms')
        .insert({
          account_id: ANDREA_ID,
          type: 'cart_recovery',
          channel: 'email',
          status: 'pending',
          content: {
            ...action.content,
            title: action.title,
            description: action.description,
            priority: cart.priority,
            abandoned_at: cart.abandoned_at,
          },
        });

      if (insertErr) {
        console.log(`  ✗ Insert error for ${cart.customer_name}: ${insertErr.message}`);
        continue;
      }

      const tokens = completion.usage?.total_tokens ?? 0;
      results.push({
        name: cart.customer_name,
        priority: cart.priority,
        title: action.title,
        copy: String(action.content.copy),
        recommended: String(action.content.recommended_product),
        email: cart.customer_email,
      });

      console.log(`  ✓ ${i + 1}/${targets.length} ${cart.customer_name} (${tokens} tok)`);
    } catch (err) {
      console.log(`  ✗ Failed for ${cart.customer_name}: ${(err as Error).message}`);
    }
  }

  // 6. Print all emails
  console.log('\n\n════════════════════════════════════════════════════════════════');
  console.log('                    11 EMAILS GENERADOS');
  console.log('════════════════════════════════════════════════════════════════\n');

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const priorityLabel = r.priority === 'high' ? '🔴 ALTA' : r.priority === 'medium' ? '🟡 MEDIA' : '🟢 BAJA';
    console.log(`── ${i + 1}. ${r.name} <${r.email}> [${priorityLabel}] ──`);
    console.log(`ASUNTO: ${r.title}`);
    console.log(`RECOMENDACIÓN: ${r.recommended}`);
    console.log(`COPY:\n${r.copy}`);
    console.log('');
  }

  console.log(`\n=== DONE — ${results.length} emails en pending_comms ===`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
