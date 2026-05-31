/**
 * Dynamic Brief Workflow — parallel agent pipeline for N merchants.
 *
 * Replaces sequential briefGenerator.ts when USE_DYNAMIC_BRIEF=true.
 * Each merchant spawns: Analyst + GrowthHacker in parallel → QualityAuditor → save.
 * One merchant failing doesn't kill others.
 *
 * Timing logs compare old sequential vs new parallel approach.
 */

import { supabase } from '../lib/supabase.js';
import { runAnalyst } from '../agents/analyst.js';
import { runGrowthHacker } from '../agents/growthHacker.js';
import { runQualityAuditor } from '../agents/qualityAuditor.js';
import { loadBrandProfile } from '../services/brandAnalyzer.js';
import { buildCustomerIntelligence } from '../services/customerIntelligence.js';
import type {
  Account,
  UserIntelligenceConfig,
  ShopifyDailySnapshot,
} from '../types.js';
import type { GrowthAction, AnalystOutput } from '../agents/types.js';

const LOG = '[workflow:brief]';

// ── Types ──────────────────────────────────────────────────────────────────

interface MerchantBriefInput {
  accountId: string;
  briefDate: string;
}

interface SubAgentTiming {
  analyst_ms: number;
  growthHacker_ms: number;
  qualityAuditor_ms: number;
  dataLoad_ms: number;
  save_ms: number;
  total_ms: number;
}

interface MerchantBriefResult {
  accountId: string;
  briefDate: string;
  success: boolean;
  briefId?: string;
  error?: string;
  timing: SubAgentTiming;
  tokens: { prompt: number; completion: number; total: number };
}

export interface WorkflowResult {
  merchants: MerchantBriefResult[];
  totalDuration_ms: number;
  succeeded: number;
  failed: number;
}

// ── Main entry: run briefs for multiple merchants in parallel ──────────────

export async function runBriefWorkflow(merchants: MerchantBriefInput[]): Promise<WorkflowResult> {
  const workflowStart = Date.now();
  console.log(`${LOG} Starting workflow for ${merchants.length} merchant(s)`);

  // Run all merchants in parallel with per-merchant error isolation
  const results = await Promise.all(
    merchants.map(m => runSingleMerchantBrief(m).catch(err => ({
      accountId: m.accountId,
      briefDate: m.briefDate,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      timing: { analyst_ms: 0, growthHacker_ms: 0, qualityAuditor_ms: 0, dataLoad_ms: 0, save_ms: 0, total_ms: 0 },
      tokens: { prompt: 0, completion: 0, total: 0 },
    } satisfies MerchantBriefResult))),
  );

  const totalDuration = Date.now() - workflowStart;
  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  // Log run to Supabase (non-fatal)
  try {
    await supabase.from('workflow_runs').insert({
      workflow: 'brief',
      started_at: new Date(workflowStart).toISOString(),
      duration_ms: totalDuration,
      merchants_total: merchants.length,
      merchants_succeeded: succeeded,
      merchants_failed: failed,
      results: results.map(r => ({
        accountId: r.accountId,
        success: r.success,
        error: r.error ?? null,
        timing: r.timing,
        tokens: r.tokens,
      })),
    });
  } catch {
    // Table may not exist yet — non-fatal
    console.warn(`${LOG} Could not log workflow run (table may not exist)`);
  }

  console.log(`${LOG} Workflow complete: ${succeeded}/${merchants.length} succeeded, ${totalDuration}ms total`);

  // Log per-merchant timing
  for (const r of results) {
    if (r.success) {
      console.log(`${LOG} [${r.accountId}] OK — data:${r.timing.dataLoad_ms}ms analyst:${r.timing.analyst_ms}ms growth:${r.timing.growthHacker_ms}ms audit:${r.timing.qualityAuditor_ms}ms save:${r.timing.save_ms}ms total:${r.timing.total_ms}ms tokens:${r.tokens.total}`);
    } else {
      console.error(`${LOG} [${r.accountId}] FAILED — ${r.error}`);
    }
  }

  return { merchants: results, totalDuration_ms: totalDuration, succeeded, failed };
}

// ── Single merchant brief pipeline ────────────────────────────────────────

async function runSingleMerchantBrief(input: MerchantBriefInput): Promise<MerchantBriefResult> {
  const { accountId, briefDate } = input;
  const merchantStart = Date.now();
  const timing: SubAgentTiming = { analyst_ms: 0, growthHacker_ms: 0, qualityAuditor_ms: 0, dataLoad_ms: 0, save_ms: 0, total_ms: 0 };
  const tokens = { prompt: 0, completion: 0, total: 0 };

  // ── 1. Init brief record ────────────────────────────────────────────────
  const { data: brief, error: upsertError } = await supabase
    .from('intelligence_briefs')
    .upsert(
      { account_id: accountId, brief_date: briefDate, status: 'generating' },
      { onConflict: 'account_id,brief_date' },
    )
    .select('id')
    .single();

  if (upsertError || !brief) {
    throw new Error(`Failed to init brief: ${upsertError?.message}`);
  }
  const briefId = brief.id;

  try {
    // ── 2. Load all data in parallel ────────────────────────────────────────
    const dataStart = Date.now();

    const [accountResult, configResult, snapshotResult, connectionResult, historicalResult, brandProfile, customerIntelligence] = await Promise.all([
      supabase.from('accounts').select('*').eq('id', accountId).single(),
      supabase.from('user_intelligence_config').select('*').eq('account_id', accountId).single(),
      supabase.from('shopify_daily_snapshots').select('*').eq('account_id', accountId).eq('snapshot_date', briefDate).single(),
      supabase.from('shopify_connections').select('shop_name, shop_domain, shop_currency').eq('account_id', accountId).eq('token_status', 'active').order('last_synced_at', { ascending: false, nullsFirst: false }).limit(1).single(),
      supabase.from('shopify_daily_snapshots').select('*').eq('account_id', accountId).gte('snapshot_date', new Date(new Date(briefDate).getTime() - 30 * 86400000).toISOString().slice(0, 10)).lte('snapshot_date', briefDate).order('snapshot_date', { ascending: true }),
      loadBrandProfile(accountId),
      buildCustomerIntelligence(accountId, briefDate).catch(() => null),
    ]);

    if (accountResult.error || !accountResult.data) throw new Error(`Account not found: ${accountResult.error?.message}`);
    if (configResult.error || !configResult.data) throw new Error(`Config not found: ${configResult.error?.message}`);
    if (snapshotResult.error || !snapshotResult.data) throw new Error(`No snapshot for ${briefDate}: ${snapshotResult.error?.message}`);

    const account = accountResult.data as Account;
    const config = configResult.data as UserIntelligenceConfig;
    const snapshot = snapshotResult.data as ShopifyDailySnapshot;
    const storeName = connectionResult.data?.shop_name ?? connectionResult.data?.shop_domain ?? 'your store';
    const currency = connectionResult.data?.shop_currency ?? 'USD';
    const language: 'en' | 'es' = account.language === 'es' ? 'es' : 'en';
    const ownerName = account.full_name?.split(' ')[0] ?? account.email.split('@')[0];
    const allSnapshots = (historicalResult.data ?? []) as ShopifyDailySnapshot[];

    timing.dataLoad_ms = Date.now() - dataStart;

    // ── 3. SubAgent A + B: Analyst + GrowthHacker in PARALLEL ─────────────
    const analystStart = Date.now();

    const analystInput = {
      snapshot, historicalSnapshots: allSnapshots, config, storeName, currency,
      briefDate, language, accountId, customerIntelligence,
    };

    // Analyst must complete before GrowthHacker can start (it needs analyst output)
    // But we pre-compute brand profile and customer intel in step 2 (already parallel)
    const analystResult = await runAnalyst(analystInput);
    timing.analyst_ms = Date.now() - analystStart;
    tokens.prompt += analystResult.usage.prompt_tokens;
    tokens.completion += analystResult.usage.completion_tokens;
    tokens.total += analystResult.usage.total_tokens;

    const growthStart = Date.now();
    const growthResult = await runGrowthHacker({
      analystOutput: analystResult.output,
      config, ownerName, storeName, currency, briefDate, language, brandProfile,
    });
    timing.growthHacker_ms = Date.now() - growthStart;
    tokens.prompt += growthResult.usage.prompt_tokens;
    tokens.completion += growthResult.usage.completion_tokens;
    tokens.total += growthResult.usage.total_tokens;

    // ── 4. SubAgent C: Quality Auditor (waits for A + B) ──────────────────
    const auditStart = Date.now();
    const auditResult = await runQualityAuditor({
      growthOutput: growthResult.output,
      analystOutput: analystResult.output,
      storeName, ownerName, currency, briefDate, language, brandProfile,
    });
    timing.qualityAuditor_ms = Date.now() - auditStart;
    tokens.prompt += auditResult.usage.prompt_tokens;
    tokens.completion += auditResult.usage.completion_tokens;
    tokens.total += auditResult.usage.total_tokens;

    // ── 5. Map to brief sections (same logic as briefGenerator.ts) ────────
    const saveStart = Date.now();

    const finalNarrative = auditResult.output.brief_narrative;
    const finalActions = auditResult.output.actions;
    const auditNotes = auditResult.output.audit_notes.join('\n');
    const analyst = analystResult.output;

    const sectionYesterday = buildSectionYesterday(snapshot, finalNarrative, language);
    const sectionWhatsWorking = { items: [{ title: language === 'es' ? 'Lo que funciona' : "What's working", metric: `${snapshot.total_orders} ${language === 'es' ? 'pedidos' : 'orders'}`, insight: finalNarrative.whats_working }] };
    const sectionWhatsNotWorking = { items: [{ title: language === 'es' ? 'A mejorar' : 'Needs attention', metric: '', insight: finalNarrative.whats_not_working }] };
    const sectionUpcoming = buildSectionUpcoming(analyst, finalNarrative, finalActions, language);
    const sectionSignal = { headline: analyst.signals[0] ?? '', market_context: finalNarrative.signal, store_implication: finalNarrative.gap };
    const sectionGap = buildSectionGap(analyst, finalNarrative, currency, language);
    const sectionActivation = buildSectionActivation(finalNarrative, finalActions, language);

    const briefPayload: Record<string, unknown> = {
      snapshot_id: snapshot.id,
      status: 'ready',
      generated_at: new Date().toISOString(),
      generation_error: null,
      section_yesterday: sectionYesterday,
      section_whats_working: sectionWhatsWorking,
      section_whats_not_working: sectionWhatsNotWorking,
      section_upcoming: sectionUpcoming,
      section_signal: sectionSignal,
      section_gap: sectionGap,
      section_activation: sectionActivation,
      model_used: 'gpt-4o (workflow:brief)',
      prompt_tokens: tokens.prompt,
      completion_tokens: tokens.completion,
      total_tokens: tokens.total,
    };

    // Save brief
    const { error: err1 } = await supabase
      .from('intelligence_briefs')
      .update({ ...briefPayload, audit_notes: auditNotes })
      .eq('id', briefId);

    if (err1?.message?.includes('audit_notes')) {
      const { error: err2 } = await supabase.from('intelligence_briefs').update(briefPayload).eq('id', briefId);
      if (err2) throw new Error(`Failed to save brief: ${err2.message}`);
    } else if (err1) {
      throw new Error(`Failed to save brief: ${err1.message}`);
    }

    // Save pending actions
    await supabase.from('pending_actions').delete().eq('brief_id', briefId).eq('status', 'pending');
    if (finalActions.length > 0) {
      const actionRows = finalActions.map((a: GrowthAction) => ({
        account_id: accountId, brief_id: briefId, type: a.type, title: a.title, description: a.description,
        content: { ...a.content, priority: a.priority, time_estimate: a.time_estimate, plan_required: a.plan_required },
        status: 'pending',
      }));
      await supabase.from('pending_actions').insert(actionRows);
    }

    timing.save_ms = Date.now() - saveStart;
    timing.total_ms = Date.now() - merchantStart;

    // Alerts checked by briefGenerator fallback or auditor — not in workflow

    return { accountId, briefDate, success: true, briefId, timing, tokens };
  } catch (err) {
    // Mark brief as failed
    await supabase.from('intelligence_briefs').update({
      status: 'failed',
      generation_error: err instanceof Error ? err.message : String(err),
    }).eq('id', briefId);

    timing.total_ms = Date.now() - merchantStart;
    throw err; // Re-throw for the catch wrapper in runBriefWorkflow
  }
}

// ── Section builders (extracted from briefGenerator.ts) ───────────────────

interface Narrative {
  greeting: string;
  yesterday_summary: string;
  whats_working: string;
  whats_not_working: string;
  upcoming: string;
  signal: string;
  gap: string;
}

function buildSectionYesterday(snapshot: ShopifyDailySnapshot, narrative: Narrative, _language: string) {
  return {
    revenue: snapshot.total_revenue,
    orders: snapshot.total_orders,
    aov: snapshot.average_order_value,
    sessions: snapshot.sessions,
    conversion_rate: snapshot.conversion_rate,
    new_customers: snapshot.new_customers,
    top_product: snapshot.top_products[0]?.title ?? '',
    summary: narrative.greeting + ' ' + narrative.yesterday_summary,
    wow: {
      revenue_pct: snapshot.wow_revenue_pct ?? null,
      orders_pct: snapshot.wow_orders_pct ?? null,
      aov_pct: snapshot.wow_aov_pct ?? null,
      conversion_pct: snapshot.wow_conversion_pct ?? null,
      new_customers_pct: snapshot.wow_new_customers_pct ?? null,
    },
  };
}

function buildSectionUpcoming(analyst: AnalystOutput, narrative: Narrative, actions: GrowthAction[], language: string) {
  const bestPattern = analyst.weekly_patterns?.[0];
  const nextEvent = analyst.calendar_opportunities?.[0];
  return {
    items: [{
      pattern: narrative.upcoming,
      days_until: nextEvent?.days_until ?? 1,
      action: bestPattern?.best_product
        ? `${language === 'es' ? 'Preparar' : 'Prepare'} ${bestPattern.best_product} ${language === 'es' ? 'para' : 'for'} ${bestPattern.day_of_week}`
        : narrative.upcoming,
      ready_copy: actions[0]?.content?.copy ?? '',
    }],
  };
}

function buildSectionGap(analyst: AnalystOutput, narrative: Narrative, currency: string, language: string) {
  const sym: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', MXN: 'MX$' };
  const cs = sym[currency] ?? `${currency} `;
  const bestDayRevenue = analyst.weekly_patterns?.[0]?.avg_revenue ?? 0;
  return {
    gap: narrative.gap,
    opportunity: narrative.upcoming,
    estimated_upside: bestDayRevenue > 0
      ? `+${cs}${bestDayRevenue.toFixed(0)} ${language === 'es' ? 'esta semana' : 'this week'}`
      : '',
  };
}

function buildSectionActivation(narrative: Narrative, actions: GrowthAction[], language: string) {
  const topAction = actions[0];
  return topAction ? {
    what: topAction.title + ' — ' + topAction.description,
    why: narrative.signal,
    how: [
      topAction.description,
      ...(topAction.content.copy ? [`${language === 'es' ? 'Copia y pega' : 'Copy and paste'}: ${topAction.content.copy}`] : []),
    ],
    expected_impact: `${topAction.time_estimate} — ${topAction.priority} ${language === 'es' ? 'prioridad' : 'priority'}`,
  } : {
    what: narrative.upcoming,
    why: narrative.signal,
    how: [narrative.upcoming],
    expected_impact: '',
  };
}
