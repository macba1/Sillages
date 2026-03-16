import 'dotenv/config';
import { openai } from '../lib/openai.js';
import { supabase } from '../lib/supabase.js';
import { shopifyClient } from '../lib/shopify.js';
import { loadBrandProfile } from '../services/brandAnalyzer.js';

/**
 * Generate Father's Day (March 19 - San José) actions for NICOLINA.
 * Uses real product data to create relevant, timely actions.
 */

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

async function main() {
  // Load everything we need
  const [{ data: acc }, { data: conn }] = await Promise.all([
    supabase.from('accounts').select('id, language, full_name').eq('id', ANDREA_ID).single(),
    supabase.from('shopify_connections').select('shop_domain, access_token, shop_name, shop_currency').eq('account_id', ANDREA_ID).single(),
  ]);

  if (!acc || !conn) { console.error('Account/connection not found'); process.exit(1); }

  const brandProfile = await loadBrandProfile(ANDREA_ID);
  const client = shopifyClient(conn.shop_domain, conn.access_token);

  // Get real product catalog
  const products = await client.getProducts();
  const productNames = products.map(p => p.title).join(', ');

  // Get top sellers from store_history
  const { data: hist } = await supabase.from('store_history').select('top_products_alltime').eq('account_id', ANDREA_ID).maybeSingle();
  const topProducts = (hist?.top_products_alltime as any[])?.slice(0, 10).map(p => `${p.title} (€${p.revenue})`) ?? [];

  // Get abandoned carts for context
  const { data: carts } = await supabase.from('abandoned_carts').select('customer_name, customer_email, products, total_price').eq('account_id', ANDREA_ID).order('abandoned_at', { ascending: false }).limit(5);

  const brandBlock = brandProfile
    ? `Brand voice: ${brandProfile.brand_voice}\nBrand values: ${brandProfile.brand_values}\n`
    : '';

  console.log('Products:', productNames.slice(0, 200), '...');
  console.log('Top sellers:', topProducts.slice(0, 5).join(' | '));
  console.log('Abandoned carts:', carts?.length ?? 0);
  console.log('');

  const systemPrompt = `Eres el growth hacker de NICOLINA, una pastelería artesanal en Madrid que hace tartas, hogazas y repostería sin gluten y sin azúcar añadido. Todo se hornea a mano.

El Día del Padre (San José, 19 de marzo) es el MIÉRCOLES — faltan 3 días.

${brandBlock}

REGLAS ESTRICTAS:
1. Cada acción DEBE mencionar productos reales del catálogo.
2. Copy sensorial: textura, sabor, aroma, proceso. Nada genérico.
3. PROHIBIDO: "¡No te lo pierdas!", "Haz tu pedido", "te encantará", "un abrazo dulce", "explosión de sabor", frases de anuncio de TV.
4. Máximo 1 signo de exclamación por copy. Máximo 1 emoji.
5. Tono: como una amiga que tiene pastelería y te dice qué pedir para tu padre.
6. Los descuentos deben tener un código memorable y motivo claro.
7. Instagram: máximo 3 líneas. Hook → sensorial → CTA suave.
8. Escribe TODO en español.

TIPOS DE ACCIÓN DISPONIBLES:
- instagram_post: content.copy, content.visual_concept, content.hashtags
- discount_code: content.code, content.discount_value, content.discount_type, content.products, content.copy
- product_highlight: content.product, content.copy, content.placement
- whatsapp_message: content.copy, content.target_audience

Genera exactamente 4 acciones para el Día del Padre. Usa datos reales del catálogo.

Devuelve JSON:
{
  "actions": [
    {
      "type": "<tipo>",
      "title": "<título corto 3-6 palabras>",
      "description": "<por qué esta acción + cuándo ejecutar>",
      "content": { ... }
    }
  ]
}`;

  const userPrompt = `CATÁLOGO REAL DE NICOLINA:
${productNames}

TOP SELLERS (últimos 3 meses):
${topProducts.join('\n')}

CARRITOS ABANDONADOS RECIENTES:
${carts?.map(c => `${c.customer_name}: ${(c.products as any[])?.map((p: any) => p.title).join(', ')} — €${c.total_price}`).join('\n') ?? 'ninguno'}

Genera 4 acciones para el Día del Padre (19 marzo, miércoles, en 3 días).`;

  console.log('Generating Father\'s Day actions with gpt-4o...\n');

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
  if (!raw) { console.error('Empty response'); process.exit(1); }

  const result = JSON.parse(raw) as { actions: Array<{ type: string; title: string; description: string; content: Record<string, unknown> }> };

  console.log(`Generated ${result.actions.length} actions (${completion.usage?.total_tokens} tokens)\n`);

  // Save to Andrea's pending_actions
  for (const action of result.actions) {
    const { data: saved, error } = await supabase
      .from('pending_actions')
      .insert({
        account_id: ANDREA_ID,
        type: action.type,
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

    if (error) {
      console.error(`Failed to save: ${error.message}`);
      continue;
    }

    console.log('═'.repeat(60));
    console.log(`TYPE: ${action.type}`);
    console.log(`TITLE: ${action.title}`);
    console.log(`ID: ${saved.id}`);
    console.log('─'.repeat(60));
    console.log(`DESCRIPTION: ${action.description}`);

    const c = action.content;
    if (c.copy) console.log(`COPY: ${c.copy}`);
    if (c.visual_concept) console.log(`VISUAL: ${c.visual_concept}`);
    if (c.hashtags) console.log(`HASHTAGS: ${c.hashtags}`);
    if (c.code) console.log(`CODE: ${c.code} — ${c.discount_value}${c.discount_type === 'percentage' ? '%' : '€'}`);
    if (c.product) console.log(`PRODUCT: ${c.product}`);
    if (c.target_audience) console.log(`TARGET: ${c.target_audience}`);
    console.log('');
  }

  // Send push notification about Father's Day actions
  const { sendPushNotification } = await import('../services/pushNotifier.js');
  await sendPushNotification(ANDREA_ID, {
    title: 'NICOLINA',
    body: `Día del Padre es el miércoles. Tienes ${result.actions.length} acciones preparadas.`,
    url: '/actions',
  });
  console.log('Push notification sent to Andrea about Father\'s Day actions');
}

main().catch(e => { console.error(e); process.exit(1); });
