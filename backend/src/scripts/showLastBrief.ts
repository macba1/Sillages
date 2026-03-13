import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

const ACCOUNT_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

async function main() {
  const { data: brief } = await supabase
    .from('intelligence_briefs')
    .select('*')
    .eq('account_id', ACCOUNT_ID)
    .order('brief_date', { ascending: false })
    .limit(1)
    .single();

  if (!brief) { console.log('No brief found'); return; }

  console.log('DATE:', brief.brief_date, '| STATUS:', brief.status, '| TOKENS:', brief.total_tokens);

  const y = brief.section_yesterday as Record<string, unknown>;
  console.log('\n══════════════════════════════════════');
  console.log('  BRIEF NARRATIVO');
  console.log('══════════════════════════════════════');
  console.log('\n── RESUMEN ──');
  console.log(y?.summary);

  const w = brief.section_whats_working as { items: Array<{ insight: string }> };
  console.log('\n── LO QUE FUNCIONA ──');
  w?.items?.forEach(i => console.log(i.insight));

  const nw = brief.section_whats_not_working as { items: Array<{ insight: string }> };
  console.log('\n── LO QUE NO FUNCIONA ──');
  nw?.items?.forEach(i => console.log(i.insight));

  const s = brief.section_signal as Record<string, unknown>;
  console.log('\n── SEÑAL ──');
  console.log(s?.market_context);

  const u = brief.section_upcoming as { items: Array<{ pattern: string }> };
  console.log('\n── PRÓXIMO ──');
  u?.items?.forEach(i => console.log(i.pattern));

  const g = brief.section_gap as Record<string, unknown>;
  console.log('\n── GAP ──');
  console.log(g?.gap);
  console.log('Upside:', g?.estimated_upside);

  const a = brief.section_activation as Record<string, unknown>;
  console.log('\n── ACTIVACIÓN ──');
  console.log('Qué:', a?.what);
  const howSteps = a?.how as string[] | undefined;
  howSteps?.forEach((h, i) => console.log(`  ${i + 1}. ${h}`));

  const { data: actions } = await supabase
    .from('pending_actions')
    .select('type, title, description, content')
    .eq('brief_id', brief.id);

  console.log('\n══════════════════════════════════════');
  console.log(`  ACCIONES (${actions?.length ?? 0})`);
  console.log('══════════════════════════════════════');
  actions?.forEach((act, i) => {
    const c = act.content as Record<string, unknown>;
    console.log(`\n${i + 1}. [${act.type}] ${act.title}`);
    console.log(`   ${act.description}`);
    if (c?.copy) console.log(`\n   COPY:\n   ${c.copy}`);
    if (c?.discount_code) console.log(`   CÓDIGO: ${c.discount_code} (${c.discount_percentage}% en ${c.discount_product})`);
    if (c?.email_subject) console.log(`   SUBJECT: ${c.email_subject}`);
    if (c?.email_body) console.log(`   BODY: ${c.email_body}`);
    if (c?.seo_new_value) console.log(`   SEO: ${c.seo_field} → ${c.seo_new_value}`);
    if (c?.priority) console.log(`   PRIORIDAD: ${c.priority} | TIEMPO: ${c.time_estimate}`);
  });

  console.log('\n══════════════════════════════════════');
  console.log('  NOTAS DEL AUDITOR');
  console.log('══════════════════════════════════════');
  console.log((brief as Record<string, unknown>).audit_notes ?? '(columna audit_notes no disponible en este brief)');
}

main().catch(e => console.error(e.message));
