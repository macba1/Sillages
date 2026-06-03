/**
 * Instagram caption + hook generator (GPT-4o).
 * Audience: e-commerce store owners (food, beauty, fashion, handmade).
 * Copy rules (shared with the rest of Sillages): first person "nosotros",
 * no jargon, NEVER invent numbers/data, soft CTA to sillages.app.
 */

import { openai } from '../lib/openai.js';

export type CaptionSource = 'lead_pattern' | 'evergreen';

export interface CaptionResult {
  hook: string;      // short punchy phrase for the image (<= ~12 words)
  caption: string;   // full IG caption with line breaks + hashtags
  source: CaptionSource;
  theme: string;
}

const EVERGREEN_THEMES = [
  'carritos abandonados que no se recuperan',
  'clientes que compran una vez y no vuelven',
  'la recompra como motor de crecimiento',
  'descripciones de producto que no venden',
  'falta de urgencia y escasez en la tienda',
  'no capturar emails de visitantes',
];

const SYSTEM = `Eres el responsable de marketing de Sillages, una herramienta de inteligencia para tiendas Shopify.
Escribes posts de Instagram para dueños de tiendas e-commerce (food, beauty, fashion, handmade).
Reglas estrictas:
- Hablas en primera persona del plural ("nosotros"), cercano, como un colega que entiende su negocio.
- Sin jerga corporativa ni palabras de relleno.
- NUNCA inventes cifras, estadísticas ni datos concretos. Si no hay dato real, habla en cualitativo.
- CTA suave a sillages.app al final.
- Español de España, tono WhatsApp de un amigo experto.
Devuelve SOLO JSON: {"hook": "...", "caption": "..."}.
- "hook": frase corta y potente para la imagen (máx ~12 palabras, sin hashtags).
- "caption": caption completo con saltos de línea, 3-6 hashtags relevantes al final.`;

function buildUserPrompt(source: CaptionSource, theme: string, painTags: string[]): string {
  if (source === 'lead_pattern' && painTags.length > 0) {
    return `Tema de hoy: un patrón real (anónimo) que vemos en muchas tiendas pequeñas.
Señales detectadas (anonimizadas, NO menciones tiendas concretas): ${painTags.join(', ')}.
Escribe un post que nombre ese dolor y cómo abordarlo, sin prometer cifras.`;
  }
  return `Tema de hoy (evergreen): ${theme}.
Escribe un post útil sobre ese tema para dueños de tienda, sin inventar datos.`;
}

export interface GenerateCaptionInput {
  source: CaptionSource;
  /** Aggregated, anonymized pain tags from leads (for source='lead_pattern'). */
  painTags?: string[];
  /** Deterministic rotation index (avoids Math.random). */
  rotation?: number;
  /** Explicit theme override (used by the seed script to vary topics). */
  customTheme?: string;
}

export async function generateCaption(input: GenerateCaptionInput): Promise<CaptionResult> {
  const rotation = input.rotation ?? 0;
  const theme = input.customTheme
    ?? (input.source === 'lead_pattern'
      ? 'patrón real de tiendas'
      : EVERGREEN_THEMES[Math.abs(rotation) % EVERGREEN_THEMES.length]);
  const painTags = input.painTags ?? [];

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.8,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildUserPrompt(input.source, theme, painTags) },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? '{}';
  let parsed: { hook?: string; caption?: string };
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }

  const hook = (parsed.hook ?? '').trim();
  const caption = (parsed.caption ?? '').trim();
  if (!hook || !caption) throw new Error(`Caption generation returned empty hook/caption: ${raw.slice(0, 200)}`);

  return { hook, caption, source: input.source, theme };
}
