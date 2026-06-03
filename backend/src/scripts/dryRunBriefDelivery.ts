/**
 * DRY-RUN: brief delivery. READ-ONLY — sends nothing.
 *
 * Prints the eligible-merchant list and, for each, what the daily brief send
 * WOULD do (recipient, subject, gate result). Use before any real send.
 *
 *   node --env-file=.env node_modules/.bin/tsx src/scripts/dryRunBriefDelivery.ts
 */
import { supabase } from '../lib/supabase.js';
import { getEligibleMerchants } from '../services/eligibleMerchants.js';
import { canEmailMerchant } from '../services/commsGate.js';

async function main() {
  console.log('=== DRY-RUN brief delivery (no emails sent) ===\n');

  const merchants = await getEligibleMerchants();
  console.log(`Eligible merchants: ${merchants.length}`);
  for (const m of merchants) {
    console.log(`  • account=${m.account_id} shop=${m.shop} email=${m.email}`);
  }

  const hasAndrea = merchants.some(m => m.email === 'marketing@nicolina.es');
  const hasTestStore = merchants.some(m =>
    /sillagesdev|etw0qb-0c/.test(m.shop) || m.email.endsWith('@shopify.com') || m.email === 'reviewer@sillages.app');
  console.log(`\nAndrea (marketing@nicolina.es) included? ${hasAndrea ? 'YES ✓' : 'NO ✗'}`);
  console.log(`Any test store leaked in?            ${hasTestStore ? 'YES ✗' : 'NO ✓'}`);

  console.log('\n=== What the daily send WOULD do per merchant ===');
  for (const m of merchants) {
    // Latest ready/sent brief for this merchant.
    const { data: brief } = await supabase
      .from('intelligence_briefs')
      .select('id, brief_date, status, section_signal, section_yesterday, email_message_id')
      .eq('account_id', m.account_id)
      .order('brief_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    const emailable = await canEmailMerchant(m.email);

    if (!brief) {
      console.log(`  • ${m.shop} (${m.email}): no brief found`);
      continue;
    }
    const sig = (brief.section_signal as { headline?: string } | null)?.headline ?? '';
    const yest = (brief.section_yesterday as { summary?: string } | null)?.summary ?? '';
    const ownerName = m.email.split('@')[0];
    const subject = `${ownerName}, ${(sig || yest || 'Tu brief diario').slice(0, 60)}`;
    console.log(`  • ${m.shop} (${m.email})`);
    console.log(`      brief_date=${brief.brief_date} status=${brief.status} alreadySent=${brief.email_message_id ? 'yes' : 'no'}`);
    console.log(`      gate(canEmailMerchant)=${emailable ? 'PASS' : 'BLOCK'}`);
    console.log(`      subject="${subject}"`);
    const wouldSend = emailable && brief.status === 'ready';
    console.log(`      => WOULD SEND: ${wouldSend ? 'YES' : `NO (${!emailable ? 'gated' : `status=${brief.status}`})`}`);
  }
  console.log('\n=== END DRY-RUN (nothing was sent) ===');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
