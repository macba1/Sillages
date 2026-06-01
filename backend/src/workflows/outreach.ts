/**
 * Outreach Workflow — send personalized emails to top-scored leads.
 *
 * Selects top N leads with status='draft' (outreach message ready),
 * sends via Resend from tony@sillages.app, tracks delivery.
 *
 * Feature flag: USE_DYNAMIC_OUTREACH=true
 * Cron: 0 9 * * * (09:00 UTC daily)
 */

import { supabase } from '../lib/supabase.js';
import { resend } from '../lib/resend.js';
import { env } from '../config/env.js';

const LOG = '[workflow:outreach]';
const DAILY_CAP = parseInt(process.env.OUTREACH_DAILY_CAP ?? '20', 10);
const FROM = 'Tony <tony@sillages.app>';
const REPLY_TO = 'tony@sillages.app';

// ── Types ──────────────────────────────────────────────────────────────────

interface LeadRow {
  id: string;
  shop_domain: string;
  shop_name: string | null;
  contact_email: string | null;
  pain_score: number;
  pain_tags: string[];
  outreach_message: string;
  status: string;
  contacted_at: string | null;
}

export interface OutreachWorkflowResult {
  sent: number;
  skipped: number;
  bounced: number;
  errors: number;
  totalDuration_ms: number;
}

// ── Main entry ─────────────────────────────────────────────────────────────

export async function runOutreachWorkflow(): Promise<OutreachWorkflowResult> {
  const start = Date.now();
  console.log(`${LOG} Starting outreach workflow (cap=${DAILY_CAP})`);

  let sent = 0;
  let skipped = 0;
  let bounced = 0;
  let errors = 0;

  // Check how many already sent today
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { count: sentToday } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'contacted')
    .gte('contacted_at', todayStart.toISOString());

  const remaining = DAILY_CAP - (sentToday ?? 0);
  if (remaining <= 0) {
    console.log(`${LOG} Daily cap reached (${sentToday} sent today) — skipping`);
    return { sent: 0, skipped: 0, bounced: 0, errors: 0, totalDuration_ms: Date.now() - start };
  }

  // Select top leads ready for outreach
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'draft')
    .not('outreach_message', 'is', null)
    .not('contact_email', 'is', null)
    .order('pain_score', { ascending: false })
    .limit(remaining);

  if (!leads || leads.length === 0) {
    console.log(`${LOG} No leads ready for outreach`);
    return { sent: 0, skipped: 0, bounced: 0, errors: 0, totalDuration_ms: Date.now() - start };
  }

  console.log(`${LOG} ${leads.length} leads to contact (cap remaining: ${remaining})`);

  // Send in parallel (max 5 concurrent to avoid Resend rate limits)
  const BATCH_SIZE = 5;
  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batch = leads.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(lead => sendOutreachEmail(lead as LeadRow).catch(err => {
        console.warn(`${LOG} Send failed for ${lead.shop_domain}: ${(err as Error).message}`);
        errors++;
        return 'error' as const;
      })),
    );

    for (const result of results) {
      if (result === 'sent') sent++;
      else if (result === 'skipped') skipped++;
      else if (result === 'bounced') bounced++;
    }
  }

  const totalDuration = Date.now() - start;

  // Log to workflow_runs
  try {
    await supabase.from('workflow_runs').insert({
      workflow: 'outreach',
      started_at: new Date(start).toISOString(),
      duration_ms: totalDuration,
      merchants_total: leads.length,
      merchants_succeeded: sent,
      merchants_failed: errors,
      results: { sent, skipped, bounced, errors, dailyCap: DAILY_CAP },
    });
  } catch { /* non-fatal */ }

  console.log(`${LOG} Complete: sent:${sent} skipped:${skipped} bounced:${bounced} errors:${errors} (${totalDuration}ms)`);
  return { sent, skipped, bounced, errors, totalDuration_ms: totalDuration };
}

// ── Send single outreach email ─────────────────────────────────────────────

async function sendOutreachEmail(lead: LeadRow): Promise<'sent' | 'skipped' | 'bounced'> {
  if (!lead.contact_email || !lead.outreach_message) return 'skipped';

  // Skip if contacted in last 30 days
  if (lead.contacted_at) {
    const daysSince = (Date.now() - new Date(lead.contacted_at).getTime()) / 86400000;
    if (daysSince < 30) {
      console.log(`${LOG} [${lead.shop_domain}] Skipped — contacted ${Math.floor(daysSince)}d ago`);
      return 'skipped';
    }
  }

  // Generate subject from pain tags
  const subject = generateSubject(lead);

  try {
    const { data: sent, error: sendErr } = await resend.emails.send({
      from: FROM,
      to: lead.contact_email,
      reply_to: REPLY_TO,
      subject,
      html: buildOutreachHtml(lead),
      headers: {
        'List-Unsubscribe': `<mailto:tony@sillages.app?subject=unsubscribe&body=${encodeURIComponent(lead.shop_domain)}>`,
      },
    });

    if (sendErr || !sent) {
      console.warn(`${LOG} [${lead.shop_domain}] Resend error: ${(sendErr as Error)?.message}`);
      return 'bounced';
    }

    // Update lead status
    await supabase.from('leads').update({
      status: 'contacted',
      contacted_at: new Date().toISOString(),
    }).eq('id', lead.id);

    console.log(`${LOG} [${lead.shop_domain}] Sent to ${lead.contact_email} (score=${lead.pain_score})`);
    return 'sent';

  } catch (err) {
    console.error(`${LOG} [${lead.shop_domain}] Send error: ${(err as Error).message}`);
    return 'bounced';
  }
}

// ── Subject line generator ─────────────────────────────────────────────────

function generateSubject(lead: LeadRow): string {
  const tags = lead.pain_tags ?? [];
  const name = lead.shop_name ?? lead.shop_domain.split('.')[0];

  if (tags.includes('no_email_capture')) return `${name} — you're missing email signups`;
  if (tags.includes('high_aov')) return `${name} — recovering one cart could mean $50+`;
  if (tags.includes('no_urgency_pricing')) return `Quick thought about ${name}`;
  if (tags.includes('no_reviews')) return `${name} — social proof idea`;
  return `Quick idea for ${name}`;
}

// ── HTML email builder (simple, personal) ──────────────────────────────────

function buildOutreachHtml(lead: LeadRow): string {
  // Convert line breaks in outreach_message to <br>
  const body = lead.outreach_message
    .replace(/\n\n/g, '</p><p style="margin:0 0 16px;font-size:15px;color:#2A1F14;line-height:1.7;">')
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F7F1EC;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F1EC;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <tr><td style="color:#2A1F14;font-size:15px;line-height:1.7;">
          <p style="margin:0 0 16px;font-size:15px;color:#2A1F14;line-height:1.7;">${body}</p>
        </td></tr>
        <tr><td style="padding-top:32px;border-top:1px solid #E8DDD6;">
          <p style="margin:0;color:#8B6F7A;font-size:13px;">
            <a href="https://sillages.app" style="color:#8B6F7A;text-decoration:none;">sillages.app</a> — Daily AI brief for Shopify stores
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
