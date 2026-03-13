import { supabase } from '../lib/supabase.js';
import { runAnalyst } from '../agents/analyst.js';
import { runGrowthHacker } from '../agents/growthHacker.js';
import { runQualityAuditor } from '../agents/qualityAuditor.js';
import { loadBrandProfile } from './brandAnalyzer.js';
import { buildCustomerIntelligence } from './customerIntelligence.js';
import { checkAlerts } from './alertEngine.js';
import type {
  Account,
  UserIntelligenceConfig,
  ShopifyDailySnapshot,
} from '../types.js';
import type { GrowthAction } from '../agents/types.js';

interface GenerateBriefInput {
  accountId: string;
  briefDate: string; // YYYY-MM-DD (the date being covered — yesterday)
}

export async function generateBrief(input: GenerateBriefInput): Promise<void> {
  const { accountId, briefDate } = input;

  // ── 1. Mark brief as generating ─────────────────────────────────────────
  const { data: brief, error: upsertError } = await supabase
    .from('intelligence_briefs')
    .upsert(
      {
        account_id: accountId,
        brief_date: briefDate,
        status: 'generating',
      },
      { onConflict: 'account_id,brief_date' },
    )
    .select('id')
    .single();

  if (upsertError || !brief) {
    throw new Error(`Failed to initialise brief record: ${upsertError?.message}`);
  }

  const briefId = brief.id;

  try {
    // ── 2. Load account + config + snapshot ───────────────────────────────
    const [accountResult, configResult, snapshotResult] = await Promise.all([
      supabase.from('accounts').select('*').eq('id', accountId).single(),
      supabase.from('user_intelligence_config').select('*').eq('account_id', accountId).single(),
      supabase
        .from('shopify_daily_snapshots')
        .select('*')
        .eq('account_id', accountId)
        .eq('snapshot_date', briefDate)
        .single(),
    ]);

    if (accountResult.error || !accountResult.data) {
      throw new Error(`Account not found: ${accountResult.error?.message}`);
    }
    if (configResult.error || !configResult.data) {
      throw new Error(`Config not found: ${configResult.error?.message}`);
    }
    if (snapshotResult.error || !snapshotResult.data) {
      throw new Error(
        `No Shopify snapshot for ${briefDate}: ${snapshotResult.error?.message}`,
      );
    }

    const account = accountResult.data as Account;
    const config = configResult.data as UserIntelligenceConfig;
    const snapshot = snapshotResult.data as ShopifyDailySnapshot;

    console.log(`[briefGenerator] account=${account.id} language=${account.language}`);

    const ownerName = account.full_name?.split(' ')[0] ?? account.email.split('@')[0];

    // ── 3. Load shop name from connection ────────────────────────────────
    const { data: connection } = await supabase
      .from('shopify_connections')
      .select('shop_name, shop_domain, shop_currency')
      .eq('account_id', accountId)
      .single();

    const storeName = connection?.shop_name ?? connection?.shop_domain ?? 'your store';
    const currency = connection?.shop_currency ?? 'USD';

    // ── 3b. Load last 30 days of snapshots for pattern analysis ─────────
    const language: 'en' | 'es' = account.language === 'es' ? 'es' : 'en';
    const thirtyDaysAgo = new Date(new Date(briefDate).getTime() - 30 * 86400000)
      .toISOString().slice(0, 10);

    const { data: historicalSnapshots } = await supabase
      .from('shopify_daily_snapshots')
      .select('*')
      .eq('account_id', accountId)
      .gte('snapshot_date', thirtyDaysAgo)
      .lte('snapshot_date', briefDate)
      .order('snapshot_date', { ascending: true });

    const allSnapshots = (historicalSnapshots ?? []) as ShopifyDailySnapshot[];
    console.log(`[briefGenerator] Loaded ${allSnapshots.length} snapshots for pattern analysis (${thirtyDaysAgo} → ${briefDate})`);

    // ── 3c. Load brand profile + customer intelligence in parallel ─────
    const [brandProfile, customerIntelligence] = await Promise.all([
      loadBrandProfile(accountId),
      buildCustomerIntelligence(accountId, briefDate).catch(err => {
        console.warn(`[briefGenerator] Customer intelligence failed (non-fatal): ${err instanceof Error ? err.message : err}`);
        return null;
      }),
    ]);

    if (brandProfile) {
      console.log(`[briefGenerator] Brand profile loaded — voice: ${brandProfile.brand_voice.slice(0, 60)}...`);
    } else {
      console.log(`[briefGenerator] No brand profile found — using default voice`);
    }

    if (customerIntelligence) {
      console.log(`[briefGenerator] Customer intelligence loaded — ${customerIntelligence.total_customers} customers, ${customerIntelligence.abandoned_carts.length} abandoned carts, ${customerIntelligence.star_customers.length} stars, ${customerIntelligence.lost_customers.length} lost`);
    } else {
      console.log(`[briefGenerator] No customer intelligence available`);
    }

    // ── 4. Agent 1: Analyst ─────────────────────────────────────────────
    console.log(`[briefGenerator] Running agent chain in language: ${language}`);

    const analystResult = await runAnalyst({
      snapshot,
      historicalSnapshots: allSnapshots,
      config,
      storeName,
      currency,
      briefDate,
      language,
      accountId,
      customerIntelligence,
    });

    console.log(`[briefGenerator] Analyst complete — ${analystResult.output.signals.length} signals`);

    // ── 5. Agent 2: Growth Hacker ───────────────────────────────────────
    const growthResult = await runGrowthHacker({
      analystOutput: analystResult.output,
      config,
      ownerName,
      storeName,
      currency,
      briefDate,
      language,
      brandProfile,
    });

    console.log(`[briefGenerator] Growth hacker complete — ${growthResult.output.actions.length} actions`);

    // ── 5b. Agent 3: Quality Auditor ──────────────────────────────────
    const auditResult = await runQualityAuditor({
      growthOutput: growthResult.output,
      analystOutput: analystResult.output,
      storeName,
      ownerName,
      currency,
      briefDate,
      language,
      brandProfile,
    });

    console.log(`[briefGenerator] Quality audit complete — passed=${auditResult.output.audit_passed}, ${auditResult.output.audit_notes.length} notes`);

    // Use the audited output (corrected if needed)
    const finalNarrative = auditResult.output.brief_narrative;
    const finalActions = auditResult.output.actions;
    const auditNotes = auditResult.output.audit_notes.join('\n');

    // ── 6. Map audited output to brief sections ─────────────────────────
    // Build the brief sections from the audited narrative + analyst data
    const narrative = finalNarrative;
    const analyst = analystResult.output;

    // section_yesterday: merge analyst numbers with narrative summary
    const sectionYesterday = {
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

    // section_whats_working: from narrative
    const sectionWhatsWorking = {
      items: [{
        title: language === 'es' ? 'Lo que funciona' : "What's working",
        metric: `${snapshot.total_orders} ${language === 'es' ? 'pedidos' : 'orders'}`,
        insight: narrative.whats_working,
      }],
    };

    // section_whats_not_working: from narrative
    const sectionWhatsNotWorking = {
      items: [{
        title: language === 'es' ? 'A mejorar' : 'Needs attention',
        metric: '',
        insight: narrative.whats_not_working,
      }],
    };

    // section_upcoming: from analyst weekly patterns + calendar + narrative
    const bestPattern = analyst.weekly_patterns?.[0];
    const nextEvent = analyst.calendar_opportunities?.[0];
    const sectionUpcoming = {
      items: [{
        pattern: narrative.upcoming,
        days_until: nextEvent?.days_until ?? 1,
        action: bestPattern?.best_product
          ? `${language === 'es' ? 'Preparar' : 'Prepare'} ${bestPattern.best_product} ${language === 'es' ? 'para' : 'for'} ${bestPattern.day_of_week}`
          : narrative.upcoming,
        ready_copy: finalActions[0]?.content?.copy ?? '',
      }],
    };

    // section_signal: from narrative
    const sectionSignal = {
      headline: analyst.signals[0] ?? '',
      market_context: narrative.signal,
      store_implication: narrative.gap,
    };

    // section_gap: from narrative + analyst
    const sym: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', MXN: 'MX$' };
    const cs = sym[currency] ?? `${currency} `;
    const bestDayRevenue = bestPattern?.avg_revenue ?? 0;
    const sectionGap = {
      gap: narrative.gap,
      opportunity: narrative.upcoming,
      estimated_upside: bestDayRevenue > 0
        ? `+${cs}${bestDayRevenue.toFixed(0)} ${language === 'es' ? 'esta semana' : 'this week'}`
        : '',
    };

    // section_activation: from the highest priority audited action
    const topAction = finalActions[0];
    const sectionActivation = topAction ? {
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

    // Combine token usage from all 3 agents
    const totalPromptTokens = analystResult.usage.prompt_tokens + growthResult.usage.prompt_tokens + auditResult.usage.prompt_tokens;
    const totalCompletionTokens = analystResult.usage.completion_tokens + growthResult.usage.completion_tokens + auditResult.usage.completion_tokens;
    const totalTokens = analystResult.usage.total_tokens + growthResult.usage.total_tokens + auditResult.usage.total_tokens;

    // ── 7. Save brief ─────────────────────────────────────────────────────
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
      model_used: 'gpt-4o (analyst+growth+audit)',
      prompt_tokens: totalPromptTokens,
      completion_tokens: totalCompletionTokens,
      total_tokens: totalTokens,
    };

    // Try saving with audit_notes — fallback without if column doesn't exist yet
    let saveError;
    const { error: err1 } = await supabase
      .from('intelligence_briefs')
      .update({ ...briefPayload, audit_notes: auditNotes })
      .eq('id', briefId);

    if (err1?.message?.includes('audit_notes')) {
      console.log(`[briefGenerator] audit_notes column not yet added — saving without it`);
      const { error: err2 } = await supabase
        .from('intelligence_briefs')
        .update(briefPayload)
        .eq('id', briefId);
      saveError = err2;
    } else {
      saveError = err1;
    }

    if (saveError) {
      throw new Error(`Failed to save brief: ${saveError.message}`);
    }

    if (auditNotes) {
      console.log(`[briefGenerator] Audit notes: ${auditNotes}`);
    }

    console.log(`[briefGenerator] Brief ready — account ${accountId} date ${briefDate}`);

    // ── 8. Save pending actions (using audited actions) ─────────────────
    if (finalActions.length > 0) {
      const actionRows = finalActions.map((a: GrowthAction) => ({
        account_id: accountId,
        brief_id: briefId,
        type: a.type,
        title: a.title,
        description: a.description,
        content: {
          ...a.content,
          priority: a.priority,
          time_estimate: a.time_estimate,
          plan_required: a.plan_required,
        },
        status: 'pending',
      }));

      const { error: actionsError } = await supabase
        .from('pending_actions')
        .insert(actionRows);

      if (actionsError) {
        // Non-fatal — brief is already saved
        console.warn(`[briefGenerator] Failed to save actions (non-fatal): ${actionsError.message}`);
      } else {
        console.log(`[briefGenerator] Saved ${actionRows.length} pending action(s)`);
      }
    }

    // ── 9. Check alerts ─────────────────────────────────────────────────
    try {
      const prevDate = new Date(briefDate);
      prevDate.setUTCDate(prevDate.getUTCDate() - 7);
      const prevDateStr = prevDate.toISOString().slice(0, 10);

      const { data: prevSnapshot } = await supabase
        .from('shopify_daily_snapshots')
        .select('*')
        .eq('account_id', accountId)
        .eq('snapshot_date', prevDateStr)
        .single();

      await checkAlerts(
        accountId,
        account.email,
        snapshot,
        prevSnapshot ?? null,
        language,
      );
    } catch (alertErr) {
      console.error(`[briefGenerator] Alert check failed (non-fatal): ${alertErr instanceof Error ? alertErr.message : alertErr}`);
    }
  } catch (err) {
    // ── Mark failed ───────────────────────────────────────────────────────
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from('intelligence_briefs')
      .update({ status: 'failed', generation_error: message })
      .eq('id', briefId);

    console.error(`[briefGenerator] Failed — account ${accountId}: ${message}`);
    throw err;
  }
}
