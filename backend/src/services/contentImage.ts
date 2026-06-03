/**
 * Branded Instagram image generator — $0, no stock, no paid APIs.
 * Renders an SVG (Sillages brand palette) to a 1080×1350 PNG via sharp.
 */

import sharp from 'sharp';

const W = 1080;
const H = 1350;

// Sillages brand palette (matches the email templates).
const FONT = 'Helvetica, Arial, sans-serif';

export interface ImageTemplate {
  name: string;
  bg: string;
  fg: string;       // hook text
  accent: string;   // wordmark + CTA
  sub: string;      // muted label
}

export const TEMPLATES: ImageTemplate[] = [
  { name: 'cream',  bg: '#F2EBE3', fg: '#14110D', accent: '#1E9E5A', sub: '#8A7F6E' },
  { name: 'ink',    bg: '#14110D', fg: '#FFFFFF', accent: '#FFE38A', sub: '#7A7062' },
  { name: 'green',  bg: '#ECF7EF', fg: '#0B5C2E', accent: '#1E9E5A', sub: '#0F7A3D' },
  { name: 'amber',  bg: '#FFF8E6', fg: '#14110D', accent: '#E0A500', sub: '#7A5C00' },
];

export function pickTemplate(seed: number): ImageTemplate {
  return TEMPLATES[Math.abs(seed) % TEMPLATES.length];
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Greedy word-wrap to a max chars-per-line budget. */
function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur.length === 0) { cur = w; continue; }
    if ((cur + ' ' + w).length <= maxCharsPerLine) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

export interface BuildImageInput {
  hook: string;        // big headline phrase
  template?: ImageTemplate;
  seed?: number;       // used to pick a template if none provided
}

/** Build a branded 1080×1350 PNG buffer. */
export async function buildBrandedImage(input: BuildImageInput): Promise<Buffer> {
  const tpl = input.template ?? pickTemplate(input.seed ?? 0);

  // Size the hook text to the amount of copy (fewer words → bigger).
  const lines = wrapText(input.hook, 18);
  const fontSize = lines.length <= 2 ? 92 : lines.length === 3 ? 76 : 62;
  const lineHeight = Math.round(fontSize * 1.18);
  const blockHeight = lines.length * lineHeight;
  const startY = Math.round((H - blockHeight) / 2) + fontSize;

  const hookTspans = lines.map((line, i) =>
    `<tspan x="${W / 2}" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`,
  ).join('');

  const svg = `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${tpl.bg}"/>
  <text x="${W / 2}" y="120" text-anchor="middle"
        font-family="${FONT}" font-size="30" font-weight="700"
        letter-spacing="10" fill="${tpl.accent}">SILLAGES</text>
  <text text-anchor="middle" font-family="${FONT}" font-size="${fontSize}"
        font-weight="800" fill="${tpl.fg}" letter-spacing="-1">
    ${hookTspans}
  </text>
  <text x="${W / 2}" y="${H - 90}" text-anchor="middle"
        font-family="${FONT}" font-size="34" font-weight="700"
        letter-spacing="2" fill="${tpl.accent}">sillages.app</text>
  <text x="${W / 2}" y="${H - 48}" text-anchor="middle"
        font-family="${FONT}" font-size="22" font-weight="500"
        letter-spacing="1" fill="${tpl.sub}">Inteligencia para tu tienda</text>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
