import 'dotenv/config';
import { resend } from '../lib/resend.js';
import { supabase } from '../lib/supabase.js';
import { buildCustomCopyEmail } from '../services/emailTemplates.js';
import type { BrandConfig, ProductItem } from '../services/emailTemplates.js';
import { shopifyClient } from '../lib/shopify.js';

const TONY_EMAIL = 'tony@richmondpartner.com';
const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';
const FROM = 'NICOLINA <nicolina@sillages.app>';

// NICOLINA brand — dark logo on white, no tagline
const BRAND: BrandConfig = {
  storeName: 'NICOLINA',
  logoUrl: 'https://nicolina.es/cdn/shop/files/Logo-NICOLINA-sin_marco_bafd65b0-74df-4d6e-beb0-901d1ad206ae_170x.png?v=1720607162',
  primaryColor: '#c0dcb0',
  shopUrl: 'https://nicolina.es',
  contactEmail: 'info@nicolina.es',
  contactPhone: '611 34 20 73',
  contactAddress: 'C/ Potosí 4 · C/ Conde de Peñalver 18 · Madrid',
  socialLinks: { instagram: 'https://www.instagram.com/nicolinamadrid/' },
};

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
  // Fetch product images
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token')
    .eq('account_id', ANDREA_ID)
    .single();

  const imageByTitle = new Map<string, { src: string; price: number }>();
  if (conn) {
    const client = shopifyClient(conn.shop_domain, conn.access_token);
    const products = await client.getProducts({ limit: 50, fields: 'id,title,images,variants' });
    for (const p of products) {
      const title = (p.title as string).toLowerCase();
      const images = p.images as Array<{ src: string }> | undefined;
      const variants = p.variants as Array<{ price: string }> | undefined;
      if (images?.[0]?.src) {
        imageByTitle.set(title, { src: images[0].src, price: variants?.[0]?.price ? parseFloat(variants[0].price) : 0 });
      }
    }
  }

  // Get Anna's data
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
    ? content.products.split(',').map(s => s.trim()) : [];

  const enrichedProducts: ProductItem[] = productNames.map(name => {
    const match = fuzzyMatch(name, imageByTitle);
    return { title: name, quantity: 1, price: match?.price ?? 3.50, image_url: match?.src };
  });

  console.log(`Products: ${enrichedProducts.map(p => `${p.title}: ${p.image_url ? 'OK' : 'NO IMG'}`).join(', ')}`);

  const { subject, html } = buildCustomCopyEmail({
    storeName: 'NICOLINA',
    subject: customTitle ?? 'Anna, cuatro donas sin gluten',
    body: customCopy,
    ctaText: 'Completar mi pedido',
    ctaUrl: 'https://nicolina.es',
    products: enrichedProducts,
    brand: BRAND,
  });

  // Send with reply-to: info@nicolina.es
  const { data: sent, error } = await resend.emails.send({
    from: FROM,
    to: TONY_EMAIL,
    reply_to: 'info@nicolina.es',
    subject: `[HEADER FIX] ${subject}`,
    html,
  });

  if (error) console.error('Error:', error);
  else console.log(`Sent: ${sent?.id}\nReply-To: info@nicolina.es`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
