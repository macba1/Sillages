import 'dotenv/config';
import { buildCustomCopyEmail } from '../services/emailTemplates.js';
import type { BrandConfig } from '../services/emailTemplates.js';

const BRAND: BrandConfig = {
  storeName: 'NICOLINA',
  logoUrl: 'https://nicolina.es/cdn/shop/files/Logo-NICOLINA-sin_marco_bafd65b0-74df-4d6e-beb0-901d1ad206ae_170x.png?v=1720607162',
  primaryColor: '#c0dcb0',
  shopUrl: 'https://nicolina.es',
  contactPhone: '611 34 20 73',
  contactAddress: 'C/ Potosí 4 · C/ Conde de Peñalver 18 · Madrid',
  socialLinks: { instagram: 'https://www.instagram.com/nicolinamadrid/' },
};

const { html } = buildCustomCopyEmail({
  storeName: 'NICOLINA',
  subject: 'Test',
  body: 'Hello test',
  ctaText: 'Click',
  ctaUrl: 'https://nicolina.es',
  brand: BRAND,
});

// Print just the header section
const headerStart = html.indexOf('<!-- Header');
const bodyStart = html.indexOf('<!-- Body');
console.log('=== HEADER HTML ===');
console.log(html.slice(headerStart, bodyStart));
