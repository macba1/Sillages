import { openai } from '../lib/openai.js';
import { supabase } from '../lib/supabase.js';
import { shopifyClient } from '../lib/shopify.js';
import { loadBrandProfile } from './brandAnalyzer.js';
import { buildCartRecoveryExamplesBlock } from '../agents/copyExamples.js';
import type { DetectedEvent, NewFirstBuyerData, AbandonedCartData, OverdueCustomerData } from './eventDetector.js';

const LOG = '[eventAction]';

// ── Compute "also bought" recommendations from real order data ────────────

async function getAlsoBought(accountId: string, productTitle: string): Promise<string[]> {
  try {
    const { data: conn } = await supabase
      .from('shopify_connections')
      .select('shop_domain, access_token')
      .eq('account_id', accountId)
      .single();

    if (!conn) return [];

    const client = shopifyClient(conn.shop_domain, conn.access_token);
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();
    const { orders } = await client.getOrders({
      created_at_min: sixtyDaysAgo,
      created_at_max: new Date().toISOString(),
    });

    // Find all orders that contain the target product
    const ordersWithProduct = orders.filter(o =>
      o.line_items.some(li => li.title === productTitle) &&
      o.financial_status !== 'voided' && !o.cancel_reason,
    );

    // Count co-purchased products
    const coPurchases = new Map<string, number>();
    for (const order of ordersWithProduct) {
      for (const li of order.line_items) {
        if (li.title !== productTitle) {
          coPurchases.set(li.title, (coPurchases.get(li.title) ?? 0) + li.quantity);
        }
      }
    }

    // Also look at what repeat buyers of this product buy in OTHER orders
    const buyerEmails = new Set(ordersWithProduct.map(o => o.customer?.email).filter(Boolean));
    for (const order of orders) {
      if (!buyerEmails.has(order.customer?.email)) continue;
      if (ordersWithProduct.some(o => o.id === order.id)) continue; // skip same order
      for (const li of order.line_items) {
        if (li.title !== productTitle) {
          coPurchases.set(li.title, (coPurchases.get(li.title) ?? 0) + li.quantity);
        }
      }
    }

    return [...coPurchases.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([title]) => title);
  } catch {
    return [];
  }
}

// ── Generate a single action for a detected event ──────────────────────────

export async function generateEventAction(
  accountId: string,
  event: DetectedEvent,
  language: 'en' | 'es',
  storeName: string,
  currency: string,
  shopifyAccountId?: string, // optional: use different account for Shopify data (testing)
): Promise<string | null> {
  const dataAccountId = shopifyAccountId ?? accountId;
  const isEs = language === 'es';
  const brandProfile = await loadBrandProfile(dataAccountId);

  const brandBlock = brandProfile
    ? `Brand voice: ${brandProfile.brand_voice}\nBrand values: ${brandProfile.brand_values}\n`
    : '';

  let systemPrompt: string;
  let userPrompt: string;
  let actionType: string;

  switch (event.type) {
    case 'new_first_buyer': {
      const d = event.data as NewFirstBuyerData;
      actionType = 'welcome_email';
      systemPrompt = buildEventSystemPrompt(language, 'welcome_email');

      // Get also_bought recommendations
      const alsoBought = await getAlsoBought(dataAccountId, d.product_purchased);
      const alsoBoughtBlock = alsoBought.length > 0
        ? `\nAlso bought by customers who buy ${d.product_purchased}: ${alsoBought.join(', ')}`
        : '';

      userPrompt = `${brandBlock}Store: ${storeName}. Currency: ${currency}.

EVENT: New first-time buyer detected.
Customer: ${d.customer_name} (${d.customer_email})
Product purchased: ${d.product_purchased}
Order total: ${currency === 'EUR' ? '€' : '$'}${d.order_total.toFixed(2)}${alsoBoughtBlock}

Generate a welcome_email action.

CRITICAL RULES FOR WELCOME_EMAIL:
- This is a GENUINE THANK YOU, not a sales pitch.
- Thank them for choosing ${storeName}. Reinforce they made a good choice.
- Mention the specific product with a sensory detail ONLY if it appears in the product description or brand profile. If no description exists, just name the product.
- If also_bought data exists, recommend ONE product naturally — like a friend saying "if you liked this, you'll love...". Explain WHY based on flavor/texture contrast or complement.
- NEVER include a discount code. NEVER use sales CTAs like "compra", "pide", "haz tu pedido".
- NO "gracias por tu compra" generic opener. Be specific about WHAT they bought.
- Tone: like a WhatsApp message from a friend, personal and warm. NOT a marketing email.

Return JSON:
{
  "title": "<short title, 3-6 words>",
  "description": "<why this action + when to send>",
  "content": {
    "customer_email": "${d.customer_email}",
    "customer_name": "${d.customer_name}",
    "product_purchased": "${d.product_purchased}",
    "order_created_at": "${d.order_created_at}",
    "recommended_product": "<from also_bought if available>",
    "copy": "<the email body text>"
  }
}`;
      break;
    }

    case 'abandoned_cart': {
      const d = event.data as AbandonedCartData;
      actionType = 'cart_recovery';
      const productList = d.products.map(p => `${p.title} x${p.quantity} (${currency === 'EUR' ? '€' : '$'}${p.price})`).join(', ');

      // Get also_bought for the main cart product
      const mainProduct = d.products[0]?.title ?? '';
      const alsoBought = mainProduct ? await getAlsoBought(dataAccountId, mainProduct) : [];
      const alsoBoughtBlock = alsoBought.length > 0
        ? `\nOther products popular with ${mainProduct} buyers: ${alsoBought.join(', ')}`
        : '';

      systemPrompt = buildEventSystemPrompt(language, 'cart_recovery');
      userPrompt = `${brandBlock}Store: ${storeName}. Currency: ${currency}.

EVENT: Abandoned cart detected.
Customer: ${d.customer_name} (${d.customer_email})
Products left: ${productList}
Total value: ${currency === 'EUR' ? '€' : '$'}${d.total_value.toFixed(2)}
${d.checkout_url ? `Checkout URL: ${d.checkout_url}` : ''}${alsoBoughtBlock}

Generate a cart_recovery action.

CRITICAL RULES FOR CART_RECOVERY:
- Reinforce the VALUE of the product they chose. Why is it special? Ingredients, process, freshness.
- Make it easy: "your order is ready" / "we can have it fresh for you on Friday".
- Tone: relaxed, helpful. Like a shop assistant, not a salesperson.
- NEVER pressure: no "tu carrito te espera", no "completa tu pedido", no false urgency, no countdown.
- A small discount code is OK but optional — the focus is on product value, not price.
- Mention a sensory detail: how the product tastes, smells, looks, or feels.

Return JSON:
{
  "title": "<short title>",
  "description": "<why + when>",
  "content": {
    "customer_email": "${d.customer_email}",
    "customer_name": "${d.customer_name}",
    "products": ${JSON.stringify(d.products)},
    ${d.checkout_url ? `"checkout_url": "${d.checkout_url}",` : ''}
    "copy": "<the email body text>",
    "discount_code": "<optional>",
    "discount_value": "<optional>",
    "discount_type": "percentage"
  }
}`;
      break;
    }

    case 'overdue_customer': {
      const d = event.data as OverdueCustomerData;
      actionType = 'reactivation_email';

      // Get also_bought for their favorite product
      const alsoBought = d.last_product ? await getAlsoBought(dataAccountId, d.last_product) : [];
      const alsoBoughtBlock = alsoBought.length > 0
        ? `\nProducts popular with ${d.last_product} buyers: ${alsoBought.join(', ')}`
        : '';

      systemPrompt = buildEventSystemPrompt(language, 'reactivation_email');
      userPrompt = `${brandBlock}Store: ${storeName}. Currency: ${currency}.

EVENT: Overdue repeat customer detected.
Customer: ${d.customer_name} (${d.customer_email})
Favorite product: ${d.last_product}
Total lifetime spend: ${currency === 'EUR' ? '€' : '$'}${d.total_spent.toFixed(2)}${alsoBoughtBlock}

Generate a reactivation_email action.

CRITICAL RULES FOR REACTIVATION_EMAIL:
- Give them a REASON to come back: a new product, limited availability, their favorite is freshly made, a seasonal recommendation.
- Reference their favorite product with a specific detail (when it's baked, what ingredients, seasonal availability).
- If also_bought data exists, recommend something new based on their taste.
- NEVER say "te extrañamos", "te echamos de menos", "no te hemos visto", "hace X días que no vienes".
- NEVER guilt-trip or use nostalgia. NEVER mention how many days since their last purchase.
- Tone: like a friend texting "hey, thought of you — we just made this thing you'd love".
- A discount is OK if framed as a reason ("new recipe, first batch discount") but not required.

Return JSON:
{
  "title": "<short title>",
  "description": "<why + when>",
  "content": {
    "recipients": [{"email": "${d.customer_email}", "name": "${d.customer_name}", "last_product": "${d.last_product}"}],
    "copy": "<the email body text>",
    "discount_code": "<optional>",
    "discount_value": "<optional>",
    "discount_type": "percentage"
  }
}`;
      break;
    }
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      console.error(`${LOG} Empty response from LLM`);
      return null;
    }

    const action = JSON.parse(raw) as {
      title: string;
      description: string;
      content: Record<string, unknown>;
    };

    // Save to pending_actions
    const { data: saved, error } = await supabase
      .from('pending_actions')
      .insert({
        account_id: accountId,
        type: actionType,
        title: action.title,
        description: action.description,
        content: {
          ...action.content,
          priority: 'high',
          time_estimate: '5 min',
          plan_required: 'growth',
        },
        status: 'pending',
      })
      .select('id')
      .single();

    if (error || !saved) {
      console.error(`${LOG} Failed to save action: ${error?.message}`);
      return null;
    }

    // Link action to event in event_log
    await supabase
      .from('event_log')
      .update({ action_id: saved.id })
      .eq('account_id', accountId)
      .eq('event_key', event.key);

    const tokens = completion.usage?.total_tokens ?? 0;
    console.log(`${LOG} Generated ${actionType} action: "${action.title}" (${tokens} tokens)`);

    return saved.id;
  } catch (err) {
    console.error(`${LOG} Action generation failed: ${(err as Error).message}`);
    return null;
  }
}

// ── System prompt for event mode ──────────────────────────────────────────

function buildEventSystemPrompt(language: 'en' | 'es', actionType: string): string {
  const langRule = language === 'es'
    ? 'Write ALL text in Spanish. No English words.'
    : 'Write ALL text in English. No Spanish words.';

  const typeRules: Record<string, string> = {
    welcome_email: `
WELCOME_EMAIL RULES:
- This is a THANK YOU, not a sale. The customer already bought — reinforce their choice.
- Open with their name + the specific product they bought. Add a sensory detail (how it's made, what it tastes/smells/feels like).
- If a recommendation is provided, suggest it naturally: "si te gustó X, te va a encantar Y — tiene ese punto [flavor detail]".
- ABSOLUTELY NO discount codes. NO sales language. NO "compra", "pide", "haz tu pedido".
- NO generic openers: "Gracias por tu compra", "Bienvenido/a a [store]".
- Tone: like a baker who remembers your name and what you ordered.`,

    cart_recovery: `
CART_RECOVERY RULES:
- Apply PAS: their desire (the product) → sensory agitation (make them taste it) → easy solve (one step)
- Focus on PRODUCT VALUE: a specific ingredient, process, or detail ONLY from the Shopify product description or brand profile. NEVER invent details.
- NEVER pressure: no "tu carrito te espera", no "completa tu pedido", no "te espera", no "está lista para ti", no urgency, no countdown
- NEVER use vague praise: no "ingredientes frescos", no "hecho con cariño", no "preparada con amor"
- Use SPECIFICITY: "almendra marcona molida" not "ingredientes de calidad", "hornada del jueves" not "fresca para ti"
- The recommendation MUST be a different product category than the cart (tarta→cookie, chocolate→tarta, pan→tarta, etc.)
- Discount only if the store can actually create it. If unsure, omit.
- Tone: like a WhatsApp from a friend who owns the shop, NOT a marketing email.`,

    reactivation_email: `
REACTIVATION_EMAIL RULES:
- Give them a REASON to come back: new product/recipe, seasonal item, their favorite is freshly available, limited batch.
- Reference their favorite product with a real detail ONLY from the product description (baking day, ingredients, availability). If no description exists, just name the product.
- BANNED PHRASES (instant rejection): "te extrañamos", "te echamos de menos", "no te hemos visto", "hace X días que no vienes", "we miss you", "it's been X days", "haven't seen you".
- NEVER guilt-trip. NEVER mention how long since their last purchase. NEVER use nostalgia.
- Tone: like a WhatsApp from a friend — "oye, esta semana sacamos algo nuevo que te va a encantar".
- Discount only if framed as a reason (new recipe launch, first batch).`,
  };

  return `${langRule}

You generate a single email action for a specific customer event. You write copy on behalf of a small artisan store owner.

═══ COPYWRITING FRAMEWORKS (apply to every email) ═══

PAS (Problem-Agitate-Solve):
- Problem: the desire or need (the product they chose, the occasion)
- Agitate: a sensory detail that creates craving — taste, texture, aroma
- Solve: make it easy, not urgent — "solo tienes que pedirla", "¿te reservo una?"

CURIOSITY GAP (for subject lines / "title" field):
- Create an information gap. The reader should think "¿qué será?" and open.
- Formulas: "[Name], algo sobre [product] que no sabes" / "El ingrediente secreto de [product]" / "Lo que [product] y [unexpected thing] tienen en común"
- NEVER: "te espera", "está lista", "preparada para ti", "tu pedido", "tu carrito"

SPECIFICITY > VAGUENESS:
- "Almendra marcona molida" > "ingredientes frescos"
- "Hornada del jueves a las 7am" > "fresca para ti"
- "Chocolate belga al 70%" > "chocolate de calidad"
- "Se agota antes del sábado" > "producto popular"

SOCIAL PROOF (subtle, never fabricated):
- "Es la que más repiten los viernes" / "La favorita de los habituales" / "La que siempre se agota primero"

LOSS AVERSION (soft, never pressure):
- "El centro fundido que aún no probaste" > "completa tu pedido"
- "Solo la hacemos los viernes" > "oferta por tiempo limitado"

═══ EMAIL STRUCTURE ═══
1. HOOK: Name + product + unexpected detail (curiosity)
2. SENSORY: One concrete detail — taste, texture, aroma, ingredient origin
3. RECOMMENDATION: Product from a DIFFERENT category with WHY (flavor contrast/complement)
4. SOFT CTA: Easy next step, never urgent
- MAX 4 lines. 50-125 words total.

═══ VOICE RULE ═══
ALWAYS speak as the store team: "nosotros", "nuestro", "nos piden", "nuestro horno". NEVER as an outsider: "en [Store]", "los clientes de [Store]". You ARE the store.

═══ GLOBAL RULES ═══
0. NEVER INVENT SENSORY DETAILS: Only describe flavors, textures, aromas, or ingredients that are explicitly in the Shopify product description, the brand profile, or obviously implied by the product name. If NO product description exists → mention ONLY the product name without adjectives. Inventing "toque ácido" for a cheesecake tells customers the product is bad.
1. Use the customer's first name. Be specific about the product — never generic.
2. Include at least 1 sensory detail ONLY IF confirmed from product data (texture, taste, smell, visual, how it's made).
3. Max 1 exclamation mark in the ENTIRE copy. Max 1 emoji. Keep it short — 4 lines max.
4. If brand voice is provided, match it exactly.
5. If also_bought recommendations are provided, recommend ONE from a DIFFERENT CATEGORY — explain WHY based on flavor/texture contrast.
6. The recommended product MUST NOT be in the customer's cart or purchase. It must be from a different product category (if cart has a tarta → recommend a cookie/bizcocho/pan, NOT another tarta).

═══ BANNED PHRASES — instant rejection ═══
"un abrazo dulce", "explosión de sabor", "una experiencia única", "no te lo pierdas",
"te encantará", "descubre", "no te arrepentirás", "celebra con", "personaliza",
"haz tu pedido", "compra ya", "pide ahora", "¿ya pensaste en...?",
"no querrás perderte", "te transporta", "pura fantasía", "un clásico reinventado",
"te espera", "está lista para ti", "podemos prepararla fresca para el viernes",
"tu carrito", "completa tu pedido", "no dejes escapar",
any phrase with ¡...! that sounds like a TV commercial.

═══ AI COPY TELLS — also banned ═══
"ingredientes de calidad", "hecho con cariño", "productos artesanales" (vague),
"That being said", "It's worth noting", any sentence that would work for ANY bakery unchanged.

${buildCartRecoveryExamplesBlock()}

═══ EXAMPLES ═══
GOOD: "Alicia, la Tarta de Cumpleaños que pediste lleva mantequilla francesa y un bizcocho que se deshace. Si te gusta lo cremoso, la Tarta de Queso con compota de frutos rojos es la que más repiten nuestros clientes."
BAD: "¡Qué alegría que hayas elegido nuestra tarta! Cada bocado es un abrazo dulce. ¡No te lo pierdas! 🎂✨"
BAD: "La tenemos lista para ti y podemos prepararla fresca para el viernes." (template, vague)
${typeRules[actionType] ?? ''}

Action type: ${actionType}
Return ONLY valid JSON with title, description, and content fields.`;
}
