import { openai } from '../lib/openai.js';
import { supabase } from '../lib/supabase.js';
import { loadBrandProfile } from './brandAnalyzer.js';
import type { DetectedEvent, NewFirstBuyerData, AbandonedCartData, OverdueCustomerData } from './eventDetector.js';

const LOG = '[eventAction]';

// ── Generate a single action for a detected event ──────────────────────────

export async function generateEventAction(
  accountId: string,
  event: DetectedEvent,
  language: 'en' | 'es',
  storeName: string,
  currency: string,
): Promise<string | null> {
  const isEs = language === 'es';
  const brandProfile = await loadBrandProfile(accountId);

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
      userPrompt = `${brandBlock}Store: ${storeName}. Currency: ${currency}.

EVENT: New first-time buyer detected.
Customer: ${d.customer_name} (${d.customer_email})
Product purchased: ${d.product_purchased}
Order total: ${currency === 'EUR' ? '€' : '$'}${d.order_total.toFixed(2)}

Generate a welcome_email action. The email should thank them warmly for their first purchase, mention the specific product they bought, and invite them to come back. Match the brand voice.

Return JSON:
{
  "title": "<short title, 3-6 words>",
  "description": "<why this action + when to send>",
  "content": {
    "customer_email": "${d.customer_email}",
    "customer_name": "${d.customer_name}",
    "product_purchased": "${d.product_purchased}",
    "copy": "<the email body text, warm and personal>"
  }
}`;
      break;
    }

    case 'abandoned_cart': {
      const d = event.data as AbandonedCartData;
      actionType = 'cart_recovery';
      const productList = d.products.map(p => `${p.title} x${p.quantity} (${currency === 'EUR' ? '€' : '$'}${p.price})`).join(', ');
      systemPrompt = buildEventSystemPrompt(language, 'cart_recovery');
      userPrompt = `${brandBlock}Store: ${storeName}. Currency: ${currency}.

EVENT: Abandoned cart detected.
Customer: ${d.customer_name} (${d.customer_email})
Products left: ${productList}
Total value: ${currency === 'EUR' ? '€' : '$'}${d.total_value.toFixed(2)}
${d.checkout_url ? `Checkout URL: ${d.checkout_url}` : ''}

Generate a cart_recovery action. The email should remind them of what they left behind, use sensory details about the products, and have a soft CTA. Optionally include a small discount code.

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
    "discount_code": "<optional code like VUELVE10>",
    "discount_value": "<optional, like 10%>",
    "discount_type": "percentage"
  }
}`;
      break;
    }

    case 'overdue_customer': {
      const d = event.data as OverdueCustomerData;
      actionType = 'reactivation_email';
      systemPrompt = buildEventSystemPrompt(language, 'reactivation_email');
      userPrompt = `${brandBlock}Store: ${storeName}. Currency: ${currency}.

EVENT: Overdue repeat customer detected.
Customer: ${d.customer_name} (${d.customer_email})
Last product: ${d.last_product}
Days since last purchase: ${d.days_since}
Usual purchase cycle: ${d.usual_cycle_days} days
Total lifetime spend: ${currency === 'EUR' ? '€' : '$'}${d.total_spent.toFixed(2)}

Generate a reactivation_email action. The email should feel personal — reference their last product, how long it's been, and gently invite them back. Optionally include a discount.

Return JSON:
{
  "title": "<short title>",
  "description": "<why + when>",
  "content": {
    "recipients": [{"email": "${d.customer_email}", "name": "${d.customer_name}", "last_product": "${d.last_product}", "days_since": ${d.days_since}}],
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
      model: 'gpt-4o-mini',
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

  return `${langRule}

You generate a single email action for a specific customer event. You are writing copy on behalf of a small store owner.

RULES:
1. Be warm, personal, specific. Use the customer's name and the product they bought/left behind.
2. Include at least 1 sensory detail about the product (texture, taste, smell, visual).
3. NO generic phrases: "¡No te lo pierdas!", "¡Compra ya!", "Una experiencia única".
4. Soft CTA only: "¿Te lo guardamos?", "Solo tienes que completar tu pedido", link to store.
5. Max 1 exclamation mark. Max 2 emojis. Keep it short — 3-5 sentences.
6. If the brand voice is provided, match it exactly.

Action type: ${actionType}
Return ONLY valid JSON with title, description, and content fields.`;
}
