import { openai } from '../lib/openai.js';
import { supabase } from '../lib/supabase.js';
import { buildSystemPrompt, buildUserPrompt } from '../prompts/briefPrompt.js';
import type {
  Account,
  UserIntelligenceConfig,
  ShopifyDailySnapshot,
  SectionYesterday,
  SectionWhatsWorking,
  SectionWhatsNotWorking,
  SectionSignal,
  SectionGap,
  SectionActivation,
} from '../types.js';

interface GenerateBriefInput {
  accountId: string;
  briefDate: string; // YYYY-MM-DD (the date being covered — yesterday)
}

interface BriefSections {
  section_yesterday: SectionYesterday;
  section_whats_working: SectionWhatsWorking;
  section_whats_not_working: SectionWhatsNotWorking;
  section_signal: SectionSignal;
  section_gap: SectionGap;
  section_activation: SectionActivation;
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

    const ownerName = account.full_name?.split(' ')[0] ?? account.email.split('@')[0];

    // ── 3. Load shop name from connection ────────────────────────────────
    const { data: connection } = await supabase
      .from('shopify_connections')
      .select('shop_name, shop_domain')
      .eq('account_id', accountId)
      .single();

    const storeName = connection?.shop_name ?? connection?.shop_domain ?? 'your store';

    // ── 4. Call GPT-4o ────────────────────────────────────────────────────
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        {
          role: 'user',
          content: buildUserPrompt({ ownerName, storeName, snapshot, config, briefDate }),
        },
      ],
    });

    const rawContent = completion.choices[0]?.message?.content;
    if (!rawContent) {
      throw new Error('OpenAI returned empty content');
    }

    const sections = JSON.parse(rawContent) as BriefSections;

    // Validate required keys exist
    const requiredKeys: (keyof BriefSections)[] = [
      'section_yesterday',
      'section_whats_working',
      'section_whats_not_working',
      'section_signal',
      'section_gap',
      'section_activation',
    ];
    for (const key of requiredKeys) {
      if (!sections[key]) {
        throw new Error(`GPT response missing section: ${key}`);
      }
    }

    // ── 5. Save brief ─────────────────────────────────────────────────────
    const { error: saveError } = await supabase
      .from('intelligence_briefs')
      .update({
        snapshot_id: snapshot.id,
        status: 'ready',
        generated_at: new Date().toISOString(),
        generation_error: null,
        section_yesterday: sections.section_yesterday,
        section_whats_working: sections.section_whats_working,
        section_whats_not_working: sections.section_whats_not_working,
        section_signal: sections.section_signal,
        section_gap: sections.section_gap,
        section_activation: sections.section_activation,
        model_used: completion.model,
        prompt_tokens: completion.usage?.prompt_tokens ?? null,
        completion_tokens: completion.usage?.completion_tokens ?? null,
        total_tokens: completion.usage?.total_tokens ?? null,
      })
      .eq('id', briefId);

    if (saveError) {
      throw new Error(`Failed to save brief: ${saveError.message}`);
    }

    console.log(`[briefGenerator] Brief ready — account ${accountId} date ${briefDate}`);
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
