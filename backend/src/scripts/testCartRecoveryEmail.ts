import 'dotenv/config';
import { resend } from '../lib/resend.js';
import { buildCartRecoveryEmail } from '../services/emailTemplates.js';

async function main() {
  // Build a realistic cart recovery email for NICOLINA
  const { subject, html } = buildCartRecoveryEmail({
    customerName: 'María',
    storeName: 'NICOLINA',
    products: [
      { title: 'TARTA DE LIMÓN', quantity: 1, price: 35.90 },
      { title: 'VOLCÁN DE CHOCOLATE', quantity: 2, price: 36.90 },
      { title: 'VELAS DORADAS', quantity: 1, price: 4.90 },
    ],
    totalPrice: 114.60,
    currency: 'EUR',
    checkoutUrl: 'https://nicolina.es',
    discountCode: 'VUELVE10',
    discountPercent: 10,
    language: 'es',
  });

  console.log(`Subject: ${subject}`);
  console.log(`Sending test email...`);

  // Try with sillages.app first, fall back to sillages.co
  const fromOptions = [
    'NICOLINA <nicolina@mail.sillages.app>',
    'NICOLINA <nicolina@sillages.app>',
    'NICOLINA via Sillages <nicolina@sillages.app>',
  ];

  for (const from of fromOptions) {
    console.log(`\nTrying from: ${from}`);
    try {
      const { data, error } = await resend.emails.send({
        from,
        to: 'tony@richmondpartner.com',
        reply_to: 'andrea@nicolina.es',
        subject: `[TEST] ${subject}`,
        html,
      });

      if (error) {
        console.log(`  ❌ Error: ${JSON.stringify(error)}`);
        continue;
      }

      console.log(`  ✅ Sent! Message ID: ${data?.id}`);
      console.log(`  Reply-To: andrea@nicolina.es`);
      console.log(`  Check tony@richmondpartner.com inbox`);
      return;
    } catch (err) {
      console.log(`  ❌ Exception: ${(err as Error).message}`);
    }
  }

  console.log('\n❌ All from addresses failed. You need to verify a domain in Resend first.');
  
  // Show what domains are likely configured
  console.log('\nTo fix this:');
  console.log('1. Go to Resend Dashboard → Domains');
  console.log('2. Add domain: mail.sillages.app');
  console.log('3. Add the DNS records Resend provides');
  console.log('4. Wait for verification (1-5 min)');
  console.log('5. Re-run this script');
}

main().catch(e => { console.error(e); process.exit(1); });
