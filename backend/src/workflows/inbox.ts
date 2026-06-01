/**
 * Inbox Workflow — classify, summarize, and draft replies for inbound emails.
 *
 * SubAgent A: Classifier (lead/merchant/support/spam)
 * SubAgent B: Summarizer + draft reply via GPT-4o
 * SubAgent C: Auto-actions (archive spam, link to leads/accounts)
 *
 * Feature flag: USE_DYNAMIC_INBOX=true
 * Cron: every 15 minutes
 */

import { supabase } from '../lib/supabase.js';
import { openai } from '../lib/openai.js';

const LOG = '[workflow:inbox]';

// ── Types ──────────────────────────────────────────────────────────────────

interface InboxRow {
  id: string;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  category: string | null;
  status: string;
  ai_summary: string | null;
  ai_draft_reply: string | null;
  lead_id: string | null;
  account_id: string | null;
  received_at: string;
}

export interface InboxWorkflowResult {
  processed: number;
  classified: { lead: number; merchant: number; support: number; spam: number };
  drafted: number;
  archived: number;
  errors: number;
  totalDuration_ms: number;
}

// ── Main entry ─────────────────────────────────────────────────────────────

export async function runInboxWorkflow(): Promise<InboxWorkflowResult> {
  const start = Date.now();
  console.log(`${LOG} Starting inbox workflow`);

  const result: InboxWorkflowResult = {
    processed: 0, classified: { lead: 0, merchant: 0, support: 0, spam: 0 },
    drafted: 0, archived: 0, errors: 0, totalDuration_ms: 0,
  };

  // Get unprocessed emails (no category yet)
  const { data: emails } = await supabase
    .from('inbox')
    .select('*')
    .is('category', null)
    .eq('status', 'unread')
    .order('received_at', { ascending: true })
    .limit(20);

  if (!emails || emails.length === 0) {
    console.log(`${LOG} No unprocessed emails`);
    result.totalDuration_ms = Date.now() - start;
    return result;
  }

  console.log(`${LOG} Processing ${emails.length} unread email(s)`);

  // Load known accounts and leads for cross-referencing
  const [{ data: accounts }, { data: leads }] = await Promise.all([
    supabase.from('accounts').select('id, email'),
    supabase.from('leads').select('id, shop_domain, contact_email, status'),
  ]);

  const accountEmails = new Map((accounts ?? []).map(a => [a.email.toLowerCase(), a.id]));
  const leadEmails = new Map((leads ?? []).filter(l => l.contact_email).map(l => [l.contact_email!.toLowerCase(), l]));

  // Process each email in parallel (max 5)
  const BATCH_SIZE = 5;
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(email => processEmail(email as InboxRow, accountEmails, leadEmails, result).catch(err => {
      console.error(`${LOG} Error processing ${email.from_email}: ${(err as Error).message}`);
      result.errors++;
    })));
  }

  result.processed = emails.length;
  result.totalDuration_ms = Date.now() - start;

  // Log to workflow_runs
  try {
    await supabase.from('workflow_runs').insert({
      workflow: 'inbox',
      started_at: new Date(start).toISOString(),
      duration_ms: result.totalDuration_ms,
      merchants_total: result.processed,
      merchants_succeeded: result.drafted,
      merchants_failed: result.errors,
      results: result,
    });
  } catch { /* non-fatal */ }

  console.log(`${LOG} Complete: processed:${result.processed} lead:${result.classified.lead} merchant:${result.classified.merchant} support:${result.classified.support} spam:${result.classified.spam} drafted:${result.drafted} archived:${result.archived} (${result.totalDuration_ms}ms)`);
  return result;
}

// ── Process single email ──────────────────────────────────────────────────

async function processEmail(
  email: InboxRow,
  accountEmails: Map<string, string>,
  leadEmails: Map<string, { id: string; shop_domain: string; status: string }>,
  result: InboxWorkflowResult,
): Promise<void> {
  const fromLower = email.from_email.toLowerCase();
  const bodyPreview = (email.body_text ?? '').slice(0, 2000);

  // ── SubAgent A: Classify ────────────────────────────────────────────────
  let category: string;
  let accountId: string | null = null;
  let leadId: string | null = null;

  // Fast classification: known email?
  if (accountEmails.has(fromLower)) {
    category = 'merchant';
    accountId = accountEmails.get(fromLower)!;
  } else if (leadEmails.has(fromLower)) {
    category = 'lead';
    leadId = leadEmails.get(fromLower)!.id;
  } else {
    // AI classification for unknown senders
    category = await classifyEmail(email.from_email, email.subject ?? '', bodyPreview);
  }

  result.classified[category as keyof typeof result.classified]++;

  // ── SubAgent C: Auto-actions ────────────────────────────────────────────
  if (category === 'spam') {
    await supabase.from('inbox').update({ category, status: 'archived' }).eq('id', email.id);
    result.archived++;
    console.log(`${LOG} [${email.from_email}] Classified as spam → archived`);
    return;
  }

  // If lead replied, update lead status
  if (category === 'lead' && leadId) {
    const lead = leadEmails.get(fromLower);
    if (lead && lead.status === 'contacted') {
      await supabase.from('leads').update({ status: 'responded' }).eq('id', leadId);
      console.log(`${LOG} [${email.from_email}] Lead responded → status updated`);
    }
  }

  // ── SubAgent B: Summarize + Draft ───────────────────────────────────────
  const { summary, draftReply } = await summarizeAndDraft(email, category, accountId);

  await supabase.from('inbox').update({
    category,
    ai_summary: summary,
    ai_draft_reply: draftReply,
    lead_id: leadId,
    account_id: accountId,
  }).eq('id', email.id);

  result.drafted++;
  console.log(`${LOG} [${email.from_email}] ${category} — "${summary?.slice(0, 60)}"`);
}

// ── SubAgent A: AI Classification ──────────────────────────────────────────

async function classifyEmail(from: string, subject: string, body: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 20,
      messages: [
        { role: 'system', content: 'Classify this email into exactly one category. Reply with ONLY the category word, nothing else.\nCategories: lead (someone asking about their store/business, potential customer), merchant (existing customer with question), support (billing/technical/cancel request), spam (promotional/irrelevant)' },
        { role: 'user', content: `From: ${from}\nSubject: ${subject}\nBody: ${body.slice(0, 500)}` },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim().toLowerCase() ?? 'support';
    if (['lead', 'merchant', 'support', 'spam'].includes(raw)) return raw;
    return 'support';
  } catch {
    return 'support'; // fail safe
  }
}

// ── SubAgent B: Summarize + Draft Reply ────────────────────────────────────

async function summarizeAndDraft(
  email: InboxRow,
  category: string,
  _accountId: string | null,
): Promise<{ summary: string; draftReply: string }> {
  const body = (email.body_text ?? '').slice(0, 3000);

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.5,
      max_tokens: 600,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are Tony's email assistant for Sillages (a Shopify analytics app).
Given an inbound email, produce:
1. A 1-line summary (max 80 chars)
2. A draft reply in the SAME language as the sender

Reply rules:
- Sign as "Tony"
- Be warm, helpful, concise
- If category is 'lead': mention Sillages benefits relevant to their pain
- If category is 'merchant': be supportive, offer help
- If category is 'support': acknowledge issue, promise follow-up
- Max 4 sentences

Return JSON: { "summary": "...", "draft_reply": "..." }`,
        },
        {
          role: 'user',
          content: `Category: ${category}\nFrom: ${email.from_name ?? email.from_email}\nSubject: ${email.subject}\nBody:\n${body}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as { summary?: string; draft_reply?: string };
    return {
      summary: parsed.summary ?? `Email from ${email.from_name ?? email.from_email}`,
      draftReply: parsed.draft_reply ?? '',
    };
  } catch {
    return {
      summary: `${category}: ${email.subject ?? 'No subject'}`,
      draftReply: '',
    };
  }
}
