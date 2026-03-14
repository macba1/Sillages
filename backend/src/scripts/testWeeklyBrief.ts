import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { generateWeeklyBrief } from '../services/weeklyBriefGenerator.js';

async function main() {
  // Find Andrea's account (NICOLINA / taart-madrid)
  const { data: account } = await supabase
    .from('accounts')
    .select('id, email, full_name')
    .eq('email', 'andrea@nicolina.es')
    .single();

  if (!account) {
    console.error('Account andrea@nicolina.es not found');
    process.exit(1);
  }

  console.log(`Found account: ${account.full_name} (${account.email}) — id: ${account.id}`);

  // Week ending yesterday (or last Sunday)
  const today = new Date();
  const dayOfWeek = today.getUTCDay(); // 0=Sun
  // Find last Sunday
  const lastSunday = new Date(today);
  lastSunday.setUTCDate(today.getUTCDate() - (dayOfWeek === 0 ? 7 : dayOfWeek));
  const weekEndDate = lastSunday.toISOString().slice(0, 10);

  console.log(`Generating weekly brief for week ending: ${weekEndDate}`);
  console.log('This will call OpenAI gpt-4o — may take 30-60 seconds...\n');

  const briefId = await generateWeeklyBrief(account.id, weekEndDate);

  console.log(`\n✅ Weekly brief generated — id: ${briefId}`);
  console.log(`Week end: ${weekEndDate}`);

  // Load and display the result
  const { data: brief } = await supabase
    .from('weekly_briefs')
    .select('*')
    .eq('id', briefId)
    .single();

  if (brief) {
    console.log(`\nStatus: ${brief.status}`);
    console.log(`Tokens: ${brief.total_tokens}`);

    const ss = brief.section_summary as any;
    if (ss?.summary) {
      console.log('\n═══ RESUMEN ═══');
      console.log(ss.summary);
    }
    if (ss?.revenue_analysis) {
      const rev = ss.revenue_analysis;
      console.log(`\nRevenue: ${rev.total_revenue} | Orders: ${rev.total_orders} | AOV: ${rev.avg_order_value}`);
      if (rev.vs_previous_week) {
        console.log(`vs prev week: revenue ${rev.vs_previous_week.revenue_pct}%, orders ${rev.vs_previous_week.orders_pct}%`);
      }
      console.log(`Best day: ${rev.best_day?.day} (${rev.best_day?.revenue})`);
      console.log(`Worst day: ${rev.worst_day?.day} (${rev.worst_day?.revenue})`);
      if (rev.narrative) console.log(`Narrative: ${rev.narrative}`);
    }

    const sc = brief.section_customers as any;
    if (sc?.top_customers?.length > 0) {
      console.log('\n═══ TOP CLIENTES ═══');
      for (const c of sc.top_customers) {
        console.log(`  ${c.name} — ${c.orders_this_week} pedidos, ${c.total_spent_this_week} gastado, fav: ${c.favorite_product} ${c.is_new ? '[NUEVO]' : ''}`);
      }
    }
    if (sc?.customer_insights) {
      const ci = sc.customer_insights;
      console.log(`\nClientes: ${ci.new_customers} nuevos, ${ci.returning_customers} recurrentes`);
      if (ci.lost_customers_names?.length > 0) console.log(`Perdidos: ${ci.lost_customers_names.join(', ')}`);
      if (ci.about_to_repeat?.length > 0) console.log(`A punto de repetir: ${ci.about_to_repeat.join(', ')}`);
      if (ci.narrative) console.log(`Narrative: ${ci.narrative}`);
    }

    const sp = brief.section_products as any;
    if (sp?.top_products?.length > 0) {
      console.log('\n═══ TOP PRODUCTOS ═══');
      for (const p of sp.top_products) {
        console.log(`  ${p.name} — ${p.units} uds, ${p.revenue} revenue, trend: ${p.trend}`);
      }
    }

    const sar = brief.section_actions_review as any;
    if (sar?.actions_review?.length > 0) {
      console.log('\n═══ ACCIONES EJECUTADAS ═══');
      for (const a of sar.actions_review) {
        console.log(`  [${a.type}] ${a.title}: ${a.result} — ${a.impact}`);
      }
    }

    const swp = brief.section_weekly_plan as any;
    if (swp?.weekly_plan) {
      console.log('\n═══ PLAN SEMANAL ═══');
      console.log(`Foco: ${swp.weekly_plan.focus}`);
      for (const d of swp.weekly_plan.actions ?? []) {
        console.log(`  ${d.day}: ${d.action} — ${d.why}`);
      }
    }
    if (swp?.patterns_discovered?.length > 0) {
      console.log('\n═══ PATRONES ═══');
      for (const p of swp.patterns_discovered) {
        console.log(`  • ${p}`);
      }
    }

    console.log('\n═══════════════════════════════════════');
    console.log('Brief generado pero NO enviado por email.');
    console.log('Para enviar: usar sendWeeklyBriefEmail(briefId)');
    console.log('El lunes 17 el scheduler lo enviará automáticamente.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
