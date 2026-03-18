import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { resend } from '../lib/resend.js';
import { buildCartRecoveryEmail } from '../services/emailTemplates.js';
import type { BrandConfig } from '../services/emailTemplates.js';

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';
const TO = 'tony@richmondpartner.com';

async function main() {
  // Load brand config from DB (same path as production)
  const [{ data: bp }, { data: conn }] = await Promise.all([
    supabase.from('brand_profiles')
      .select('logo_url, primary_color, shop_url, contact_email, contact_phone, contact_address, social_links')
      .eq('account_id', ANDREA_ID).maybeSingle(),
    supabase.from('shopify_connections')
      .select('shop_name, shop_domain').eq('account_id', ANDREA_ID).single(),
  ]);

  const storeName = conn?.shop_name ?? 'NICOLINA';

  console.log('=== BRAND CONFIG FROM DB ===');
  console.log(`  logo_url: ${bp?.logo_url ?? 'NULL'}`);
  console.log(`  primary_color: ${bp?.primary_color ?? 'NULL'}`);
  console.log(`  shop_url: ${bp?.shop_url ?? 'NULL'}`);
  console.log(`  contact_email: ${bp?.contact_email ?? 'NULL'}`);

  const brand: BrandConfig = {
    storeName,
    logoUrl: bp?.logo_url ?? undefined,
    primaryColor: bp?.primary_color ?? undefined,
    shopUrl: bp?.shop_url ?? undefined,
    contactEmail: bp?.contact_email ?? undefined,
    contactPhone: bp?.contact_phone ?? undefined,
    contactAddress: bp?.contact_address ?? undefined,
    socialLinks: bp?.social_links as BrandConfig['socialLinks'] ?? undefined,
  };

  const { subject, html } = buildCartRecoveryEmail({
    customerName: 'Tony',
    storeName,
    products: [
      { title: 'TARTA DE QUESO', quantity: 1, price: 34.90 },
      { title: 'DONA KINDER', quantity: 2, price: 3.50 },
    ],
    totalPrice: 41.90,
    currency: 'EUR',
    language: 'es',
    brand,
  });

  // Verify HTML has img tag
  const hasImg = html.includes('<img src=');
  const hasWhiteBg = html.includes('background:#FFFFFF');
  console.log(`\n=== HTML CHECKS ===`);
  console.log(`  Has <img> tag: ${hasImg}`);
  console.log(`  Has white bg header: ${hasWhiteBg}`);

  if (!hasImg) {
    console.error('ERROR: No <img> tag in HTML — logo will not show!');
  }

  // Extract the img src for verification
  const imgMatch = html.match(/<img src="([^"]+)"/);
  if (imgMatch) {
    console.log(`  Logo URL in HTML: ${imgMatch[1]}`);
  }

  // Send
  const { data, error } = await resend.emails.send({
    from: `${storeName} <nicolina@sillages.app>`,
    to: TO,
    reply_to: bp?.contact_email ?? 'info@nicolina.es',
    subject: `[VERIFY LOGO] ${subject}`,
    html,
  });

  if (error) {
    console.error('SEND ERROR:', error);
    process.exit(1);
  }

  console.log(`\n✅ Email sent to ${TO}`);
  console.log(`   Message ID: ${data?.id}`);
  console.log(`   Subject: [VERIFY LOGO] ${subject}`);
  console.log(`   Reply-To: ${bp?.contact_email ?? 'info@nicolina.es'}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
