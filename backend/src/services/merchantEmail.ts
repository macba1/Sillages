import { resend } from '../lib/resend.js';
import { supabase } from '../lib/supabase.js';

interface MerchantEmailInput {
  accountId: string;
  to: string | string[];
  subject: string;
  html: string;
  unsubscribeUrl?: string;
}

/**
 * Send an email on behalf of a merchant using our shared domain.
 * From: "{Store Name}" <store-slug@sillages.app>
 * Reply-To: brand_profiles.contact_email → fallback to merchant's account email
 * List-Unsubscribe: GDPR-compliant unsubscribe header for Gmail/Outlook native button
 */
export async function sendMerchantEmail(input: MerchantEmailInput): Promise<{ messageId: string }> {
  const [{ data: conn }, { data: bp }, { data: acc }] = await Promise.all([
    supabase.from('shopify_connections').select('shop_name, shop_domain').eq('account_id', input.accountId).single(),
    supabase.from('brand_profiles').select('contact_email').eq('account_id', input.accountId).maybeSingle(),
    supabase.from('accounts').select('email').eq('id', input.accountId).single(),
  ]);

  const storeName = conn?.shop_name ?? conn?.shop_domain ?? 'Store';
  const replyTo = bp?.contact_email ?? acc?.email ?? undefined;
  const slug = storeName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const fromAddress = `${slug}@sillages.app`;
  const fromField = `${storeName} <${fromAddress}>`;

  const recipients = Array.isArray(input.to) ? input.to : [input.to];

  // Build headers with List-Unsubscribe for GDPR compliance
  const headers: Record<string, string> = {};
  if (input.unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${input.unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  const { data, error } = await resend.emails.send({
    from: fromField,
    to: recipients,
    reply_to: replyTo,
    subject: input.subject,
    html: input.html,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  });

  if (error || !data) throw new Error(`Resend error: ${(error as Error)?.message}`);

  return { messageId: data.id };
}
