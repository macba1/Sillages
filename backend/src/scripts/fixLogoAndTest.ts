import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { resend } from '../lib/resend.js';
import { shopifyClient } from '../lib/shopify.js';
import { buildCustomCopyEmail } from '../services/emailTemplates.js';
import type { BrandConfig, ProductItem } from '../services/emailTemplates.js';

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';
const TO = 'tony@richmondpartner.com';

function fuzzyMatch(name: string, catalog: Map<string, { src: string; price: number }>): { src: string; price: number } | undefined {
  const lower = name.toLowerCase().trim();
  const exact = catalog.get(lower);
  if (exact) return exact;
  for (const [k, v] of catalog) { if (lower.includes(k) || k.includes(lower)) return v; }
  const words = lower.split(/\s+/);
  for (const [k, v] of catalog) { if (words.filter(w => k.split(/\s+/).includes(w)).length >= 2) return v; }
  return undefined;
}

async function main() {
  // 1. Load brand config from DB
  const [{ data: bp }, { data: conn }] = await Promise.all([
    supabase.from('brand_profiles')
      .select('logo_url, primary_color, shop_url, contact_email, contact_phone, contact_address, social_links')
      .eq('account_id', ANDREA_ID).single(),
    supabase.from('shopify_connections')
      .select('shop_domain, access_token, shop_name').eq('account_id', ANDREA_ID).single(),
  ]);

  console.log(`Logo URL in DB: ${bp?.logo_url}`);

  const brand: BrandConfig = {
    storeName: conn?.shop_name ?? 'NICOLINA',
    logoUrl: bp?.logo_url ?? undefined,
    primaryColor: bp?.primary_color ?? undefined,
    shopUrl: bp?.shop_url ?? undefined,
    contactEmail: bp?.contact_email ?? undefined,
    contactPhone: bp?.contact_phone ?? undefined,
    contactAddress: bp?.contact_address ?? undefined,
    socialLinks: bp?.social_links as BrandConfig['socialLinks'] ?? undefined,
  };

  // 2. Fetch product images from Shopify (same as production executeCartRecovery)
  const imageByTitle = new Map<string, { src: string; price: number }>();
  if (conn) {
    const client = shopifyClient(conn.shop_domain, conn.access_token);
    const products = await client.getProducts({ limit: 250, fields: 'id,title,images,variants' });
    for (const p of products) {
      const title = (p.title as string).toLowerCase();
      const images = p.images as Array<{ src: string }> | undefined;
      const variants = p.variants as Array<{ price: string }> | undefined;
      if (images?.[0]?.src) {
        imageByTitle.set(title, { src: images[0].src, price: variants?.[0]?.price ? parseFloat(variants[0].price) : 0 });
      }
    }
    console.log(`Loaded ${imageByTitle.size} products from Shopify catalog`);
  }

  // 3. Enrich products with images (fuzzy match)
  const productNames = ['TARTA DE QUESO', 'DONA KINDER'];
  const enrichedProducts: ProductItem[] = productNames.map(name => {
    const match = fuzzyMatch(name, imageByTitle);
    console.log(`  ${name}: ${match ? `✅ ${match.src.substring(0, 80)}...` : '❌ NO MATCH'}`);
    return { title: name, quantity: 1, price: match?.price ?? 0, image_url: match?.src };
  });

  // 4. Verify product image URLs are accessible
  console.log('\n=== PRODUCT IMAGE URL CHECK ===');
  for (const p of enrichedProducts) {
    if (p.image_url) {
      const resp = await fetch(p.image_url, { method: 'HEAD' });
      console.log(`  ${p.title}: HTTP ${resp.status} (${resp.headers.get('content-type')})`);
    } else {
      console.log(`  ${p.title}: NO IMAGE URL`);
    }
  }

  // 5. Build email with CUSTOM COPY (not generic template)
  const customCopy = `Hola Tony,\n\nVi que dejaste la Tarta de Queso y las Donas Kinder en tu carrito. ¡Son de nuestros favoritos!\n\nLa Tarta de Queso la hacemos con queso crema artesanal y tiene una textura que no vas a encontrar en ningún otro sitio. Y las Donas Kinder... bueno, son pura fantasía.\n\nTu pedido sigue guardado, pero no puedo garantizar stock mucho más tiempo.\n\n¿Te lo mando?`;

  const { subject, html } = buildCustomCopyEmail({
    storeName: 'NICOLINA',
    subject: 'Tony, tus dulces favoritos te esperan',
    body: customCopy,
    ctaText: 'Completar mi pedido',
    ctaUrl: 'https://nicolina.es',
    products: enrichedProducts,
    brand,
  });

  // 6. Verify HTML
  const imgMatch = html.match(/<img src="([^"]+)" alt="NICOLINA"/);
  console.log(`\n=== FINAL HTML CHECKS ===`);
  console.log(`  Logo in HTML: ${imgMatch?.[1]?.substring(0, 80) ?? 'NONE'}`);
  console.log(`  Has custom copy: ${html.includes('pura fantasía')}`);
  console.log(`  Has product images: ${enrichedProducts.filter(p => p.image_url).length}/${enrichedProducts.length}`);
  console.log(`  Has height:auto: ${html.includes('height:auto')}`);

  // 7. Send
  const { data, error } = await resend.emails.send({
    from: 'NICOLINA <nicolina@sillages.app>',
    to: TO,
    reply_to: bp?.contact_email ?? 'info@nicolina.es',
    subject: `[FINAL TEST] ${subject}`,
    html,
  });

  if (error) { console.error('SEND ERROR:', error); return; }

  console.log(`\n✅ Email sent to ${TO}`);
  console.log(`   Message ID: ${data?.id}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
