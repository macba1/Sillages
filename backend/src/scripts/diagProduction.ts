import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

async function main() {
  // 1. Get last 10 email_log entries with ALL columns
  const { data: logs, error } = await supabase
    .from('email_log')
    .select('*')
    .order('sent_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('ERROR querying email_log:', error.message);
    return;
  }

  console.log('=== COLUMNS IN email_log ===');
  if (logs && logs.length > 0) {
    console.log(Object.keys(logs[0]).join(', '));
  } else {
    console.log('(no rows found)');
  }

  console.log('\n=== LAST 10 email_log ENTRIES ===');
  for (const l of logs ?? []) {
    console.log(JSON.stringify(l, null, 2));
    console.log('---');
  }

  // 2. Check if tracking columns exist
  const hasDelivered = logs?.[0] && 'delivered_at' in logs[0];
  const hasOpened = logs?.[0] && 'opened_at' in logs[0];
  const hasClicked = logs?.[0] && 'clicked_at' in logs[0];

  console.log('\n=== TRACKING COLUMNS ===');
  console.log(`delivered_at: ${hasDelivered ? 'EXISTS' : 'MISSING'}`);
  console.log(`opened_at: ${hasOpened ? 'EXISTS' : 'MISSING'}`);
  console.log(`clicked_at: ${hasClicked ? 'EXISTS' : 'MISSING'}`);

  // 3. Check if any email has tracking data
  if (hasDelivered || hasOpened || hasClicked) {
    const tracked = (logs ?? []).filter(l =>
      l.delivered_at || l.opened_at || l.clicked_at
    );
    console.log(`\nEmails with ANY tracking data: ${tracked.length}/${logs?.length ?? 0}`);
    for (const t of tracked) {
      console.log(`  ${t.recipient_email}: delivered=${t.delivered_at ?? 'null'} opened=${t.opened_at ?? 'null'} clicked=${t.clicked_at ?? 'null'}`);
    }
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
