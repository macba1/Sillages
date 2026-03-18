import 'dotenv/config';
import { resend } from '../lib/resend.js';
import { supabase } from '../lib/supabase.js';
import { buildCustomCopyEmail, buildWelcomeEmail, buildReactivationEmail } from '../services/emailTemplates.js';
import type { BrandConfig, ProductItem } from '../services/emailTemplates.js';
import { shopifyClient } from '../lib/shopify.js';

const TONY_EMAIL = 'tony@richmondpartner.com';
const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';
const FROM = 'NICOLINA <nicolina@sillages.app>';

// NICOLINA brand config (scraped from nicolina.es)
const BRAND: BrandConfig = {
  storeName: 'NICOLINA',
  logoUrl: 'https://nicolina.es/cdn/shop/files/Logo-NICOLINA-sin_marco_bafd65b0-74df-4d6e-beb0-901d1ad206ae_170x.png?v=1720607162',
  primaryColor: '#c0dcb0',
  shopUrl: 'https://nicolina.es',
  contactPhone: '611 34 20 73',
  contactAddress: 'C/ Potosí 4 · C/ Conde de Peñalver 18 · Madrid',
  socialLinks: { instagram: 'https://www.instagram.com/nicolinamadrid/' },
};

async function main() {
  // 1. Fetch product images from Shopify
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token')
    .eq('account_id', ANDREA_ID)
    .single();

  const imageByTitle = new Map<string, { src: string; price: number }>();
  let allProductData: Array<{ title: string; src: string; price: number }> = [];

  if (conn) {
    const client = shopifyClient(conn.shop_domain, conn.access_token);
    const shopifyProducts = await client.getProducts({ limit: 50, fields: 'id,title,images,variants' });

    for (const p of shopifyProducts) {
      const title = p.title as string;
      const images = p.images as Array<{ src: string }> | undefined;
      const variants = p.variants as Array<{ price: string }> | undefined;
      const price = variants?.[0]?.price ? parseFloat(variants[0].price) : 0;
      if (title && images?.[0]?.src) {
        imageByTitle.set(title.toLowerCase(), { src: images[0].src, price });
        allProductData.push({ title, src: images[0].src, price });
      }
    }
    console.log(`Loaded ${imageByTitle.size} products with images from Shopify`);
  }

  // ─────────────────────────────────────────────────
  // EMAIL 1: CART RECOVERY (Anna's real data)
  // ─────────────────────────────────────────────────
  console.log('\n=== EMAIL 1: CART RECOVERY ===');
  const { data: action } = await supabase
    .from('pending_actions')
    .select('content, title')
    .eq('type', 'cart_recovery')
    .eq('status', 'completed')
    .filter('result->>message_id', 'eq', '14ce5e02-5acd-4cef-b146-45a539dc9310')
    .single();

  if (action) {
    const content = action.content as Record<string, unknown>;
    const customCopy = content.copy as string;
    const customTitle = content.title as string | undefined ?? action.title;

    // Parse product names from string
    const productNames = typeof content.products === 'string'
      ? content.products.split(',').map(s => s.trim())
      : [];

    const enrichedProducts: ProductItem[] = productNames.map(name => {
      const match = imageByTitle.get(name.toLowerCase());
      return { title: name, quantity: 1, price: match?.price ?? 5.50, image_url: match?.src };
    });

    const { subject, html } = buildCustomCopyEmail({
      storeName: 'NICOLINA',
      subject: customTitle ?? 'Anna, cuatro donas sin gluten',
      body: customCopy,
      ctaText: 'Completar mi pedido',
      ctaUrl: 'https://nicolina.es',
      products: enrichedProducts,
      brand: BRAND,
    });

    const { data: sent } = await resend.emails.send({ from: FROM, to: TONY_EMAIL, subject: `[1/3 Cart Recovery] ${subject}`, html });
    console.log(`Sent: ${sent?.id}`);
  } else {
    console.log('Anna action not found — skipping');
  }

  // ─────────────────────────────────────────────────
  // EMAIL 2: WELCOME EMAIL (simulated first purchase)
  // ─────────────────────────────────────────────────
  console.log('\n=== EMAIL 2: WELCOME EMAIL ===');

  // Pick a real product for the welcome email
  const welcomeProduct = allProductData.find(p => p.title.toLowerCase().includes('dona')) ?? allProductData[0];
  // Pick a different product for recommendation
  const recoProduct = allProductData.find(p => p.title !== welcomeProduct?.title && p.price > 0) ?? allProductData[1];

  if (welcomeProduct) {
    const { subject, html } = buildWelcomeEmail({
      customerName: 'Laura',
      storeName: 'NICOLINA',
      productPurchased: welcomeProduct.title,
      productImageUrl: welcomeProduct.src,
      language: 'es',
      storeUrl: 'https://nicolina.es',
      brand: BRAND,
      recommendation: recoProduct ? {
        title: recoProduct.title,
        imageUrl: recoProduct.src,
        price: recoProduct.price,
        currency: 'EUR',
        productUrl: 'https://nicolina.es',
      } : undefined,
    });

    const { data: sent } = await resend.emails.send({ from: FROM, to: TONY_EMAIL, subject: `[2/3 Welcome] ${subject}`, html });
    console.log(`Sent: ${sent?.id}`);
  }

  // ─────────────────────────────────────────────────
  // EMAIL 3: REACTIVATION EMAIL (simulated overdue)
  // ─────────────────────────────────────────────────
  console.log('\n=== EMAIL 3: REACTIVATION EMAIL ===');

  const reactivationProduct = allProductData.find(p => p.title.toLowerCase().includes('brownie')) ?? allProductData[2] ?? allProductData[0];

  if (reactivationProduct) {
    const { subject, html } = buildReactivationEmail({
      customerName: 'Sergio',
      storeName: 'NICOLINA',
      lastProduct: reactivationProduct.title,
      lastProductImageUrl: reactivationProduct.src,
      daysSinceLastPurchase: 23,
      discountCode: 'VUELVE10',
      discountPercent: 10,
      language: 'es',
      storeUrl: 'https://nicolina.es',
      brand: BRAND,
    });

    const { data: sent } = await resend.emails.send({ from: FROM, to: TONY_EMAIL, subject: `[3/3 Reactivation] ${subject}`, html });
    console.log(`Sent: ${sent?.id}`);
  }

  console.log('\nDone! Check tony@richmondpartner.com for 3 emails.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
