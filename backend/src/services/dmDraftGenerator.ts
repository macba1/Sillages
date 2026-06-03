/**
 * Instagram DM DRAFT generator for leads. DRAFTS ONLY.
 *
 * ⚠️ NO automatic DM sending — ever. Cold-DM automation violates Meta's ToS and
 * gets accounts banned. This produces text for a human (Tony) to copy/paste and
 * send manually after review. There is intentionally no send integration here.
 */

import { openai } from '../lib/openai.js';
import { supabase } from '../lib/supabase.js';

const LOG = '[dmDrafts]';

export interface LeadForDraft {
  id: string;
  shop_domain: string;
  instagram_handle: string | null;
  pain_tags: string[];
  pain_score: number;
}

export interface DmDraft {
  lead_id: string;
  shop_domain: string;
  instagram_handle: string | null;
  draft_text: string;
  pain_tags: string[];
}

const SYSTEM = `Eres el fundador de Sillages escribiendo un primer mensaje directo (DM) de Instagram a la dueña/o de una tienda online.
Reglas:
- Máximo 500 caracteres. Cercano, humano, NADA de sonar a bot ni plantilla.
- Menciona UN dolor concreto observado en su tienda (sin sonar invasivo ni acusatorio).
- NUNCA inventes cifras. Nada de "tienes un 30% de...". Cualitativo.
- CTA muy suave (ofrecer ayuda / una idea), sin link agresivo. Puedes mencionar sillages.app de pasada.
- NUNCA uses placeholders entre corchetes (p.ej. [Tu Nombre], [Tienda]). Firma simplemente como "el equipo de Sillages" o sin firma.
- Español cercano. Devuelve SOLO el texto del DM, sin comillas ni explicaciones.`;

function painSummary(tags: string[]): string {
  const map: Record<string, string> = {
    no_urgency_pricing: 'falta de urgencia/escasez',
    no_bundles: 'sin packs ni bundles',
    weak_descriptions: 'descripciones flojas',
    no_product_tags: 'productos sin organizar',
    no_email_capture: 'no captáis emails de visitantes',
    no_reviews: 'sin reseñas visibles',
    no_analytics: 'sin analítica de comportamiento',
    high_aov: 'ticket alto (oportunidad de recompra)',
    weak_meta_description: 'SEO básico mejorable',
  };
  return tags.map(t => map[t] ?? t.replace(/_/g, ' ')).slice(0, 3).join(', ');
}

/** Generate one DM draft for a lead. Does NOT persist or send. */
export async function generateDmDraft(lead: LeadForDraft): Promise<DmDraft> {
  const pains = painSummary(lead.pain_tags ?? []);
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.7,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Tienda: ${lead.shop_domain}\nDolor(es) observado(s): ${pains || 'tienda pequeña con margen de mejora'}.\nEscribe el DM.` },
    ],
  });

  let text = (completion.choices[0]?.message?.content ?? '').trim().replace(/^["']|["']$/g, '');
  if (text.length > 500) text = text.slice(0, 497) + '…';
  if (!text) throw new Error(`Empty DM draft for ${lead.shop_domain}`);

  return {
    lead_id: lead.id,
    shop_domain: lead.shop_domain,
    instagram_handle: lead.instagram_handle,
    draft_text: text,
    pain_tags: lead.pain_tags ?? [],
  };
}

/** Load top leads for the day and generate DM drafts. Persists to content_dm_drafts (idempotent per lead+date). */
export async function generateDmDraftsForTopLeads(opts: { limit?: number; requireHandle?: boolean; persist?: boolean } = {}): Promise<DmDraft[]> {
  const limit = opts.limit ?? 5;
  const requireHandle = opts.requireHandle ?? false;
  const persist = opts.persist ?? true;
  const today = new Date().toISOString().slice(0, 10);

  // select('*') so this works before the instagram_handle migration is applied
  // (the column is optional — handle is just undefined until leads re-runs).
  const { data: leads, error } = await supabase
    .from('leads')
    .select('*')
    .gt('pain_score', 0)
    .neq('status', 'contacted')
    .order('pain_score', { ascending: false })
    .limit(limit * 3); // overfetch, filter below
  if (error) {
    console.error(`${LOG} Failed to load leads: ${error.message}`);
    return [];
  }

  const candidates = (leads ?? [])
    .map(l => ({ ...l, instagram_handle: l.instagram_handle ?? null }))
    .filter(l => !requireHandle || l.instagram_handle)
    .slice(0, limit);

  const drafts: DmDraft[] = [];
  for (const lead of candidates) {
    try {
      const draft = await generateDmDraft(lead as LeadForDraft);
      drafts.push(draft);
      if (persist) {
        await supabase.from('content_dm_drafts').upsert({
          lead_id: draft.lead_id,
          draft_date: today,
          instagram_handle: draft.instagram_handle,
          shop_domain: draft.shop_domain,
          draft_text: draft.draft_text,
          pain_tags: draft.pain_tags,
          status: 'pending',
        }, { onConflict: 'lead_id,draft_date' });
      }
    } catch (err) {
      console.warn(`${LOG} draft failed for ${lead.shop_domain}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`${LOG} Generated ${drafts.length} DM draft(s) for ${today}`);
  return drafts;
}
