/**
 * TEST: Fortune welcome email for Alicia — Apple-minimal design
 * ONLY sends to tony@richmondpartner.com
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { sendMerchantEmail } from '../services/merchantEmail.js';
import { buildUnsubscribeUrl } from '../lib/unsubscribe.js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('account_id, shop_name, shop_domain')
    .eq('shop_domain', 'taart-madrid.myshopify.com')
    .single();

  if (!conn) { console.error('NICOLINA not found'); return; }

  const { data: bp } = await supabase
    .from('brand_profiles')
    .select('logo_url, primary_color, shop_url, contact_email, contact_phone, contact_address, social_links')
    .eq('account_id', conn.account_id)
    .maybeSingle();

  const recipientEmail = 'tony@richmondpartner.com';
  const unsubscribeUrl = buildUnsubscribeUrl(conn.account_id, recipientEmail);

  // ── Content ─────────────────────────────────────────────────────────────
  const fortuna = 'Alicia, volcán de chocolate un martes por la tarde. Tú sabes algo que los demás no. Gracias por no dudarlo.';
  const pd = 'Los que piden Volcán de Chocolate suelen acabar pidiendo el Brownie. No decimos más.';
  const subject = 'Gracias, Alicia';

  // Black logo (sin_marco, no tagline)
  const logoUrl = bp?.logo_url?.replace(/_\d+x\./, '_400x.') ?? 'https://nicolina.es/cdn/shop/files/Logo-NICOLINA-sin_marco_bafd65b0-74df-4d6e-beb0-901d1ad206ae_400x.png?v=1720607162';
  const shopUrl = bp?.shop_url ?? 'https://nicolina.es';

  // Brownie
  const brownieImgUrl = 'https://cdn.shopify.com/s/files/1/0594/9810/2954/files/NICOLINA_ENERO-216.jpg?v=1770841163';
  const brownieUrl = 'https://nicolina.es/products/brownie-sin-lacteos';

  // Contact
  const socialLinks = bp?.social_links as { instagram?: string } | undefined;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!--[if mso]><style>table,td{font-family:Georgia,serif!important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#FFFFFF;font-family:Georgia,'Times New Roman',serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;">
    <tr>
      <td align="center" style="padding:48px 16px 64px;">
        <!--[if (gte mso 9)|(IE)]><table width="520" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding:0 0 64px;">
              <a href="${shopUrl}" target="_blank" style="text-decoration:none;">
                <img src="${logoUrl}" alt="NICOLINA" width="140" style="display:block;width:140px;height:auto;border:0;" />
              </a>
            </td>
          </tr>

          <!-- The fortune -->
          <tr>
            <td align="center" style="padding:0 24px;">
              <p style="margin:0;font-size:24px;line-height:1.65;color:#1A1A1A;font-weight:400;letter-spacing:-0.01em;">
                ${fortuna}
              </p>
            </td>
          </tr>

          <!-- NICOLINA signature -->
          <tr>
            <td align="center" style="padding:48px 0 0;">
              <p style="margin:0;font-size:13px;font-weight:400;color:#1A1A1A;letter-spacing:0.2em;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">NICOLINA</p>
            </td>
          </tr>

          <!-- Big spacer -->
          <tr><td style="height:72px;"></td></tr>

          <!-- P.D. with brownie image — no box, just content -->
          <tr>
            <td style="padding:0 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="80" valign="top" style="padding-right:20px;">
                    <a href="${brownieUrl}" target="_blank" style="text-decoration:none;">
                      <img src="${brownieImgUrl}" alt="Brownie" width="80" height="80" style="display:block;width:80px;height:80px;border-radius:10px;object-fit:cover;" />
                    </a>
                  </td>
                  <td valign="middle">
                    <p style="margin:0;font-size:14px;color:#888888;line-height:1.7;">
                      P.D. ${pd}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer spacer -->
          <tr><td style="height:72px;"></td></tr>

          <!-- Footer — minimal, grey -->
          <tr>
            <td align="center" style="border-top:1px solid #F0F0F0;padding:32px 0 0;">
              <p style="margin:0 0 6px;font-size:12px;color:#BBBBBB;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
                ${bp?.contact_address ?? ''}
              </p>
              <p style="margin:0 0 6px;font-size:12px;color:#BBBBBB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
                ${[bp?.contact_phone, bp?.contact_email].filter(Boolean).join(' · ')}
              </p>
              ${socialLinks?.instagram ? `<p style="margin:0 0 12px;font-size:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;"><a href="${socialLinks.instagram}" target="_blank" style="color:#BBBBBB;text-decoration:none;">Instagram</a></p>` : ''}
              <p style="margin:0;font-size:11px;color:#D5D5D5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
                <a href="${unsubscribeUrl}" target="_blank" style="color:#D5D5D5;text-decoration:underline;">Darte de baja</a>
                &nbsp;&middot;&nbsp;
                Powered by <a href="https://sillages.app" target="_blank" style="color:#D5D5D5;text-decoration:none;">Sillages</a>
              </p>
            </td>
          </tr>

        </table>
        <!--[if (gte mso 9)|(IE)]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;

  console.log('Sending to', recipientEmail, '...');
  const { messageId } = await sendMerchantEmail({
    accountId: conn.account_id,
    to: recipientEmail,
    subject,
    html,
    unsubscribeUrl,
  });

  console.log(`Sent! Message ID: ${messageId}`);
}

main().catch(e => { console.error(e); process.exit(1); });
