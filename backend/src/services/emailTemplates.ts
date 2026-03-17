// ── Email Templates ─────────────────────────────────────────────────────────
// Beautiful, table-based HTML email templates for merchant communications.
// Design system: background #F7F1EC, cards white, accent #C9964A, text #3A2332

type Lang = 'en' | 'es';

// ── Cart Recovery ───────────────────────────────────────────────────────────

export interface CartRecoveryInput {
  customerName: string;
  storeName: string;
  products: Array<{ title: string; quantity: number; price: number }>;
  totalPrice: number;
  currency: string;
  checkoutUrl?: string;
  discountCode?: string;
  discountPercent?: number;
  language: Lang;
}

export function buildCartRecoveryEmail(input: CartRecoveryInput): { subject: string; html: string } {
  const { customerName, storeName, products, totalPrice, currency, checkoutUrl, discountCode, discountPercent, language } = input;
  const isEs = language === 'es';

  const subject = isEs
    ? `Hola ${customerName}, olvidaste algo en tu carrito`
    : `${customerName}, you left something behind`;

  const heading = isEs
    ? `Hola ${customerName}, dejaste algo en tu carrito`
    : `Hey ${customerName}, you left something in your cart`;

  const subheading = isEs
    ? 'Tus productos te esperan. Completa tu pedido antes de que se agoten.'
    : 'Your items are waiting for you. Complete your order before they sell out.';

  const ctaText = isEs ? 'Completar mi pedido' : 'Complete my order';
  const ctaUrl = checkoutUrl ?? '#';

  const locale = isEs ? 'es-ES' : 'en-US';
  const fmt = (n: number) => new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);

  const productRows = products.map(p => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #F0E8E0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font-size:14px;font-weight:500;color:#3A2332;line-height:1.5;">${p.title}</td>
            <td align="right" style="font-size:14px;color:#6B5460;white-space:nowrap;padding-left:16px;">
              ${p.quantity > 1 ? `${p.quantity} x ` : ''}${fmt(p.price)}
            </td>
          </tr>
        </table>
      </td>
    </tr>`).join('');

  const totalLabel = isEs ? 'Total' : 'Total';

  const discountBlock = discountCode && discountPercent ? `
    <tr>
      <td style="padding:16px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="background:#FDF8F0;border-radius:8px;border:1px dashed #C9964A;padding:14px 18px;text-align:center;">
              <p style="margin:0 0 4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#C9964A;">
                ${isEs ? 'Oferta especial' : 'Special offer'}
              </p>
              <p style="margin:0;font-size:15px;font-weight:600;color:#3A2332;">
                ${isEs ? `Usa el código <span style="color:#C9964A;">${discountCode}</span> para un ${discountPercent}% de descuento` : `Use code <span style="color:#C9964A;">${discountCode}</span> for ${discountPercent}% off`}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>` : '';

  const html = wrapTemplate(storeName, `
    <!-- Heading -->
    <tr>
      <td style="padding:0 24px 8px;">
        <p style="margin:0;font-size:20px;font-weight:600;color:#3A2332;line-height:1.3;">${heading}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px 24px;">
        <p style="margin:0;font-size:14px;color:#6B5460;line-height:1.6;">${subheading}</p>
      </td>
    </tr>

    <!-- Product list -->
    <tr>
      <td style="padding:0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border-radius:12px;border:1px solid #EDE5DC;padding:4px 20px;">
          ${productRows}
          <tr>
            <td style="padding:14px 0 10px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:15px;font-weight:700;color:#3A2332;">${totalLabel}</td>
                  <td align="right" style="font-size:15px;font-weight:700;color:#3A2332;">${fmt(totalPrice)}</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    ${discountBlock}

    <!-- CTA -->
    <tr>
      <td style="padding:24px 24px 0;" align="center">
        ${ctaButton(ctaText, ctaUrl)}
      </td>
    </tr>
  `);

  return { subject, html };
}

// ── Welcome Email ───────────────────────────────────────────────────────────

export interface WelcomeInput {
  customerName: string;
  storeName: string;
  productPurchased: string;
  language: Lang;
  storeUrl: string;
}

export function buildWelcomeEmail(input: WelcomeInput): { subject: string; html: string } {
  const { customerName, storeName, productPurchased, language, storeUrl } = input;
  const isEs = language === 'es';

  const subject = isEs
    ? `¡Gracias por tu pedido, ${customerName}!`
    : `Thanks for your order, ${customerName}!`;

  const heading = isEs
    ? `¡Gracias, ${customerName}!`
    : `Thank you, ${customerName}!`;

  const body = isEs
    ? `Estamos encantados de que hayas elegido <strong>${productPurchased}</strong>. En ${storeName} nos esforzamos por ofrecerte la mejor experiencia, y tu pedido ya está en camino.`
    : `We're thrilled that you chose <strong>${productPurchased}</strong>. At ${storeName}, we strive to give you the best experience, and your order is on its way.`;

  const closing = isEs
    ? 'Si tienes alguna pregunta, no dudes en responder a este correo. Estamos aquí para ayudarte.'
    : 'If you have any questions, feel free to reply to this email. We are here to help.';

  const ctaText = isEs ? 'Descubre más productos' : 'Discover more products';

  const html = wrapTemplate(storeName, `
    <tr>
      <td style="padding:0 24px 8px;">
        <p style="margin:0;font-size:20px;font-weight:600;color:#3A2332;line-height:1.3;">${heading}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border-radius:12px;border:1px solid #EDE5DC;padding:20px 24px;">
          <tr>
            <td>
              <p style="margin:0 0 16px;font-size:14px;color:#3A2332;line-height:1.7;">${body}</p>
              <p style="margin:0;font-size:14px;color:#6B5460;line-height:1.7;">${closing}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:24px 24px 0;" align="center">
        ${ctaButton(ctaText, storeUrl)}
      </td>
    </tr>
  `);

  return { subject, html };
}

// ── Reactivation Email ──────────────────────────────────────────────────────

export interface ReactivationInput {
  customerName: string;
  storeName: string;
  lastProduct: string;
  daysSinceLastPurchase: number;
  discountCode?: string;
  discountPercent?: number;
  language: Lang;
  storeUrl: string;
}

export function buildReactivationEmail(input: ReactivationInput): { subject: string; html: string } {
  const { customerName, storeName, lastProduct, daysSinceLastPurchase, discountCode, discountPercent, language, storeUrl } = input;
  const isEs = language === 'es';

  const subject = isEs
    ? `${customerName}, te echamos de menos`
    : `${customerName}, we miss you`;

  const heading = isEs
    ? `Te echamos de menos, ${customerName}`
    : `We miss you, ${customerName}`;

  const body = isEs
    ? `Han pasado ${daysSinceLastPurchase} días desde que compraste <strong>${lastProduct}</strong>. Nos encantaría verte de vuelta en ${storeName}.`
    : `It's been ${daysSinceLastPurchase} days since you got <strong>${lastProduct}</strong>. We'd love to see you back at ${storeName}.`;

  const ctaText = isEs ? 'Volver a la tienda' : 'Back to the store';

  const discountBlock = discountCode && discountPercent ? `
    <tr>
      <td style="padding:20px 24px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="background:#FDF8F0;border-radius:8px;border:1px dashed #C9964A;padding:14px 18px;text-align:center;">
              <p style="margin:0 0 4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#C9964A;">
                ${isEs ? 'Un detalle para ti' : 'A little something for you'}
              </p>
              <p style="margin:0;font-size:15px;font-weight:600;color:#3A2332;">
                ${isEs ? `Usa el código <span style="color:#C9964A;">${discountCode}</span> para un ${discountPercent}% de descuento` : `Use code <span style="color:#C9964A;">${discountCode}</span> for ${discountPercent}% off`}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>` : '';

  const html = wrapTemplate(storeName, `
    <tr>
      <td style="padding:0 24px 8px;">
        <p style="margin:0;font-size:20px;font-weight:600;color:#3A2332;line-height:1.3;">${heading}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border-radius:12px;border:1px solid #EDE5DC;padding:20px 24px;">
          <tr>
            <td>
              <p style="margin:0;font-size:14px;color:#3A2332;line-height:1.7;">${body}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${discountBlock}
    <tr>
      <td style="padding:24px 24px 0;" align="center">
        ${ctaButton(ctaText, storeUrl)}
      </td>
    </tr>
  `);

  return { subject, html };
}

// ── Custom Copy Email ───────────────────────────────────────────────────────
// Wraps hand-written copy (plain text) in the design system HTML.
// Used when content.copy exists in the action — bypasses generic templates.

export function buildCustomCopyEmail(input: {
  storeName: string;
  subject: string;
  body: string;
  ctaText?: string;
  ctaUrl?: string;
}): { subject: string; html: string } {
  const { storeName, subject, body, ctaText, ctaUrl } = input;

  // Convert plain text line breaks to <br> for HTML
  const htmlBody = body.replace(/\n/g, '<br>');

  const ctaBlock = ctaText && ctaUrl ? `
    <tr>
      <td style="padding:24px 24px 0;" align="center">
        ${ctaButton(ctaText, ctaUrl)}
      </td>
    </tr>` : '';

  const html = wrapTemplate(storeName, `
    <tr>
      <td style="padding:0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border-radius:12px;border:1px solid #EDE5DC;padding:20px 24px;">
          <tr>
            <td>
              <p style="margin:0;font-size:14px;color:#3A2332;line-height:1.7;">${htmlBody}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${ctaBlock}
  `);

  return { subject, html };
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function ctaButton(text: string, url: string): string {
  return `
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
      <tr>
        <td align="center" style="background:#C9964A;border-radius:8px;">
          <a href="${url}" target="_blank" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
            ${text}
          </a>
        </td>
      </tr>
    </table>`;
}

function wrapTemplate(storeName: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
</head>
<body style="margin:0;padding:0;background:#F7F1EC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F1EC;min-height:100vh;">
    <tr>
      <td align="center" style="padding:32px 16px 48px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

          <!-- Header -->
          <tr>
            <td style="padding-bottom:28px;">
              <p style="margin:0;font-size:18px;font-weight:700;color:#3A2332;letter-spacing:-0.3px;">${storeName}</p>
            </td>
          </tr>

          ${bodyContent}

          <!-- Footer -->
          <tr>
            <td style="padding-top:32px;" align="center">
              <p style="margin:0;font-size:11px;color:#C4B0B9;">Powered by Sillages</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
