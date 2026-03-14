import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

async function main() {
  // 1. All accounts with config
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, email, full_name, language, subscription_status')
    .or('subscription_status.in.(active,trialing,beta),subscription_status.is.null');

  console.log('═══════════════════════════════════════════════════');
  console.log('  ACCOUNTS & CONFIG');
  console.log('═══════════════════════════════════════════════════');

  for (const acc of accounts ?? []) {
    const { data: config } = await supabase
      .from('user_intelligence_config')
      .select('send_hour, timezone, send_enabled, brief_tone, focus_areas')
      .eq('account_id', acc.id)
      .maybeSingle();

    const { data: conn } = await supabase
      .from('shopify_connections')
      .select('shop_domain, shop_name, token_status, token_failing_since, shop_currency')
      .eq('account_id', acc.id)
      .maybeSingle();

    const { data: pushSubs } = await supabase
      .from('push_subscriptions')
      .select('id')
      .eq('account_id', acc.id);

    console.log(`\n── ${acc.email} ──`);
    console.log(`  Name: ${acc.full_name}`);
    console.log(`  Language: ${acc.language}`);
    console.log(`  Subscription: ${acc.subscription_status ?? 'null'}`);
    console.log(`  Shop: ${conn?.shop_domain ?? 'NO CONNECTION'} (${conn?.shop_name ?? '-'})`);
    console.log(`  Token: ${conn?.token_status ?? 'N/A'}`);
    if (conn?.token_failing_since) console.log(`  Token failing since: ${conn.token_failing_since}`);
    console.log(`  Currency: ${conn?.shop_currency ?? '-'}`);
    console.log(`  Send enabled: ${config?.send_enabled ?? 'N/A'}`);
    console.log(`  Send hour: ${config?.send_hour ?? 'N/A'} (timezone: ${config?.timezone ?? 'N/A'})`);
    console.log(`  Brief tone: ${config?.brief_tone ?? '-'}`);
    console.log(`  Push subscriptions: ${pushSubs?.length ?? 0}`);
  }

  // 2. Last 5 briefs per account
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  LAST 5 BRIEFS PER ACCOUNT');
  console.log('═══════════════════════════════════════════════════');

  for (const acc of accounts ?? []) {
    const { data: briefs } = await supabase
      .from('intelligence_briefs')
      .select('id, brief_date, status, generated_at, generation_error, total_tokens')
      .eq('account_id', acc.id)
      .order('brief_date', { ascending: false })
      .limit(5);

    console.log(`\n── ${acc.email} ──`);
    if (!briefs || briefs.length === 0) {
      console.log('  No briefs found');
      continue;
    }

    for (const b of briefs) {
      // Check if email was sent
      let emailStatus = 'no email log table';
      try {
        const { data: emailLog } = await supabase
          .from('email_log')
          .select('id, sent_at')
          .eq('brief_id', b.id)
          .limit(1)
          .maybeSingle();
        emailStatus = emailLog ? `EMAIL SENT ${(emailLog.sent_at as string)?.slice(0, 16)}` : 'no email sent';
      } catch {
        // table may not exist
      }

      console.log(`  ${b.brief_date} | ${b.status} | tokens: ${b.total_tokens ?? '-'} | generated: ${(b.generated_at as string)?.slice(0, 16) ?? '-'} | ${emailStatus}`);
      if (b.generation_error) console.log(`    ERROR: ${(b.generation_error as string).slice(0, 120)}`);
    }
  }

  // 3. Recent admin alerts
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  RECENT ADMIN ALERTS');
  console.log('═══════════════════════════════════════════════════');

  try {
    const { data: alerts } = await supabase
      .from('admin_alerts')
      .select('alert_type, account_id, message, sent_at')
      .order('sent_at', { ascending: false })
      .limit(10);

    if (!alerts || alerts.length === 0) {
      console.log('  No admin alerts');
    } else {
      for (const a of alerts) {
        console.log(`  ${(a.sent_at as string)?.slice(0, 16)} | ${a.alert_type} | ${(a.message as string)?.slice(0, 100)}`);
      }
    }
  } catch {
    console.log('  admin_alerts table not available');
  }

  // 4. Last audit logs
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  LAST 3 AUDIT LOGS');
  console.log('═══════════════════════════════════════════════════');

  try {
    const { data: audits } = await supabase
      .from('audit_log')
      .select('ran_at, alerts_count, duration_ms, alerts')
      .order('ran_at', { ascending: false })
      .limit(3);

    if (!audits || audits.length === 0) {
      console.log('  No audit logs');
    } else {
      for (const a of audits) {
        console.log(`  ${(a.ran_at as string)?.slice(0, 16)} | ${a.alerts_count} alerts | ${a.duration_ms}ms`);
        const list = a.alerts as string[] | null;
        if (list) {
          list.forEach((msg: string) => console.log(`    → ${msg.slice(0, 120)}`));
        }
      }
    }
  } catch {
    console.log('  audit_log table not available');
  }
}

main().catch(e => console.error(e.message));
