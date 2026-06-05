/**
 * Positioning + guardrails for ALL Sillages cold copy (outreach + nurture).
 *
 * One message: the DAILY BRIEF. Every morning, in 2 minutes, the store owner
 * knows what happened yesterday and the next step to sell more today — in plain
 * language, not analytics jargon.
 *
 * Hard rule: never promise a feature that isn't live. The allowed list is built
 * from plans.ts (getLiveFeatureKeys) so copy can't drift into unbuilt features.
 */

import { getLiveFeatureKeys } from '../lib/plans.js';

// Human, plain-language description per LIVE feature key. Keys not listed here
// are intentionally NOT described to the model (never invent a capability).
const FEATURE_DESCRIPTIONS: Record<string, string> = {
  daily_brief: 'el brief diario por email: cada mañana, qué pasó ayer en tu tienda y una cosa concreta para vender más hoy, en lenguaje llano',
  dashboard: 'un panel sencillo donde ves la evolución de tu tienda',
  manual_actions: 'acciones sugeridas que puedes aplicar tú mismo',
};

/** The only capabilities copy may mention, as plain-language bullet strings. */
export function getAllowedClaims(): string[] {
  return getLiveFeatureKeys()
    .map(k => FEATURE_DESCRIPTIONS[k])
    .filter((d): d is string => Boolean(d));
}

/** Plain-language map for pain tags → how the brief surfaces that pain each morning. */
export const PAIN_TO_BRIEF: Record<string, string> = {
  no_email_capture: 'no estás capturando emails de quien visita la tienda — el brief te avisa de cuántas visitas se van sin dejar contacto',
  no_urgency_pricing: 'sin sensación de urgencia ni precios comparados — el brief te señala dónde la gente duda y no compra',
  no_bundles: 'sin packs que suban el pedido medio — el brief te muestra qué productos se compran juntos',
  weak_descriptions: 'descripciones de producto flojas — el brief te marca qué fichas frenan la venta',
  no_reviews: 'sin reseñas visibles — el brief te recuerda dónde falta prueba social que convence',
  no_analytics: 'vas a ciegas sin datos claros — justo lo que el brief te resume cada mañana sin jerga',
  no_product_tags: 'productos sin organizar, difíciles de encontrar — el brief prioriza qué ordenar primero',
  high_aov: 'pedido medio alto: cada venta perdida pesa mucho — el brief te dice dónde estás dejando dinero',
  small_catalog: 'catálogo pequeño donde cada venta cuenta — el brief te enfoca en lo que mueve la aguja',
};

export function painToBrief(tags: string[]): string[] {
  return (tags ?? []).map(t => PAIN_TO_BRIEF[t]).filter(Boolean).slice(0, 3);
}

/** The system prompt shared positioning block (Spanish, plain language). */
export function positioningSystemPrompt(): string {
  const allowed = getAllowedClaims().map(c => `  - ${c}`).join('\n');
  return `Escribes para Sillages, una app de Shopify. UN solo mensaje: el BRIEF DIARIO.

Promesa central (úsala como eje, no la copies literal):
"Cada mañana, en 2 minutos, sabes qué pasó ayer en tu tienda y cuál es el siguiente paso para vender más hoy — explicado en un lenguaje que entiendes, no en jerga de analítica."

Lenguaje:
- Español llano, como un amigo que entiende de tiendas. Trato de "tú". Hablamos en "nosotros".
- Nada de jerga. Di "pedido medio", NO "AOV". Di "ventas", no "conversión/CR".
- Frases cortas. Cero corporativo. Sin emojis.

Personalización:
- Parte del dolor real detectado en su tienda, pero conéctalo SIEMPRE a cómo el brief diario se lo mostraría cada mañana.

SOLO puedes mencionar estas capacidades (están activas hoy):
${allowed}

PROHIBIDO (no existen hoy o no las hacemos — NUNCA las menciones):
  - emails automáticos de recuperación de carritos
  - emails de bienvenida automáticos
  - campañas, anuncios, gestión de redes, SEO automático, descuentos automáticos
  - cualquier cifra, porcentaje o resultado inventado
  - prometer "más ventas garantizadas"

CTA: instalar gratis desde la App Store de Shopify, o ver un brief de ejemplo. Sin presión.`;
}
