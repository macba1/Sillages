import 'dotenv/config';
import { resend } from '../lib/resend.js';
import { supabase } from '../lib/supabase.js';
import { buildCustomCopyEmail } from '../services/emailTemplates.js';
import type { BrandConfig, ProductItem } from '../services/emailTemplates.js';
import { shopifyClient } from '../lib/shopify.js';

const TONY_EMAIL = 'tony@richmondpartner.com';
const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';
const FROM = 'NICOLINA <nicolina@sillages.app>';

const BRAND: BrandConfig = {
  storeName: 'NICOLINA',
  logoUrl: 'https://nicolina.es/cdn/shop/files/Logo-NICOLINA-sin_marco_bafd65b0-74df-4d6e-beb0-901d1ad206ae_170x.png?v=1720607162',
  primaryColor: '#c0dcb0',
  shopUrl: 'https://nicolina.es',
  contactPhone: '611 34 20 73',
  contactAddress: 'C/ Potosí 4 · C/ Conde de Peñalver 18 · Madrid',
  socialLinks: { instagram: 'https://www.instagram.com/nicolinamadrid/' },
};

/**
 * Fuzzy match a cart product name to a Shopify catalog product.
 * Handles cases like "DONA PEANUT REESE" matching "Dona peanut".
 */
function fuzzyMatchProduct(
  cartName: string,
  catalog: Map<string, { src: string; price: number }>,
): { src: string; price: number } | undefined {
  const lower = cartName.toLowerCase().trim();

  // 1. Exact match
  const exact = catalog.get(lower);
  if (exact) return exact;

  // 2. Cart name contains catalog name, or catalog name contains cart name
  for (const [catalogName, data] of catalog) {
    if (lower.includes(catalogName) || catalogName.includes(lower)) {
      return data;
    }
  }

  // 3. Word overlap — at least 2 words in common
  const cartWords = lower.split(/\s+/);
  for (const [catalogName, data] of catalog) {
    const catalogWords = catalogName.split(/\s+/);
    const overlap = cartWords.filter(w => catalogWords.includes(w)).length;
    if (overlap >= 2) return data;
  }

  return undefined;
}

async function main() {
  // Fetch product images from Shopify
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token')
    .eq('account_id', ANDREA_ID)
    .single();

  const imageByTitle = new Map<string, { src: string; price: number }>();

  if (conn) {
    const client = shopifyClient(conn.shop_domain, conn.access_token);
    const shopifyProducts = await client.getProducts({ limit: 50, fields: 'id,title,images,variants' });

    for (const p of shopifyProducts) {
      const title = (p.title as string).toLowerCase();
      const images = p.images as Array<{ src: string }> | undefined;
      const variants = p.variants as Array<{ price: string }> | undefined;
      const price = variants?.[0]?.price ? parseFloat(variants[0].price) : 0;
      if (images?.[0]?.src) {
        imageByTitle.set(title, { src: images[0].src, price });
      }
    }
    console.log(`Loaded ${imageByTitle.size} products from Shopify`);
  }

  // Get Anna's action
  const { data: action } = await supabase
    .from('pending_actions')
    .select('content, title')
    .eq('type', 'cart_recovery')
    .eq('status', 'completed')
    .filter('result->>message_id', 'eq', '14ce5e02-5acd-4cef-b146-45a539dc9310')
    .single();

  if (!action) { console.error('Action not found'); return; }

  const content = action.content as Record<string, unknown>;
  const customCopy = content.copy as string;
  const customTitle = content.title as string | undefined ?? action.title;

  const productNames = typeof content.products === 'string'
    ? content.products.split(',').map(s => s.trim())
    : [];

  const enrichedProducts: ProductItem[] = productNames.map(name => {
    const match = fuzzyMatchProduct(name, imageByTitle);
    console.log(`  "${name}" → ${match ? 'MATCHED' : 'NO MATCH'}${match ? ` (€${match.price})` : ''}`);
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

  console.log(`\nSubject: ${subject}`);
  console.log(`All products have images: ${enrichedProducts.every(p => p.image_url)}`);

  const { data: sent, error } = await resend.emails.send({
    from: FROM, to: TONY_EMAIL,
    subject: `[FINAL] ${subject}`,
    html,
  });

  if (error) console.error('Error:', error);
  else console.log(`Sent: ${sent?.id}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
