import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { generateBrief } from '../services/briefGenerator.js';
import { sendBriefEmail } from '../services/emailSender.js';
import { sendPushNotification } from '../services/pushNotifier.js';

const ACCOUNT_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

async function main() {
  // Delete existing brief for today's date so we can regenerate
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const briefDate = yesterday.toISOString().slice(0, 10);

  console.log(`=== Forcing new brief for Andrea — ${briefDate} ===\n`);

  // Delete existing brief and actions for this date
  const { data: existingBrief } = await supabase
    .from('intelligence_briefs')
    .select('id')
    .eq('account_id', ACCOUNT_ID)
    .eq('brief_date', briefDate)
    .maybeSingle();

  if (existingBrief) {
    await supabase.from('pending_actions').delete().eq('brief_id', existingBrief.id);
    await supabase.from('intelligence_briefs').delete().eq('id', existingBrief.id);
    console.log(`Deleted existing brief ${existingBrief.id} and its actions\n`);
  }

  // Generate new brief with full pipeline (Analyst → Growth Hacker → Quality Auditor)
  console.log('Running full pipeline...\n');
  await generateBrief({ accountId: ACCOUNT_ID, briefDate });

  // Fetch the new brief
  const { data: newBrief } = await supabase
    .from('intelligence_briefs')
    .select('*')
    .eq('account_id', ACCOUNT_ID)
    .eq('brief_date', briefDate)
    .single();

  if (!newBrief) {
    console.log('Brief not found after generation');
    return;
  }

  console.log(`\n=== BRIEF RESULT ===`);
  console.log(`Status: ${newBrief.status}`);
  console.log(`Model: ${newBrief.model_used}`);
  console.log(`Tokens: ${newBrief.total_tokens}`);

  console.log(`\n--- AUDIT NOTES ---`);
  console.log(newBrief.audit_notes || '(none)');

  console.log(`\n--- GREETING ---`);
  const yesterday_section = newBrief.section_yesterday as Record<string, unknown>;
  console.log(yesterday_section?.summary);

  console.log(`\n--- WHAT'S WORKING ---`);
  const worked = newBrief.section_whats_working as { items: Array<{ insight: string }> };
  worked?.items?.forEach(i => console.log(i.insight));

  console.log(`\n--- WHAT'S NOT WORKING ---`);
  const notWorked = newBrief.section_whats_not_working as { items: Array<{ insight: string }> };
  notWorked?.items?.forEach(i => console.log(i.insight));

  console.log(`\n--- SIGNAL ---`);
  const signal = newBrief.section_signal as Record<string, unknown>;
  console.log(signal?.market_context);

  console.log(`\n--- GAP ---`);
  const gap = newBrief.section_gap as Record<string, unknown>;
  console.log(gap?.gap);
  console.log(`Opportunity: ${gap?.opportunity}`);
  console.log(`Upside: ${gap?.estimated_upside}`);

  console.log(`\n--- ACTIVATION ---`);
  const activation = newBrief.section_activation as Record<string, unknown>;
  console.log(`What: ${activation?.what}`);
  console.log(`Why: ${activation?.why}`);
  const howSteps = activation?.how as string[];
  howSteps?.forEach((h, i) => console.log(`  ${i + 1}. ${h}`));

  // Fetch actions
  const { data: actions } = await supabase
    .from('pending_actions')
    .select('type, title, description, content')
    .eq('brief_id', newBrief.id);

  console.log(`\n--- ACTIONS (${actions?.length ?? 0}) ---`);
  actions?.forEach((a, i) => {
    console.log(`\n${i + 1}. [${a.type}] ${a.title}`);
    console.log(`   ${a.description}`);
    const content = a.content as Record<string, unknown>;
    if (content?.copy) console.log(`   Copy: ${content.copy}`);
  });

  // Send email
  console.log(`\n=== SENDING ===`);
  try {
    await sendBriefEmail(newBrief.id);
    console.log('Email sent');
  } catch (err: any) {
    console.log(`Email failed: ${err.message}`);
  }

  // Push
  try {
    await sendPushNotification(ACCOUNT_ID, {
      title: 'Tu brief de hoy está listo',
      body: 'Toca para leer lo que pasó ayer en tu tienda',
      url: '/dashboard',
    });
    console.log('Push sent');
  } catch (err: any) {
    console.log(`Push failed: ${err.message}`);
  }

  console.log('\n=== DONE ===');
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
