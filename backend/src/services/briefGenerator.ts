import { supabase } from '../lib/supabase.js';
import { runAnalyst } from '../agents/analyst.js';
import { runGrowthHacker } from '../agents/growthHacker.js';
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
    });

    console.log(`[briefGenerator] Growth hacker complete — ${growthResult.output.actions.length} actions`);

    // ── 6. Map Growth Hacker output to brief sections ───────────────────
    // Build the brief sections from the narrative + analyst data
    const narrative = growthResult.output.brief_narrative;
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

    // section_upcoming: from analyst weekly patterns + narrative
    const bestDay = analyst.upcoming.best_day_this_week;
    const sectionUpcoming = {
      items: [{
        pattern: narrative.upcoming,
        days_until: 1,
        action: bestDay.recommended_product
          ? `${language === 'es' ? 'Preparar' : 'Prepare'} ${bestDay.recommended_product} ${language === 'es' ? 'para' : 'for'} ${bestDay.day}`
          : narrative.upcoming,
        ready_copy: growthResult.output.actions[0]?.content?.copy ?? '',
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
    const sectionGap = {
      gap: narrative.gap,
      opportunity: narrative.upcoming,
      estimated_upside: analyst.upcoming.best_day_this_week.expected_revenue > 0
        ? `+${cs}${analyst.upcoming.best_day_this_week.expected_revenue.toFixed(0)} ${language === 'es' ? 'esta semana' : 'this week'}`
        : '',
    };

    // section_activation: from the highest priority growth action
    const topAction = growthResult.output.actions[0];
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

    // Combine token usage from both agents
    const totalPromptTokens = analystResult.usage.prompt_tokens + growthResult.usage.prompt_tokens;
    const totalCompletionTokens = analystResult.usage.completion_tokens + growthResult.usage.completion_tokens;
    const totalTokens = analystResult.usage.total_tokens + growthResult.usage.total_tokens;

    // ── 7. Save brief ─────────────────────────────────────────────────────
    const { error: saveError } = await supabase
      .from('intelligence_briefs')
      .update({
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
        model_used: 'gpt-4o (analyst+growth)',
        prompt_tokens: totalPromptTokens,
        completion_tokens: totalCompletionTokens,
        total_tokens: totalTokens,
      })
      .eq('id', briefId);

    if (saveError) {
      throw new Error(`Failed to save brief: ${saveError.message}`);
    }

    console.log(`[briefGenerator] Brief ready — account ${accountId} date ${briefDate}`);

    // ── 8. Save pending actions ─────────────────────────────────────────
    if (growthResult.output.actions.length > 0) {
      const actionRows = growthResult.output.actions.map((a: GrowthAction) => ({
        account_id: accountId,
        brief_id: briefId,
        brief_date: briefDate,
        action_type: a.type,
        title: a.title,
        description: a.description,
        priority: a.priority,
        time_estimate: a.time_estimate,
        plan_required: a.plan_required,
        content: a.content,
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
