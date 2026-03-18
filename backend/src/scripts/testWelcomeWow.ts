/**
 * TEST: Welcome email with WOW effect for NICOLINA
 * Simulates orders/create webhook → generates GPT-4o copy → sends branded email
 * ONLY sends to tony@richmondpartner.com — never to real customers
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';
import { buildCustomCopyEmail } from '../services/emailTemplates.js';
import { sendMerchantEmail } from '../services/merchantEmail.js';
import { buildUnsubscribeUrl } from '../lib/unsubscribe.js';
import type { BrandConfig, ProductItem } from '../services/emailTemplates.js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

async function main() {
  // ── Load NICOLINA data ──────────────────────────────────────────────────
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('account_id, shop_name, shop_domain')
    .eq('shop_domain', 'taart-madrid.myshopify.com')
    .single();

  if (!conn) { console.error('NICOLINA not found'); return; }

  const { data: bp } = await supabase
    .from('brand_profiles')
    .select('logo_url, primary_color, shop_url, contact_email, contact_phone, contact_address, social_links')
    .eq('account_id', conn.account_id)
    .maybeSingle();

  const brand: BrandConfig = {
    storeName: conn.shop_name ?? 'NICOLINA',
    logoUrl: bp?.logo_url ?? undefined,
    primaryColor: bp?.primary_color ?? undefined,
    shopUrl: bp?.shop_url ?? `https://${conn.shop_domain}`,
    contactEmail: bp?.contact_email ?? undefined,
    contactPhone: bp?.contact_phone ?? undefined,
    contactAddress: bp?.contact_address ?? undefined,
    socialLinks: bp?.social_links as BrandConfig['socialLinks'] ?? undefined,
  };

  // ── Product data ────────────────────────────────────────────────────────
  const productPurchased = 'Tarta de Limón';
  const productDesc = 'El emblema de NICOLINA. Según los expertos, la mejor tarta de limón de la ciudad. 24cm de diámetro - 8/10 porciones. Contiene: proteína de la leche, huevo y frutos secos.';
  const productImageUrl = 'https://cdn.shopify.com/s/files/1/0594/9810/2954/files/NICOLINA_ENERO-204.jpg?v=1770841163';

  const recoProduct = 'Cookie con pepitas y nuez pecana';
  const recoDesc = 'Crujiente por fuera, tierna por dentro, con el toque tostado de la nuez pecana y pepitas de chocolate que se funden en cada bocado. Endulzadas con azúcar de coco. Sin gluten.';
  const recoImageUrl = 'https://cdn.shopify.com/s/files/1/0594/9810/2954/files/NICOLINA_ENERO-81.jpg?v=1770841235';
  const recoPrice = 3.80;
  const recoUrl = 'https://nicolina.es/products/cookie-con-pepitas-y-nuez-pecana';

  // ── Generate copy via GPT-4o ────────────────────────────────────────────
  console.log('Generating WOW welcome email copy via GPT-4o...');

  const systemPrompt = `You are the copywriter for NICOLINA, an artisan gluten-free bakery in Madrid.
Write ALL text in Spanish. No English words.

You're writing a welcome email for a FIRST-TIME buyer. This is NOT a generic "thanks for your order".
This email must make the customer feel like they just joined something special.

STRUCTURE (follow exactly):
1. GREETING: Personal, brief. Use their first name + the specific product. 1-2 sentences max.
2. SECRET/TIP: Share something useful about the product they bought that's NOT on the website.
   For tartas: ideal serving temperature, what to pair it with (drink, time of day), how to store leftovers.
   For pan: how to toast it, what to spread on it, how to keep it fresh.
   For cookies: how to keep them crispy, best moment to enjoy them.
   This should feel like insider knowledge from the baker herself.
3. RECOMMENDATION: "Si te gusta [product], también te va a gustar [recommended product]" — explain WHY based on flavor contrast or complement. Be specific about the recommended product's texture/taste.
4. SIGN-OFF: Warm, short. From "Andrea y el equipo de NICOLINA".

RULES:
- NO discount, NO sales pitch, NO "vuelve pronto", NO CTA to buy.
- NO "gracias por tu compra" (generic). Be specific about WHAT they bought.
- NO banned phrases: "abrazo dulce", "explosión de sabor", "experiencia única", "no te lo pierdas"
- NO invented sensory details — only from product descriptions provided.
- Max 1 exclamation mark total. Max 1 emoji total.
- Tone: like a WhatsApp from Andrea (the owner) to a friend.
- Keep it to 80-120 words. 4-5 short paragraphs.

Return JSON:
{
  "subject": "<email subject line — curiosity-driven, NOT generic>",
  "body": "<the email body as plain text with line breaks>"
}`;

  const userPrompt = `Customer: Tony (tony@richmondpartner.com)
Product purchased: ${productPurchased} (€35.90)
Product description: ${productDesc}
Store: NICOLINA (pastelería sin gluten, sin azúcar, sin lactosa en Madrid)
Brand values: Inclusivity, health-conscious indulgence, artisanal craftsmanship

Recommended product: ${recoProduct}
Recommended product description: ${recoDesc}
Recommended product price: €${recoPrice}

Generate the welcome email.`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.8,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) { console.error('Empty LLM response'); return; }

  const { subject, body } = JSON.parse(raw) as { subject: string; body: string };
  console.log('\n=== GENERATED COPY ===');
  console.log('Subject:', subject);
  console.log('Body:\n', body);
  console.log(`Tokens: ${completion.usage?.total_tokens ?? '?'}`);

  // ── Build email HTML ────────────────────────────────────────────────────
  const recipientEmail = 'tony@richmondpartner.com';
  const unsubscribeUrl = buildUnsubscribeUrl(conn.account_id, recipientEmail);

  const recoItem: ProductItem = {
    title: recoProduct,
    quantity: 1,
    price: recoPrice,
    image_url: recoImageUrl,
    product_url: recoUrl,
  };

  // Use buildCustomCopyEmail with the product image as hero + recommendation
  const { html } = buildCustomCopyEmail({
    storeName: conn.shop_name ?? 'NICOLINA',
    subject,
    body,
    ctaText: 'Ver la tienda',
    ctaUrl: 'https://nicolina.es',
    products: [recoItem],
    brand,
    unsubscribeUrl,
  });

  // ── Send ────────────────────────────────────────────────────────────────
  console.log(`\nSending to ${recipientEmail}...`);
  const { messageId } = await sendMerchantEmail({
    accountId: conn.account_id,
    to: recipientEmail,
    subject,
    html,
    unsubscribeUrl,
  });

  console.log(`Sent! Message ID: ${messageId}`);
  console.log('\nCheck your inbox for the WOW welcome email.');
}

main().catch(e => { console.error(e); process.exit(1); });
