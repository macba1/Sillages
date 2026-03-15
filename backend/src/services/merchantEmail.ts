import { resend } from '../lib/resend.js';
import { supabase } from '../lib/supabase.js';

interface MerchantEmailInput {
  accountId: string;
  to: string | string[];
  subject: string;
  html: string;
}

/**
 * Send an email on behalf of a merchant using our shared domain.
 * From: "{Store Name}" <store-slug@mail.sillages.app>
 * Reply-To: merchant's email
 */
export async function sendMerchantEmail(input: MerchantEmailInput): Promise<{ messageId: string }> {
  const [{ data: conn }, { data: acc }] = await Promise.all([
    supabase.from('shopify_connections').select('shop_name, shop_domain').eq('account_id', input.accountId).single(),
    supabase.from('accounts').select('email').eq('id', input.accountId).single(),
  ]);

  const storeName = conn?.shop_name ?? conn?.shop_domain ?? 'Store';
  const merchantEmail = acc?.email ?? '';
  const slug = storeName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const fromAddress = `${slug}@sillages.app`;
  const fromField = `${storeName} <${fromAddress}>`;

  const recipients = Array.isArray(input.to) ? input.to : [input.to];

  const { data, error } = await resend.emails.send({
    from: fromField,
    to: recipients,
    reply_to: merchantEmail,
    subject: input.subject,
    html: input.html,
  });

  if (error || !data) throw new Error(`Resend error: ${(error as Error)?.message}`);

  return { messageId: data.id };
}
