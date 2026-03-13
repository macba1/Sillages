import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { analyzeBrand } from '../services/brandAnalyzer.js';
import { generateBrief } from '../services/briefGenerator.js';
import { sendBriefEmail } from '../services/emailSender.js';
import { sendPushNotification } from '../services/pushNotifier.js';

const ACCOUNT_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

async function main() {
  console.log('=== BRAND ANALYSIS + BRIEF FOR ANDREA ===\n');

  // Step 1: Generate brand profile
  console.log('── STEP 1: Brand Analysis ──');
  const profile = await analyzeBrand(ACCOUNT_ID);
  console.log('\nBrand Profile:');
  console.log(`  Voice: ${profile.brand_voice}`);
  console.log(`  Values: ${profile.brand_values}`);
  console.log(`  Emotion: ${profile.brand_emotion}`);
  console.log(`  Content style: ${profile.content_style}`);
  console.log(`  Target audience: ${profile.target_audience}`);
  console.log(`  USPs: ${profile.unique_selling_points}`);
  console.log(`  Differentiation: ${profile.competitor_differentiation}`);

  // Step 2: Delete existing brief and regenerate
  console.log('\n── STEP 2: Generate Brief with Brand Voice ──');
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

  // Step 3: Show results
  const { data: newBrief } = await supabase
    .from('intelligence_briefs')
    .select('*')
    .eq('account_id', ACCOUNT_ID)
    .eq('brief_date', briefDate)
    .single();

  if (!newBrief) { console.log('Brief not found'); return; }

  console.log(`\n=== BRIEF (${newBrief.status}) — ${newBrief.total_tokens} tokens ===`);

  const y = newBrief.section_yesterday as Record<string, unknown>;
  console.log(`\n--- SUMMARY ---\n${y?.summary}`);

  const worked = newBrief.section_whats_working as { items: Array<{ insight: string }> };
  console.log(`\n--- WHAT'S WORKING ---`);
  worked?.items?.forEach(i => console.log(i.insight));

  const notWorked = newBrief.section_whats_not_working as { items: Array<{ insight: string }> };
  console.log(`\n--- WHAT'S NOT WORKING ---`);
  notWorked?.items?.forEach(i => console.log(i.insight));

  const signal = newBrief.section_signal as Record<string, unknown>;
  console.log(`\n--- SIGNAL ---\n${signal?.market_context}`);

  const gap = newBrief.section_gap as Record<string, unknown>;
  console.log(`\n--- GAP ---\n${gap?.gap}\nUpside: ${gap?.estimated_upside}`);

  const activation = newBrief.section_activation as Record<string, unknown>;
  console.log(`\n--- ACTIVATION ---\nWhat: ${activation?.what}`);
  const howSteps = activation?.how as string[];
  howSteps?.forEach((h, i) => console.log(`  ${i + 1}. ${h}`));

  const { data: actions } = await supabase
    .from('pending_actions')
    .select('type, title, description, content')
    .eq('brief_id', newBrief.id);

  console.log(`\n--- ACTIONS (${actions?.length ?? 0}) ---`);
  actions?.forEach((a, i) => {
    console.log(`\n${i + 1}. [${a.type}] ${a.title}`);
    console.log(`   ${a.description}`);
    const c = a.content as Record<string, unknown>;
    if (c?.copy) console.log(`   COPY: ${c.copy}`);
  });

  // Step 4: Send
  console.log('\n── STEP 3: Sending ──');
  try {
    await sendBriefEmail(newBrief.id);
    console.log('Email sent');
  } catch (err: any) { console.log(`Email: ${err.message}`); }

  try {
    await sendPushNotification(ACCOUNT_ID, {
      title: 'Tu brief de hoy está listo',
      body: 'Toca para ver qué pasó ayer en tu tienda',
      url: '/dashboard',
    });
    console.log('Push sent');
  } catch (err: any) { console.log(`Push: ${err.message}`); }

  console.log('\n=== DONE ===');
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
