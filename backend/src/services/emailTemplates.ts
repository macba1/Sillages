// ── Email Templates ─────────────────────────────────────────────────────────
// Professional, branded HTML email templates with product images.
// Table-based for max email client compatibility. Unified visual family.

type Lang = 'en' | 'es';

// ── Brand config for templates ─────────────────────────────────────────────

export interface BrandConfig {
  logoUrl?: string;
  primaryColor?: string;  // hex, e.g. '#c0dcb0'
  shopUrl?: string;
  storeName: string;
  contactEmail?: string;
  contactPhone?: string;
  contactAddress?: string;
  socialLinks?: { instagram?: string; facebook?: string; tiktok?: string };
}

const DEFAULT_PRIMARY = '#C9964A';
const BG_OUTER = '#F7F1EC';
const TEXT_DARK = '#3A2332';
const TEXT_MUTED = '#6B5460';
const CARD_BORDER = '#EDE5DC';

// ── Product with image ─────────────────────────────────────────────────────

export interface ProductItem {
  title: string;
  quantity: number;
  price: number;
  image_url?: string;
  product_url?: string;
}

// ── Cart Recovery ───────────────────────────────────────────────────────────

export interface CartRecoveryInput {
  customerName: string;
  storeName: string;
  products: ProductItem[];
  totalPrice: number;
  currency: string;
  checkoutUrl?: string;
  discountCode?: string;
  discountPercent?: number;
  language: Lang;
  brand?: BrandConfig;
}

export function buildCartRecoveryEmail(input: CartRecoveryInput): { subject: string; html: string } {
  const { customerName, storeName, products, totalPrice, currency, checkoutUrl, discountCode, discountPercent, language, brand } = input;
  const isEs = language === 'es';
  const accent = brand?.primaryColor ?? DEFAULT_PRIMARY;

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
  const ctaUrl = checkoutUrl ?? brand?.shopUrl ?? '#';

  const locale = isEs ? 'es-ES' : 'en-US';
  const fmt = (n: number) => new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);

  const productRows = products.map(p => productCard(p, fmt)).join('');

  const discountBlock = discountCode && discountPercent ? discountSection(discountCode, discountPercent, accent, isEs) : '';

  const html = wrapTemplate(storeName, brand, `
    <!-- Heading -->
    <tr>
      <td style="padding:32px 32px 8px;">
        <h1 style="margin:0;font-size:22px;font-weight:700;color:${TEXT_DARK};line-height:1.3;">${heading}</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:0 32px 24px;">
        <p style="margin:0;font-size:15px;color:${TEXT_MUTED};line-height:1.6;">${subheading}</p>
      </td>
    </tr>

    <!-- Product cards -->
    <tr>
      <td style="padding:0 32px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          ${productRows}
        </table>
      </td>
    </tr>

    <!-- Total -->
    <tr>
      <td style="padding:12px 32px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font-size:16px;font-weight:700;color:${TEXT_DARK};padding:12px 0;border-top:2px solid ${CARD_BORDER};">Total</td>
            <td align="right" style="font-size:16px;font-weight:700;color:${TEXT_DARK};padding:12px 0;border-top:2px solid ${CARD_BORDER};">${fmt(totalPrice)}</td>
          </tr>
        </table>
      </td>
    </tr>

    ${discountBlock}

    <!-- CTA -->
    <tr>
      <td style="padding:28px 32px 8px;" align="center">
        ${ctaButton(ctaText, ctaUrl, accent)}
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
  productImageUrl?: string;
  language: Lang;
  storeUrl: string;
  brand?: BrandConfig;
  recommendation?: {
    title: string;
    imageUrl?: string;
    price?: number;
    currency?: string;
    productUrl?: string;
  };
}

export function buildWelcomeEmail(input: WelcomeInput): { subject: string; html: string } {
  const { customerName, storeName, productPurchased, productImageUrl, language, storeUrl, brand, recommendation } = input;
  const isEs = language === 'es';
  const accent = brand?.primaryColor ?? DEFAULT_PRIMARY;

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
    ? 'Si tienes alguna pregunta, no dudes en responder a este correo.'
    : 'If you have any questions, feel free to reply to this email.';

  const heroImage = productImageUrl ? `
    <tr>
      <td style="padding:0 32px 20px;" align="center">
        <img src="${productImageUrl}" alt="${productPurchased}" width="280" style="display:block;max-width:280px;width:100%;height:auto;border-radius:12px;" />
      </td>
    </tr>` : '';

  // Recommendation section
  const locale = isEs ? 'es-ES' : 'en-US';
  const recoBlock = recommendation ? buildRecommendationBlock(recommendation, accent, locale, isEs) : '';

  const ctaText = isEs ? 'Volver a la tienda' : 'Back to the store';

  const html = wrapTemplate(storeName, brand, `
    <tr>
      <td style="padding:32px 32px 16px;">
        <h1 style="margin:0;font-size:22px;font-weight:700;color:${TEXT_DARK};line-height:1.3;">${heading}</h1>
      </td>
    </tr>
    ${heroImage}
    <tr>
      <td style="padding:0 32px;">
        <p style="margin:0 0 12px;font-size:15px;color:${TEXT_DARK};line-height:1.7;">${body}</p>
        <p style="margin:0;font-size:14px;color:${TEXT_MUTED};line-height:1.7;">${closing}</p>
      </td>
    </tr>
    ${recoBlock}
    <tr>
      <td style="padding:24px 32px 8px;" align="center">
        ${ctaButton(ctaText, storeUrl, accent)}
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
  lastProductImageUrl?: string;
  daysSinceLastPurchase: number;
  discountCode?: string;
  discountPercent?: number;
  language: Lang;
  storeUrl: string;
  brand?: BrandConfig;
}

export function buildReactivationEmail(input: ReactivationInput): { subject: string; html: string } {
  const { customerName, storeName, lastProduct, lastProductImageUrl, daysSinceLastPurchase, discountCode, discountPercent, language, storeUrl, brand } = input;
  const isEs = language === 'es';
  const accent = brand?.primaryColor ?? DEFAULT_PRIMARY;

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

  const heroImage = lastProductImageUrl ? `
    <tr>
      <td style="padding:0 32px 20px;" align="center">
        <img src="${lastProductImageUrl}" alt="${lastProduct}" width="280" style="display:block;max-width:280px;width:100%;height:auto;border-radius:12px;" />
      </td>
    </tr>` : '';

  const discountBlock = discountCode && discountPercent ? discountSection(discountCode, discountPercent, accent, isEs) : '';

  const html = wrapTemplate(storeName, brand, `
    <tr>
      <td style="padding:32px 32px 16px;">
        <h1 style="margin:0;font-size:22px;font-weight:700;color:${TEXT_DARK};line-height:1.3;">${heading}</h1>
      </td>
    </tr>
    ${heroImage}
    <tr>
      <td style="padding:0 32px;">
        <p style="margin:0;font-size:15px;color:${TEXT_DARK};line-height:1.7;">${body}</p>
      </td>
    </tr>
    ${discountBlock}
    <tr>
      <td style="padding:28px 32px 8px;" align="center">
        ${ctaButton(ctaText, storeUrl, accent)}
      </td>
    </tr>
  `);

  return { subject, html };
}

// ── Custom Copy Email ───────────────────────────────────────────────────────
// Wraps hand-written copy (plain text) in the design system HTML.

export function buildCustomCopyEmail(input: {
  storeName: string;
  subject: string;
  body: string;
  ctaText?: string;
  ctaUrl?: string;
  products?: ProductItem[];
  brand?: BrandConfig;
}): { subject: string; html: string } {
  const { storeName, subject, body, ctaText, ctaUrl, products, brand } = input;
  const accent = brand?.primaryColor ?? DEFAULT_PRIMARY;
  const locale = 'es-ES';
  const fmt = (n: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n);

  const htmlBody = body.replace(/\n/g, '<br>');

  const productGrid = products && products.length > 0
    ? `<tr><td style="padding:0 32px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          ${products.map(p => productCard(p, fmt)).join('')}
        </table>
      </td></tr>`
    : '';

  const ctaBlock = ctaText && ctaUrl ? `
    <tr>
      <td style="padding:24px 32px 8px;" align="center">
        ${ctaButton(ctaText, ctaUrl, accent)}
      </td>
    </tr>` : '';

  const html = wrapTemplate(storeName, brand, `
    <tr>
      <td style="padding:32px 32px 20px;">
        <p style="margin:0;font-size:15px;color:${TEXT_DARK};line-height:1.7;">${htmlBody}</p>
      </td>
    </tr>
    ${productGrid}
    ${ctaBlock}
  `);

  return { subject, html };
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function productCard(p: ProductItem, fmt: (n: number) => string): string {
  const imageCell = p.image_url
    ? `<td width="80" valign="top" style="padding-right:16px;">
        <img src="${p.image_url}" alt="${p.title}" width="80" height="80" style="display:block;width:80px;height:80px;border-radius:8px;object-fit:cover;border:1px solid ${CARD_BORDER};" />
      </td>`
    : `<td width="80" valign="top" style="padding-right:16px;">
        <div style="width:80px;height:80px;border-radius:8px;background:${BG_OUTER};border:1px solid ${CARD_BORDER};"></div>
      </td>`;

  return `
    <tr>
      <td style="padding:6px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            ${imageCell}
            <td valign="middle">
              <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:${TEXT_DARK};line-height:1.4;">${p.title}${p.quantity > 1 ? ` x${p.quantity}` : ''}</p>
              <p style="margin:0;font-size:13px;color:${TEXT_MUTED};">${fmt(p.price)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function buildRecommendationBlock(
  reco: { title: string; imageUrl?: string; price?: number; currency?: string; productUrl?: string },
  accent: string,
  locale: string,
  isEs: boolean,
): string {
  const fmt = (n: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: reco.currency ?? 'EUR', maximumFractionDigits: 2 }).format(n);
  const recoUrl = reco.productUrl ?? '#';
  const btnText = isEs ? 'Ver producto' : 'View product';

  const recoImage = reco.imageUrl
    ? `<td width="100" valign="top" style="padding-right:16px;">
        <a href="${recoUrl}" target="_blank" style="text-decoration:none;">
          <img src="${reco.imageUrl}" alt="${reco.title}" width="100" height="100" style="display:block;width:100px;height:100px;border-radius:8px;object-fit:cover;border:1px solid ${CARD_BORDER};" />
        </a>
      </td>`
    : '';

  return `
    <!-- Recommendation -->
    <tr>
      <td style="padding:24px 32px 0;">
        <p style="margin:0 0 12px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:${TEXT_MUTED};">${isEs ? 'También te puede gustar' : 'You might also like'}</p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAFAFA;border-radius:12px;border:1px solid ${CARD_BORDER};padding:16px;">
          <tr>
            ${recoImage}
            <td valign="middle">
              <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:${TEXT_DARK};line-height:1.4;">${reco.title}</p>
              ${reco.price ? `<p style="margin:0 0 12px;font-size:14px;color:${TEXT_MUTED};">${fmt(reco.price)}</p>` : ''}
              <a href="${recoUrl}" target="_blank" style="display:inline-block;padding:8px 20px;font-size:13px;font-weight:600;color:${accent};text-decoration:none;border:1.5px solid ${accent};border-radius:6px;">${btnText} &rarr;</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function discountSection(code: string, percent: number, accent: string, isEs: boolean): string {
  return `
    <tr>
      <td style="padding:20px 32px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="background:#FDF8F0;border-radius:8px;border:1px dashed ${accent};padding:14px 18px;text-align:center;">
              <p style="margin:0 0 4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:${accent};">
                ${isEs ? 'Oferta especial' : 'Special offer'}
              </p>
              <p style="margin:0;font-size:15px;font-weight:600;color:${TEXT_DARK};">
                ${isEs ? `Usa el código <span style="color:${accent};">${code}</span> para un ${percent}% de descuento` : `Use code <span style="color:${accent};">${code}</span> for ${percent}% off`}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function ctaButton(text: string, url: string, accent: string): string {
  return `
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
      <tr>
        <td align="center" style="background:${accent};border-radius:8px;">
          <a href="${url}" target="_blank" style="display:inline-block;padding:14px 40px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;letter-spacing:0.02em;">
            ${text} &rarr;
          </a>
        </td>
      </tr>
    </table>`;
}

function wrapTemplate(storeName: string, brand: BrandConfig | undefined, bodyContent: string): string {
  const accent = brand?.primaryColor ?? DEFAULT_PRIMARY;
  const logoUrl = brand?.logoUrl;
  const shopUrl = brand?.shopUrl ?? '#';

  // Header: logo only — clean, white background, dark logo
  // Shopify CDN: request larger image by replacing _NNNx with _400x
  const bigLogoUrl = logoUrl?.replace(/_\d+x\./, '_400x.');
  const headerContent = bigLogoUrl
    ? `<a href="${shopUrl}" target="_blank" style="text-decoration:none;">
        <img src="${bigLogoUrl}" alt="${storeName}" width="180" style="display:block;width:180px;height:auto;border:0;outline:none;" />
      </a>`
    : `<a href="${shopUrl}" target="_blank" style="text-decoration:none;font-size:20px;font-weight:700;color:${TEXT_DARK};letter-spacing:0.5px;">${storeName}</a>`;

  // Footer: store contact info + social links
  const contactLines: string[] = [];
  if (brand?.contactAddress) {
    contactLines.push(escapeHtml(brand.contactAddress));
  }
  if (brand?.contactPhone) {
    contactLines.push(`Tel: <a href="tel:${brand.contactPhone.replace(/\s/g, '')}" style="color:${TEXT_MUTED};text-decoration:none;">${escapeHtml(brand.contactPhone)}</a>`);
  }
  if (brand?.contactEmail) {
    contactLines.push(`<a href="mailto:${brand.contactEmail}" style="color:${TEXT_MUTED};text-decoration:underline;">${escapeHtml(brand.contactEmail)}</a>`);
  }

  // Social icons as text links
  const socialParts: string[] = [];
  if (brand?.socialLinks?.instagram) {
    socialParts.push(`<a href="${brand.socialLinks.instagram}" target="_blank" style="color:${TEXT_MUTED};text-decoration:none;font-weight:500;">Instagram</a>`);
  }
  if (brand?.socialLinks?.facebook) {
    socialParts.push(`<a href="${brand.socialLinks.facebook}" target="_blank" style="color:${TEXT_MUTED};text-decoration:none;font-weight:500;">Facebook</a>`);
  }
  if (brand?.socialLinks?.tiktok) {
    socialParts.push(`<a href="${brand.socialLinks.tiktok}" target="_blank" style="color:${TEXT_MUTED};text-decoration:none;font-weight:500;">TikTok</a>`);
  }

  const contactBlock = contactLines.length > 0
    ? `<p style="margin:0 0 8px;font-size:12px;color:${TEXT_MUTED};line-height:1.6;">${contactLines.join('<br>')}</p>`
    : '';

  const socialBlock = socialParts.length > 0
    ? `<p style="margin:0 0 12px;font-size:12px;color:${TEXT_MUTED};">${socialParts.join('&nbsp;&nbsp;&middot;&nbsp;&nbsp;')}</p>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <!--[if mso]>
  <style>table,td{font-family:Arial,Helvetica,sans-serif!important;}</style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:${BG_OUTER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG_OUTER};">
    <tr>
      <td align="center" style="padding:32px 16px 48px;">

        <!--[if (gte mso 9)|(IE)]>
        <table width="560" cellpadding="0" cellspacing="0" border="0"><tr><td>
        <![endif]-->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

          <!-- Header: logo only, white background -->
          <tr>
            <td style="background:#FFFFFF;border-radius:12px 12px 0 0;border:1px solid ${CARD_BORDER};border-bottom:none;padding:24px 32px;" align="center">
              ${headerContent}
            </td>
          </tr>

          <!-- Body card -->
          <tr>
            <td style="background:#FFFFFF;border-left:1px solid ${CARD_BORDER};border-right:1px solid ${CARD_BORDER};">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${bodyContent}
              </table>
            </td>
          </tr>

          <!-- Footer: store contact + Powered by Sillages -->
          <tr>
            <td style="background:#FAFAFA;border-radius:0 0 12px 12px;border:1px solid ${CARD_BORDER};border-top:none;padding:24px 32px;" align="center">
              <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:${TEXT_DARK};">${storeName}</p>
              ${contactBlock}
              ${socialBlock}
              <p style="margin:0;font-size:11px;color:#C4B0B9;">Powered by <a href="https://sillages.app" target="_blank" style="color:#C4B0B9;text-decoration:none;">Sillages</a></p>
            </td>
          </tr>

        </table>
        <!--[if (gte mso 9)|(IE)]>
        </td></tr></table>
        <![endif]-->

      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
