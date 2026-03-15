import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { generateBrief } from '../services/briefGenerator.js';

async function main() {
  // Find Andrea's account
  const { data: acc } = await supabase
    .from('accounts')
    .select('id, email, full_name, language')
    .eq('email', 'andrea@nicolina.es')
    .single();

  if (!acc) { console.error('Account not found'); process.exit(1); }
  console.log(`Account: ${acc.full_name} (${acc.email}) — language: ${acc.language}`);

  // Find the most recent snapshot
  const { data: snap } = await supabase
    .from('shopify_daily_snapshots')
    .select('snapshot_date')
    .eq('account_id', acc.id)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .single();

  if (!snap) { console.error('No snapshots'); process.exit(1); }
  console.log(`Latest snapshot: ${snap.snapshot_date}`);
  console.log('Running full pipeline: Analyst → Growth Hacker → Quality Auditor...\n');

  const start = Date.now();
  await generateBrief({ accountId: acc.id, briefDate: snap.snapshot_date });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  // Load the generated brief
  const { data: brief } = await supabase
    .from('intelligence_briefs')
    .select('*')
    .eq('account_id', acc.id)
    .eq('brief_date', snap.snapshot_date)
    .single();

  if (!brief) { console.error('Brief not found after generation'); process.exit(1); }

  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`  BRIEF COMPLETO — NICOLINA — ${snap.snapshot_date}`);
  console.log(`  Status: ${brief.status} | Tokens: ${brief.total_tokens} | ${elapsed}s`);
  console.log(`════════════════════════════════════════════════════════════`);

  // 1. BRIEF NARRATIVO
  const y = brief.section_yesterday as Record<string, unknown> | null;
  if (y) {
    console.log(`\n══ AYER ══`);
    console.log(`Revenue: €${y.revenue} | Pedidos: ${y.orders} | AOV: €${y.aov}`);
    console.log(`Sesiones: ${y.sessions} | Conversión: ${y.conversion_rate}`);
    console.log(`Nuevos clientes: ${y.new_customers} | Top: ${y.top_product}`);
    console.log(`\n${y.summary}`);
    const wow = y.wow as Record<string, unknown> | null;
    if (wow) {
      console.log(`\nWoW: Revenue ${wow.revenue_pct}% | Pedidos ${wow.orders_pct}% | AOV ${wow.aov_pct}%`);
    }
  }

  const ww = brief.section_whats_working as Record<string, unknown> | null;
  if (ww) {
    console.log(`\n══ LO QUE FUNCIONA ══`);
    const items = (ww as any).items as any[];
    for (const item of items ?? []) {
      console.log(`  ${item.title} (${item.metric}): ${item.insight}`);
    }
  }

  const wnw = brief.section_whats_not_working as Record<string, unknown> | null;
  if (wnw) {
    console.log(`\n══ LO QUE NO FUNCIONA ══`);
    const items = (wnw as any).items as any[];
    for (const item of items ?? []) {
      console.log(`  ${item.title}: ${item.insight}`);
    }
  }

  const up = brief.section_upcoming as Record<string, unknown> | null;
  if (up) {
    console.log(`\n══ LO QUE VIENE ══`);
    const items = (up as any).items as any[];
    for (const item of items ?? []) {
      console.log(`  ${item.pattern} (${item.days_until}d)`);
      console.log(`  Acción: ${item.action}`);
      if (item.ready_copy) console.log(`  Copy: ${item.ready_copy}`);
    }
  }

  const sig = brief.section_signal as Record<string, unknown> | null;
  if (sig) {
    console.log(`\n══ LA SEÑAL ══`);
    console.log(`  ${sig.headline}`);
    console.log(`  ${sig.market_context}`);
    console.log(`  Para tu tienda: ${sig.store_implication}`);
  }

  const gap = brief.section_gap as Record<string, unknown> | null;
  if (gap) {
    console.log(`\n══ LA BRECHA ══`);
    console.log(`  Gap: ${gap.gap}`);
    console.log(`  Oportunidad: ${gap.opportunity}`);
    console.log(`  Potencial: ${gap.estimated_upside}`);
  }

  const act = brief.section_activation as Record<string, unknown> | null;
  if (act) {
    console.log(`\n══ ACTIVACIÓN DE HOY ══`);
    console.log(`  Qué: ${act.what}`);
    console.log(`  Por qué: ${act.why}`);
    const how = act.how as string[];
    if (how) {
      console.log(`  Cómo:`);
      for (const step of how) console.log(`    → ${step}`);
    }
    console.log(`  Impacto: ${act.expected_impact}`);
  }

  // Audit notes
  if (brief.audit_notes) {
    console.log(`\n══ NOTAS DEL AUDITOR ══`);
    console.log(brief.audit_notes);
  }

  // 2. ACCIONES GENERADAS
  const { data: actions } = await supabase
    .from('pending_actions')
    .select('*')
    .eq('account_id', acc.id)
    .eq('brief_id', brief.id)
    .order('created_at', { ascending: true });

  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`  ACCIONES GENERADAS: ${actions?.length ?? 0}`);
  console.log(`════════════════════════════════════════════════════════════`);

  for (const action of actions ?? []) {
    const content = action.content as Record<string, unknown>;
    console.log(`\n── [${action.type}] ${action.title} ──`);
    console.log(`  Descripción: ${action.description}`);
    console.log(`  Prioridad: ${content.priority} | Tiempo: ${content.time_estimate}`);
    console.log(`  Plan: ${content.plan_required ?? 'growth'}`);
    
    if (content.copy) console.log(`  Copy: ${content.copy}`);
    if (content.discount_code) console.log(`  Código: ${content.discount_code} (${content.discount_value}${content.discount_type === 'percentage' ? '%' : '€'})`);
    if (content.customer_email) console.log(`  Cliente: ${content.customer_name} <${content.customer_email}>`);
    if (content.customer_name && !content.customer_email) console.log(`  Cliente: ${content.customer_name}`);
    if (content.product) console.log(`  Producto: ${content.product}`);
    if (content.product_purchased) console.log(`  Producto comprado: ${content.product_purchased}`);
    if (content.checkout_url) console.log(`  Checkout: ${content.checkout_url}`);
    if (content.meta_description) console.log(`  Meta: ${content.meta_description}`);
    if (content.alt_text) console.log(`  Alt: ${content.alt_text}`);
    if (content.visual_concept) console.log(`  Visual: ${content.visual_concept}`);
    if (content.hashtags) console.log(`  Hashtags: ${content.hashtags}`);

    // Products array (cart_recovery)
    const products = content.products as any[] | undefined;
    if (products?.length) {
      console.log(`  Productos en carrito:`);
      for (const p of products) console.log(`    - ${p.title} x${p.quantity} — €${p.price}`);
    }

    // Recipients array (reactivation_email)
    const recipients = content.recipients as any[] | undefined;
    if (recipients?.length) {
      console.log(`  Destinatarios:`);
      for (const r of recipients) console.log(`    - ${r.name} <${r.email}> — último: ${r.last_product} (hace ${r.days_since} días)`);
    }
  }

  // Summary of action types
  const typeCounts: Record<string, number> = {};
  for (const a of actions ?? []) {
    typeCounts[a.type] = (typeCounts[a.type] || 0) + 1;
  }
  console.log(`\n══ RESUMEN DE TIPOS ══`);
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`  ${type}: ${count}`);
  }

  const newTypes = ['cart_recovery', 'welcome_email', 'reactivation_email'];
  const hasNew = newTypes.some(t => typeCounts[t]);
  console.log(`\n¿Genera acciones nuevas (cart_recovery/welcome/reactivation)? ${hasNew ? '✅ SÍ' : '❌ NO'}`);
}

main().catch(e => { console.error(e); process.exit(1); });
