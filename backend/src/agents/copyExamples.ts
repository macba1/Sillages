// ── Elite Copywriting Examples & Frameworks ─────────────────────────────────
// Used by the Growth Hacker agent to generate scroll-stopping, brand-appropriate content.

// ── CART RECOVERY FEW-SHOT EXAMPLES (hand-written by Andrea, NICOLINA) ──────
// These are the GOLD STANDARD. The Growth Hacker must study and match this tone.

export interface CartRecoveryExample {
  customer_name: string;
  products_in_cart: string;
  subject: string;
  body: string;
  recommended_product: string;
}

export const CART_RECOVERY_EXAMPLES: CartRecoveryExample[] = [
  {
    customer_name: 'Laura',
    products_in_cart: 'Tarta de Cumpleaños, Caja Merienda',
    subject: 'Laura, sobre la Tarta de Cumpleaños',
    body: 'Laura, la Tarta de Cumpleaños lleva un bizcocho esponjoso con cobertura de crema suave. Todo sin gluten. Si además te gusta picar algo dulce, la Granola con avena dorada y almendras tostadas es perfecta al día siguiente con un yogur.',
    recommended_product: 'Granola',
  },
  {
    customer_name: 'Tamar',
    products_in_cart: 'Volcán de Chocolate, Tarta de Queso, Velas',
    subject: 'Tamar, el Volcán o la Tarta de Queso',
    body: 'Tamar, el Volcán de Chocolate tiene un centro caliente que fluye espeso cuando lo cortas. La Tarta de Queso es cremosa y densa — otro registro totalmente distinto. No hace falta elegir, la verdad.',
    recommended_product: '',
  },
  {
    customer_name: 'Leticia',
    products_in_cart: 'Porciones Tartas x2',
    subject: 'Leticia, algo sobre las porciones',
    body: 'Leticia, las porciones son perfectas para probar sin compromiso. Si te gusta lo cítrico, la de limón tiene ese punto ácido-dulce que se queda en el paladar. Y si vas más de chocolate, el Volcán no decepciona.',
    recommended_product: 'Volcán de Chocolate',
  },
  {
    customer_name: 'Anna',
    products_in_cart: 'Dona Kinder, Dona Peanut Reese, Dona Banana Croc, Dona Rafaello',
    subject: 'Anna, sobre las donas',
    body: 'Anna, la Dona Kinder tiene una crema de avellana que se nota en cada bocado. La Banana lleva plátano real con chocolate. Cuatro donas, cuatro sabores distintos — y todas sin gluten. Si te van los dulces más contundentes, la Cookie XXL de chocolate y avellanas es otro nivel.',
    recommended_product: 'Cookie XXL de Chocolate y Avellanas',
  },
  {
    customer_name: 'Lorena',
    products_in_cart: 'Tarta Bebé',
    subject: 'Lorena, la Tarta Bebé',
    body: 'Lorena, la Tarta Bebé tiene un bizcocho tierno con un toque de vainilla que se deshace. Todo sin gluten y con ingredientes naturales. Si buscas algo para acompañar, las Pastas de Té tienen esa textura fina que va muy bien después.',
    recommended_product: 'Pastas de Té',
  },
  {
    customer_name: 'Paola',
    products_in_cart: 'Caja Merienda, Dona Kinder',
    subject: 'Paola, lo de la Caja Merienda',
    body: 'Paola, la Caja Merienda tiene un poco de todo — dulce, esponjoso, crujiente. La Dona Kinder con su crema de avellana es la favorita. Si te gusta el chocolate intenso, prueba el Volcán de Chocolate. Cuando lo cortas, el centro fluye.',
    recommended_product: 'Volcán de Chocolate',
  },
  {
    customer_name: 'Sergio',
    products_in_cart: 'Volcán de Chocolate',
    subject: 'Sergio, el Volcán de Chocolate',
    body: 'Sergio, el Volcán de Chocolate tiene un centro que fluye espeso y caliente cuando lo cortas. Chocolate puro, sin gluten, sin prisa. Si te gusta el contraste, la Tarta de Queso es cremosa y densa — el equilibrio perfecto después de tanto chocolate.',
    recommended_product: 'Tarta de Queso',
  },
  {
    customer_name: 'Cecilia',
    products_in_cart: 'Tarta de Queso',
    subject: 'Cecilia, la Tarta de Queso',
    body: 'Cecilia, la Tarta de Queso tiene esa textura cremosa y densa que se queda en el paladar. Si no la conoces todavía, la Tarta de Limón tiene un carácter distinto — cítrica, fresca, con una base crujiente.',
    recommended_product: 'Tarta de Limón',
  },
  {
    customer_name: 'Daniela',
    products_in_cart: 'Tarta de Queso',
    subject: 'Daniela, algo sobre la Tarta de Queso',
    body: 'Daniela, la Tarta de Queso es cremosa y densa — se queda en el paladar. Todo sin gluten. Para acompañar, la Hogaza de Pasas y Nueces tiene una corteza crujiente con un interior suave que sorprende.',
    recommended_product: 'Hogaza de Pasas y Nueces',
  },
  {
    customer_name: 'Ana',
    products_in_cart: 'Pan de Molde Semillas, Crackers Natural, Bizcocho de la Casa, Cookie XXL',
    subject: 'Ana, tu selección',
    body: 'Ana, el Pan de Molde Semillas tiene una textura esponjosa llena de semillas que crujen. La Cookie XXL de chocolate y avellanas es crujiente por fuera y tierna por dentro. Si te va lo dulce, la Tarta de Zanahoria con su toque de canela es otro mundo.',
    recommended_product: 'Tarta de Zanahoria',
  },
  {
    customer_name: 'Miriam',
    products_in_cart: 'Granola, Tortitas, Cookies Chocolate x3, Cookie Pepitas x3, Palmeritas, Bizcocho Marmolado',
    subject: 'Miriam, lo de la Granola',
    body: 'Miriam, la Granola lleva avena dorada con almendras tostadas y un toque de canela. Con yogur por la mañana es otro desayuno. El Bizcocho Marmolado mezcla cacao y vainilla — si te gustan los dos, no tienes que elegir. Y si quieres probar algo nuevo, la Tarta de Limón tiene un ácido-dulce que engancha.',
    recommended_product: 'Tarta de Limón',
  },
];

/**
 * Build a few-shot reference block for the Growth Hacker prompt.
 * Includes 4 diverse examples to show the expected tone and structure.
 */
export function buildCartRecoveryExamplesBlock(): string {
  // Pick 4 diverse examples: different cart sizes, categories, tones
  const picks = [0, 3, 6, 10]; // Laura (tarta+snack), Anna (donas), Sergio (chocolate), Miriam (big cart)
  const examples = picks.map(i => CART_RECOVERY_EXAMPLES[i]);

  const lines = [
    '═══════════════════════════════════════════════════════════════════',
    'CART_RECOVERY REFERENCE EMAILS (study these — this is the standard)',
    'Tone: only product, sensorial, no marketing, no pressure, like a friend',
    '═══════════════════════════════════════════════════════════════════',
  ];

  for (const ex of examples) {
    lines.push(`\nCart: ${ex.products_in_cart}`);
    lines.push(`Subject: ${ex.subject}`);
    lines.push(`Body: ${ex.body}`);
    lines.push(`Recommendation: ${ex.recommended_product || '(none — products in cart cover cross-sell)'}`);
  }

  lines.push('\nRULES FROM THESE EXAMPLES:');
  lines.push('- Subject: "[Name], [about/sobre] [product]" — simple, direct, curious');
  lines.push('- Body: describe the product with sensory details ONLY from the Shopify product description or brand profile. NEVER invent flavors/textures.');
  lines.push('- If no product description exists → just name the product, no adjectives');
  lines.push('- Recommendation: always from a different category, with its own confirmed sensory hook');
  lines.push('- Tone: like a WhatsApp from a friend, NOT a marketing email');
  lines.push('- No emojis, no exclamation marks, no marketing phrases');
  lines.push('- No "te espera", "completa tu pedido", "no te lo pierdas"');
  lines.push('- Closing: natural, no CTA button language, no "haz tu pedido"');

  return lines.join('\n');
}

// ── 6 COPYWRITING FRAMEWORKS ────────────────────────────────────────────────

export const COPYWRITING_FRAMEWORKS = `
═══════════════════════════════════════════════════════════════════
THE 6 COPYWRITING FRAMEWORKS — USE ONE PER ACTION
═══════════════════════════════════════════════════════════════════

FRAMEWORK 1: THE CONTRAST
Show the boring version vs. the real version. Creates "aha" moment.
USE FOR: instagram_post, product_highlight
FORMULA: "[Generic thing everyone does] vs. [What WE do differently]"
EXAMPLES:
- "Tarta de chocolate. Suena normal. Hasta que la abres y el centro se derrama, caliente, espeso, con cacao puro de Ecuador. Eso es un Volcán de Chocolate. 🍫"
- "Puedes comprar un bizcocho en cualquier sitio. O puedes probar uno hecho con harina de almendra molida esta mañana y limones de Murcia. nicolina.es"
- "Pan sin gluten. Normalmente suena a cartón. El nuestro tiene corteza crujiente y miga esponjosa. Nadie se cree que es sin gluten. 🍞"

FRAMEWORK 2: THE SPECIFIC DETAIL
Lead with ONE hyper-specific detail that makes it real and tangible.
USE FOR: instagram_post, product_highlight, reactivation_email
FORMULA: "[One very specific detail about ingredient/process/origin] + [emotional payoff]"
EXAMPLES:
- "Las fresas de nuestra Tarta Corazón vienen de Aranjuez. Las recogieron ayer. Hoy las estamos colocando una a una sobre crema pastelera de vainilla natural. Solo 8 unidades este viernes. 🍓"
- "Cada Volcán de Chocolate lleva exactamente 47 minutos en el horno. Ni 46, ni 48. Ese minuto extra es lo que hace que el centro siga líquido cuando lo abres en casa. 🌋"
- "Nuestra harina de almendra viene de Mallorca. La molemos el mismo día que horneamos. Por eso nuestros bizcochos tienen ese sabor que no puedes explicar pero no puedes dejar de comer."

FRAMEWORK 3: THE SOCIAL PROOF FLIP
Don't say "our customers love us." Show it through a real story or data point.
USE FOR: instagram_post, reactivation_email, whatsapp_message
FORMULA: "[Real customer action/behavior] + [what it says about the product]"
EXAMPLES:
- "María pidió la Tarta de Zanahoria 3 veces este mes. La tercera vez nos escribió: 'Es para mí sola, no juzguéis.' María, no juzgamos. Entendemos. 🥕"
- "El viernes pasado vendimos 14 Volcanes de Chocolate en 3 horas. El sábado tuvimos que decir que no a 6 pedidos. Este viernes hemos preparado 20. 🍫"
- "Un cliente nos dijo: 'Mi hijo es celíaco y por primera vez no se sintió diferente en su cumpleaños.' Para eso hacemos lo que hacemos. 💛"

FRAMEWORK 4: THE FOMO (Fear Of Missing Out)
Create urgency through scarcity, timing, or exclusivity. Never fake.
USE FOR: instagram_post, discount_code, whatsapp_message
FORMULA: "[Limited quantity/time/availability] + [specific reason why] + [soft CTA]"
EXAMPLES:
- "Solo 6 Tartas Corazón Fresas para este sábado. Las fresas de temporada se acaban en 2 semanas. Si la quieres, escríbenos hoy → nicolina.es 🍓"
- "Este Volcán de Chocolate es de temporada. En septiembre dejamos de hacerlo hasta noviembre. Quedan 3 viernes para probarlo. 🌋"
- "Hemos hecho Carrot Cake con nueces caramelizadas solo esta semana. 4 unidades. Cuando se acaben, se acaben."

FRAMEWORK 5: THE FRIEND DISCOVERY
Write as if you're telling a friend about something amazing you just found.
USE FOR: instagram_post, whatsapp_message, reactivation_email
FORMULA: "[Casual, conversational tone] + [what makes it special] + [implicit recommendation]"
EXAMPLES:
- "Oye, ¿has probado la Tarta de Limón de Nicolina? Tiene esa cosa de que es ácida y dulce a la vez, y el merengue está tostado con soplete. Pídela el viernes, me lo agradecerás. 🍋"
- "Mi compi de trabajo trajo un Volcán de Chocolate al office y literalmente paramos una reunión. No es broma. Lo abrió y el chocolate salía por dentro. Necesito saber dónde lo pidió → nicolina.es"
- "Si conoces a alguien que no puede comer gluten y piensa que los dulces sin gluten no pueden ser buenos… llévale algo de Nicolina. Le vas a cambiar la vida."

FRAMEWORK 6: THE QUESTION HOOK
Open with a question that stops the scroll and makes people think.
USE FOR: instagram_post, product_highlight
FORMULA: "[Provocative/curious question] + [answer that leads to the product] + [CTA]"
EXAMPLES:
- "¿Sabías que la mayoría de tartas sin gluten usan mezclas industriales? Las nuestras llevan harina de almendra de Mallorca, molida el mismo día. La diferencia se nota en el primer bocado. 🌰"
- "¿Cuándo fue la última vez que un postre te hizo cerrar los ojos? Volcán de Chocolate. Lo abrís y se derrama. nicolina.es 🍫"
- "¿Qué tienen en común nuestros 3 clientes más fieles? Todos empezaron con la Tarta de Zanahoria. Coincidencia? Pruébala y lo descubres. 🥕"

═══════════════════════════════════════════════════════════════════
FRAMEWORK SELECTION RULES
═══════════════════════════════════════════════════════════════════
- instagram_post → use THE CONTRAST, THE SPECIFIC DETAIL, or THE QUESTION HOOK
- discount_code → use THE FOMO
- reactivation_email → use THE SOCIAL PROOF FLIP or THE FRIEND DISCOVERY
- whatsapp_message → use THE FRIEND DISCOVERY or THE FOMO
- product_highlight → use THE CONTRAST or THE SPECIFIC DETAIL
- seo_fix → no framework needed (focus on keywords and search intent)

IMPORTANT: State which framework you're using in the action description.
Example: "Using THE SPECIFIC DETAIL framework — leads with the exact origin of ingredients..."
`;

// ── SENSORY RULES ───────────────────────────────────────────────────────────

export const SENSORY_RULES = `
═══════════════════════════════════════════════════════════════════
SENSORY RULES — MAKE PEOPLE FEEL IT
═══════════════════════════════════════════════════════════════════

⚠️ CRITICAL RULE — NEVER INVENT SENSORY DETAILS:
Only describe flavors, textures, aromas, or ingredients that are:
1. Explicitly stated in the product's Shopify description
2. Stated in the brand profile
3. Obviously implied by the product name (e.g. "chocolate" in "Volcán de Chocolate")
If there is NO product description → mention ONLY the product name, without adjectives or flavor descriptions.
NEVER guess or invent sensory attributes. Saying "toque ácido" about a cheesecake when it doesn't have one tells the customer the product is bad. This destroys merchant trust.

Every piece of copy for food/bakery/artisanal stores MUST include at least 2 of these 5 senses (ONLY if the details are confirmed from the product data):

👁️ SIGHT: Describe what it LOOKS like.
- Color: "dorado", "chocolate oscuro", "rojo fresa"
- Texture visible: "corteza crujiente", "merengue tostado", "crema brillante"
- Action: "se derrama", "se deshace", "brilla"

👃 SMELL: Describe what it SMELLS like.
- "Abre la caja y huele a vainilla natural y mantequilla dorada"
- "El aroma de chocolate caliente que llena tu cocina"
- "Huele a limón fresco, como si acabaras de rallarlo"

✋ TOUCH/TEXTURE: Describe what it FEELS like in your mouth or hands.
- "Miga esponjosa", "crujiente por fuera, tierno por dentro"
- "El chocolate caliente que se derrama lento"
- "Suave como una nube", "denso y húmedo"

👅 TASTE: Describe what it TASTES like.
- "Ácido y dulce a la vez", "cacao puro, intenso, sin azúcar"
- "El dulce justo, que no empalaga"
- "Sabe a domingo por la mañana"

👂 SOUND: Describe what it SOUNDS like (rare but powerful).
- "El crujido cuando partes la corteza"
- "Ese 'crack' del merengue tostado"

FOR NON-FOOD STORES: Adapt the senses to the product category:
- Fashion: touch of fabric, visual of the outfit, sound of heels
- Beauty: scent, texture on skin, visual transformation
- Home: visual arrangement, texture of materials, ambient sound
- Tech: tactile feel, visual design, sound of notification

RULE: If your copy doesn't make someone hungry/want the product after reading it, rewrite it.
`;

// ── ABSOLUTE RULES ──────────────────────────────────────────────────────────

export const ABSOLUTE_RULES = `
═══════════════════════════════════════════════════════════════════
ABSOLUTE RULES — BREAK THESE AND THE COPY IS REJECTED
═══════════════════════════════════════════════════════════════════

1. NO TECHNICAL INGREDIENTS in customer-facing copy.
   ❌ "Hecho con eritritol y harina de almendra desgrasada"
   ✅ "Endulzado de forma natural, sin azúcar añadido"
   ❌ "Contiene xantana y psyllium como aglutinantes"
   ✅ "La textura perfecta sin gluten — nadie nota la diferencia"
   EXCEPTION: If the brand specifically markets the ingredient (e.g., "matcha de Uji"), use it.

2. NO GENERIC COPY. The "competitor test": if you could paste this copy on a competitor's page and it works, it's too generic. REWRITE.
   ❌ "¡Descubre nuestras deliciosas tartas! Hechas con amor."
   ❌ "¡Celebra con nosotros! Descuentos especiales."
   ❌ "Nuestros productos son de la mejor calidad."
   ✅ Must include: specific product name + specific detail about THIS store

3. INSTAGRAM MAX 3 LINES of visible text (before "...more"). The hook must be in line 1.
   Line 1: Hook (question, specific detail, or contrast)
   Line 2: Payoff (sensory detail, emotional connection)
   Line 3: CTA (soft, natural — link, "solo X unidades", "escríbenos")

4. THE SCREENSHOT TEST: Would someone screenshot this post and send it to a friend saying "we HAVE to try this"? If not → rewrite.

5. EVERY ACTION MUST INCLUDE A GROWTH HACKING TECHNIQUE:
   - Scarcity: limited units, seasonal, "cuando se acaben"
   - Social proof: customer story, repeat purchase data, sold-out history
   - Reciprocity: free sample offer, surprise upgrade, bonus item
   - Anchoring: show original price vs. special price
   - Loss aversion: "only X left", "last weekend of the season"
   - Curiosity gap: "There's a reason this is our #1..." without revealing immediately

6. NO EXCLAMATION MARK ABUSE. Max 1 per copy. Zero is better.
   ❌ "¡Increíble! ¡No te lo pierdas! ¡Pide ya!"
   ✅ "Volcán de Chocolate. Lo abrís y se derrama. No hace falta decir más. 🍫"

7. EMOJIS: Max 2 per copy. Must be relevant (🍫 for chocolate, 🍓 for strawberry). Never 🔥🚀💯.

8. HASHTAGS: Max 3, placed at the END, lowercase, brand-specific.
   ✅ #nicolina #singluten #tartasmadrid
   ❌ #food #yummy #delicious #instagood #foodporn #bakery #cake

9. CALL TO ACTION must be SOFT and NATURAL.
   ❌ "¡Compra ahora!", "¡Haz tu pedido!", "¡Aprovecha!"
   ✅ "nicolina.es", "escríbenos", "solo por encargo", "solo X unidades"

10. NEVER START WITH THE STORE NAME.
    ❌ "Nicolina presenta su nueva tarta..."
    ✅ "Tarta de Limón con merengue tostado con soplete..."
`;

// ── EXAMPLE COPIES BY CATEGORY ──────────────────────────────────────────────

export const COPY_EXAMPLES_BY_CATEGORY = {
  bakery_artisanal: [
    // THE CONTRAST
    'Tarta de chocolate. Suena normal. Hasta que la abres y el centro se derrama, caliente, espeso, con cacao puro. Eso es un Volcán de Chocolate. 🍫',
    'Puedes comprar un bizcocho en cualquier sitio. O puedes probar uno donde la almendra se muele el mismo día que se hornea.',
    // THE SPECIFIC DETAIL
    'Cada Volcán lleva exactamente 47 minutos en el horno. Ni 46 ni 48. Ese minuto extra es lo que hace que el centro siga líquido cuando lo abres en casa. 🌋',
    'Las fresas de nuestra Tarta Corazón vienen de Aranjuez. Las recogieron ayer. Hoy las colocamos una a una sobre crema pastelera de vainilla natural. Solo 8 unidades este viernes. 🍓',
    // THE SOCIAL PROOF FLIP
    'María pidió la Tarta de Zanahoria 3 veces este mes. La tercera vez nos escribió: "Es para mí sola, no juzguéis." No juzgamos. Entendemos. 🥕',
    'El viernes pasado vendimos 14 Volcanes en 3 horas. El sábado tuvimos que decir que no a 6 pedidos. Este viernes hemos preparado 20. 🍫',
    // THE FOMO
    'Solo 6 Tartas Corazón Fresas para este sábado. Las fresas de temporada se acaban en 2 semanas. escríbenos hoy → nicolina.es 🍓',
    'Carrot Cake con nueces caramelizadas solo esta semana. 4 unidades. Cuando se acaben, se acaben.',
    // THE FRIEND DISCOVERY
    '¿Has probado la Tarta de Limón de Nicolina? Tiene esa cosa de que es ácida y dulce a la vez, y el merengue está tostado con soplete. Pídela el viernes. 🍋',
    'Si conoces a alguien celíaco que piensa que los dulces sin gluten no pueden ser buenos… llévale algo de Nicolina. Le cambias la vida.',
    // THE QUESTION HOOK
    '¿Sabías que la mayoría de tartas sin gluten usan mezclas industriales? Las nuestras llevan harina de almendra, molida el mismo día. La diferencia se nota en el primer bocado. 🌰',
    '¿Cuándo fue la última vez que un postre te hizo cerrar los ojos? Volcán de Chocolate. Lo abrís y se derrama. nicolina.es 🍫',
  ],
  fashion: [
    'Hay vestidos que te pones. Y hay vestidos que te cambian la postura, la forma de caminar, cómo entras a un sitio. Este es de los segundos.',
    'La tela se siente como una segunda piel. No es seda — es algo mejor. Y cuesta la mitad.',
    'María lo pidió en negro. Luego volvió por el burdeos. Y la semana pasada, el verde oliva. No la culpamos.',
  ],
  beauty: [
    'Te lo pones en la mano y huele a jazmín recién cortado. Te lo pones en la cara y sientes cómo tu piel bebe. En 10 minutos, brillas.',
    'El 73% de nuestras clientas repiten en los primeros 30 días. El sérum hace lo que promete.',
  ],
};
