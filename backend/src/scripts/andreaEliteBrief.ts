import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { analyzeBrand } from '../services/brandAnalyzer.js';
import { generateBrief } from '../services/briefGenerator.js';

const ACCOUNT_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

async function main() {
  console.log('=== ELITE GROWTH HACKER — INTERNAL TEST (NO SEND) ===\n');

  // Step 1: Regenerate brand profile with competitor analysis
  console.log('── STEP 1: Brand Analysis (with competitor differentiation) ──');
  const profile = await analyzeBrand(ACCOUNT_ID);
  console.log(`  Voice: ${profile.brand_voice}`);
  console.log(`  Values: ${profile.brand_values}`);
  console.log(`  Emotion: ${profile.brand_emotion}`);
  console.log(`  Content style: ${profile.content_style}`);
  console.log(`  Target audience: ${profile.target_audience}`);
  console.log(`  USPs: ${profile.unique_selling_points}`);
  console.log(`  Differentiation: ${profile.competitor_differentiation}`);

  // Step 2: Delete existing brief and regenerate with elite pipeline
  console.log('\n── STEP 2: Generate Brief with Elite Pipeline ──');
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const briefDate = yesterday.toISOString().slice(0, 10);

  const { data: existingBrief } = await supabase
    .from('intelligence_briefs')
    .select('id')
    .eq('account_id', ACCOUNT_ID)
    .eq('brief_date', briefDate)
    .maybeSingle();

  if (existingBrief) {
    await supabase.from('pending_actions').delete().eq('brief_id', existingBrief.id);
    await supabase.from('intelligence_briefs').delete().eq('id', existingBrief.id);
    console.log(`Deleted existing brief ${existingBrief.id}`);
  }

  await generateBrief({ accountId: ACCOUNT_ID, briefDate });

  // Step 3: Show full results
  const { data: newBrief } = await supabase
    .from('intelligence_briefs')
    .select('*')
    .eq('account_id', ACCOUNT_ID)
    .eq('brief_date', briefDate)
    .single();

  if (!newBrief) { console.log('Brief not found'); return; }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  BRIEF (${newBrief.status}) — ${newBrief.total_tokens} tokens`);
  console.log(`${'═'.repeat(60)}`);

  const y = newBrief.section_yesterday as Record<string, unknown>;
  console.log(`\n── YESTERDAY SUMMARY ──\n${y?.summary}`);

  const worked = newBrief.section_whats_working as { items: Array<{ insight: string }> };
  console.log(`\n── WHAT'S WORKING ──`);
  worked?.items?.forEach(i => console.log(i.insight));

  const notWorked = newBrief.section_whats_not_working as { items: Array<{ insight: string }> };
  console.log(`\n── WHAT'S NOT WORKING ──`);
  notWorked?.items?.forEach(i => console.log(i.insight));

  const signal = newBrief.section_signal as Record<string, unknown>;
  console.log(`\n── SIGNAL ──\n${signal?.market_context}`);

  const gap = newBrief.section_gap as Record<string, unknown>;
  console.log(`\n── GAP ──\n${gap?.gap}\nUpside: ${gap?.estimated_upside}`);

  const activation = newBrief.section_activation as Record<string, unknown>;
  console.log(`\n── ACTIVATION ──\nWhat: ${activation?.what}`);
  const howSteps = activation?.how as string[];
  howSteps?.forEach((h, i) => console.log(`  ${i + 1}. ${h}`));

  // Show all actions with full copy
  const { data: actions } = await supabase
    .from('pending_actions')
    .select('type, title, description, content')
    .eq('brief_id', newBrief.id);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ACTIONS (${actions?.length ?? 0})`);
  console.log(`${'═'.repeat(60)}`);
  actions?.forEach((a, i) => {
    console.log(`\n${i + 1}. [${a.type}] ${a.title}`);
    console.log(`   ${a.description}`);
    const c = a.content as Record<string, unknown>;
    if (c?.copy) console.log(`\n   📝 COPY:\n   ${c.copy}`);
    if (c?.discount_code) console.log(`   🏷️  Code: ${c.discount_code} (${c.discount_percentage}% off ${c.discount_product})`);
    if (c?.email_subject) console.log(`   ✉️  Subject: ${c.email_subject}`);
    if (c?.email_body) console.log(`   ✉️  Body: ${c.email_body}`);
    if (c?.seo_new_value) console.log(`   🔍 SEO: ${c.seo_field} → ${c.seo_new_value}`);
    if (c?.priority) console.log(`   ⚡ Priority: ${c.priority} | Time: ${c.time_estimate}`);
  });

  // Show audit notes if available
  const auditNotes = (newBrief as Record<string, unknown>).audit_notes;
  if (auditNotes) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  AUDIT NOTES`);
    console.log(`${'═'.repeat(60)}`);
    console.log(auditNotes);
  }

  console.log('\n⚠️  NO EMAIL SENT. NO PUSH SENT. Internal test only.');
  console.log('=== DONE ===');
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
