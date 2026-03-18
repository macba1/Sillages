import 'dotenv/config';
import { resend } from '../lib/resend.js';
import { supabase } from '../lib/supabase.js';
import { buildCustomCopyEmail } from '../services/emailTemplates.js';
import type { BrandConfig, ProductItem } from '../services/emailTemplates.js';
import { shopifyClient } from '../lib/shopify.js';

const TONY_EMAIL = 'tony@richmondpartner.com';
const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

// NICOLINA brand config
const NICOLINA_LOGO = 'https://nicolina.es/cdn/shop/files/Logo-NICOLINA-sin_marco_bafd65b0-74df-4d6e-beb0-901d1ad206ae_170x.png?v=1720607162';
const NICOLINA_COLOR = '#c0dcb0';
const NICOLINA_SHOP_URL = 'https://nicolina.es';

async function main() {
  const brand: BrandConfig = {
    storeName: 'NICOLINA',
    logoUrl: NICOLINA_LOGO,
    primaryColor: NICOLINA_COLOR,
    shopUrl: NICOLINA_SHOP_URL,
  };

  // 1. Get Anna's actual action data
  const { data: action } = await supabase
    .from('pending_actions')
    .select('content, title')
    .eq('type', 'cart_recovery')
    .eq('status', 'completed')
    .filter('result->>message_id', 'eq', '14ce5e02-5acd-4cef-b146-45a539dc9310')
    .single();

  if (!action) {
    console.error('Anna action not found');
    return;
  }

  const content = action.content as Record<string, unknown>;
  const customerName = content.customer_name as string;
  const customCopy = content.copy as string;
  const customTitle = content.title as string | undefined ?? action.title;

  // Products is a string like "DONA KINDER, DONA PEANUT REESE, ..."
  const productNames = typeof content.products === 'string'
    ? content.products.split(',').map(s => s.trim())
    : [];

  console.log(`Customer: ${customerName}`);
  console.log(`Products: ${productNames.join(', ')}`);
  console.log(`Copy: ${customCopy.slice(0, 100)}...`);

  // 2. Fetch product images from Shopify
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token')
    .eq('account_id', ANDREA_ID)
    .single();

  const enrichedProducts: ProductItem[] = [];

  if (conn) {
    const client = shopifyClient(conn.shop_domain, conn.access_token);
    const shopifyProducts = await client.getProducts({ limit: 50, fields: 'id,title,images,variants' });

    // Build title → image map (fuzzy match)
    const imageByTitle = new Map<string, { src: string; price: number }>();
    for (const p of shopifyProducts) {
      const title = (p.title as string).toUpperCase();
      const images = p.images as Array<{ src: string }> | undefined;
      const variants = p.variants as Array<{ price: string }> | undefined;
      const price = variants?.[0]?.price ? parseFloat(variants[0].price) : 0;
      if (images?.[0]?.src) {
        imageByTitle.set(title, { src: images[0].src, price });
      }
    }

    // Match cart products to Shopify catalog
    for (const name of productNames) {
      const upper = name.toUpperCase();
      // Try exact match first, then partial match
      let match = imageByTitle.get(upper);
      if (!match) {
        for (const [title, data] of imageByTitle) {
          if (title.includes(upper) || upper.includes(title)) {
            match = data;
            break;
          }
        }
      }

      enrichedProducts.push({
        title: name,
        quantity: 1,
        price: match?.price ?? 5.50,
        image_url: match?.src,
      });
    }

    console.log(`\nEnriched ${enrichedProducts.filter(p => p.image_url).length}/${enrichedProducts.length} products with images`);
    for (const p of enrichedProducts) {
      console.log(`  ${p.title}: ${p.image_url ? 'has image' : 'NO IMAGE'} — €${p.price}`);
    }
  }

  // 3. Build the branded email
  const { subject, html } = buildCustomCopyEmail({
    storeName: 'NICOLINA',
    subject: customTitle ?? `${customerName}, tienes algo pendiente`,
    body: customCopy,
    ctaText: 'Completar mi pedido',
    ctaUrl: NICOLINA_SHOP_URL,
    products: enrichedProducts.length > 0 ? enrichedProducts : undefined,
    brand,
  });

  console.log(`\n=== EMAIL BUILT ===`);
  console.log(`Subject: ${subject}`);
  console.log(`HTML length: ${html.length} chars`);

  // 4. Send to Tony
  console.log(`\n=== SENDING TO ${TONY_EMAIL} ===`);
  const { data: sent, error } = await resend.emails.send({
    from: 'NICOLINA <nicolina@sillages.app>',
    to: TONY_EMAIL,
    subject: `[BRANDED v2] ${subject}`,
    html,
  });

  if (error) {
    console.error('Send error:', error);
  } else {
    console.log(`Sent to ${TONY_EMAIL} — message ID: ${sent?.id}`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
