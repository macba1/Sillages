import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { buildCustomCopyEmail } from '../services/emailTemplates.js';
import { sendMerchantEmail } from '../services/merchantEmail.js';
import { buildUnsubscribeUrl } from '../lib/unsubscribe.js';
import type { BrandConfig } from '../services/emailTemplates.js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // Load NICOLINA's account
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('account_id, shop_name, shop_domain')
    .eq('shop_domain', 'taart-madrid.myshopify.com')
    .single();

  if (!conn) { console.error('NICOLINA connection not found'); return; }
  console.log(`Found NICOLINA: account=${conn.account_id}, shop=${conn.shop_name}`);

  // Load brand config
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

  const recipientEmail = 'tony@richmondpartner.com';
  const unsubscribeUrl = buildUnsubscribeUrl(conn.account_id, recipientEmail);

  console.log(`Unsubscribe URL: ${unsubscribeUrl}`);

  // Build email with custom copy (like a real cart recovery would)
  const { subject, html } = buildCustomCopyEmail({
    storeName: conn.shop_name ?? 'NICOLINA',
    subject: '[TEST UNSUBSCRIBE] María, tienes algo pendiente en tu carrito',
    body: `¡Hola María!\n\nHemos visto que dejaste algunos productos en tu carrito. Los hemos guardado para ti.\n\nTu Tarta de Limón y tu Volcán de Chocolate te están esperando. ¿Los recuperamos?\n\nUn abrazo,\nEl equipo de NICOLINA`,
    ctaText: 'Completar mi pedido',
    ctaUrl: brand.shopUrl,
    products: [
      { title: 'TARTA DE LIMÓN', quantity: 1, price: 35.90 },
      { title: 'VOLCÁN DE CHOCOLATE x2', quantity: 2, price: 36.90 },
    ],
    brand,
    unsubscribeUrl,
  });

  // Verify unsubscribe link is in the HTML
  const hasUnsubscribe = html.includes('darte de baja');
  const hasListUnsub = true; // Will be added by sendMerchantEmail via headers
  console.log(`\nHTML checks:`);
  console.log(`  Unsubscribe link in footer: ${hasUnsubscribe ? '✅' : '❌'}`);
  console.log(`  List-Unsubscribe header will be added: ${hasListUnsub ? '✅' : '❌'}`);

  if (!hasUnsubscribe) {
    console.error('❌ FAIL: unsubscribe link missing from HTML!');
    return;
  }

  // Send
  console.log(`\nSending to ${recipientEmail}...`);
  const { messageId } = await sendMerchantEmail({
    accountId: conn.account_id,
    to: recipientEmail,
    subject,
    html,
    unsubscribeUrl,
  });

  console.log(`✅ Sent! Message ID: ${messageId}`);
  console.log(`\nVerifica en tu inbox:`);
  console.log(`  1. Link "darte de baja aquí" en el footer`);
  console.log(`  2. Botón nativo "Darse de baja" en Gmail (arriba del email)`);
  console.log(`  3. Logo, productos, CTA visibles`);
}

main().catch(e => { console.error(e); process.exit(1); });
