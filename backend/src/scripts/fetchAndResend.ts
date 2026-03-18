import 'dotenv/config';
import { resend } from '../lib/resend.js';
import { supabase } from '../lib/supabase.js';
import { buildCustomCopyEmail } from '../services/emailTemplates.js';

const ANNA_MESSAGE_ID = '14ce5e02-5acd-4cef-b146-45a539dc9310';
const TONY_EMAIL = 'tony@richmondpartner.com';

async function main() {
  // 1. Get the action content to reconstruct the exact email
  const { data: action } = await supabase
    .from('pending_actions')
    .select('content, title, result')
    .eq('type', 'cart_recovery')
    .eq('status', 'completed')
    .filter('result->>message_id', 'eq', ANNA_MESSAGE_ID)
    .single();

  if (!action) {
    console.log('Action not found, trying Resend API directly...');
    // Try Resend API to get email details
    try {
      const email = await resend.emails.get(ANNA_MESSAGE_ID);
      console.log('=== RESEND EMAIL DETAILS ===');
      console.log(JSON.stringify(email, null, 2));
    } catch (err) {
      console.error('Resend API error:', err);
    }
    return;
  }

  const content = action.content as Record<string, unknown>;
  const result = action.result as Record<string, unknown>;

  console.log('=== EMAIL DETAILS ===');
  console.log(`To: ${result.sent_to}`);
  console.log(`Subject: ${content.title ?? action.title}`);
  console.log(`Customer: ${content.customer_name}`);
  console.log(`Copy:\n${content.copy}\n`);

  // 2. Get store name for the from field
  const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_name')
    .eq('account_id', ANDREA_ID)
    .single();

  const storeName = conn?.shop_name ?? 'NICOLINA';

  // 3. Rebuild the exact same email HTML
  const { subject, html } = buildCustomCopyEmail({
    storeName,
    subject: (content.title as string) ?? 'Anna, cuatro donas sin gluten',
    body: content.copy as string,
    ctaText: 'Completar mi pedido',
    ctaUrl: content.checkout_url as string | undefined,
  });

  console.log('=== RECONSTRUCTED EMAIL ===');
  console.log(`Subject: ${subject}`);
  console.log(`HTML length: ${html.length} chars`);
  console.log('');

  // 4. Print the full HTML
  console.log('=== FULL HTML ===');
  console.log(html);
  console.log('');

  // 5. Send to Tony
  console.log(`=== SENDING TO ${TONY_EMAIL} ===`);
  const slug = storeName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const fromField = `${storeName} <${slug}@sillages.app>`;

  const { data: sent, error } = await resend.emails.send({
    from: fromField,
    to: TONY_EMAIL,
    subject: `[PREVIEW] ${subject}`,
    html,
  });

  if (error) {
    console.error('Send error:', error);
  } else {
    console.log(`✅ Sent to ${TONY_EMAIL} — message ID: ${sent?.id}`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
