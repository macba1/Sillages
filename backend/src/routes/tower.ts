import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { supabase } from '../lib/supabase.js';
import { getEligibleMerchants } from '../services/eligibleMerchants.js';

const router = Router();

const ADMIN_EMAILS = ['tony@richmondpartner.com', 'tony@bitext.com'];

async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    const { data: account, error } = await supabase
      .from('accounts')
      .select('email')
      .eq('id', req.accountId!)
      .single();

    if (error || !account) throw new AppError(403, 'Forbidden');
    if (!ADMIN_EMAILS.includes(account.email)) throw new AppError(403, 'Forbidden');
    next();
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/tower — Control Tower data for all 7 agents
// ═══════════════════════════════════════════════════════════════════════════

router.get('/', requireAuth, requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const twentyFourHoursAgo = new Date(Date.now() - 86400000).toISOString();
    const fortyEightHoursAgo = new Date(Date.now() - 2 * 86400000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    // ── Parallel queries ──────────────────────────────────────────────────
    const [
      accountsResult,
      connectionsResult,
      subscriptionsResult,
      briefsRecentResult,
      emailsTodayResult,
      errorsResult,
      locksResult,
      actionsResult,
      snapshotsResult,
      configsResult,
    ] = await Promise.all([
      supabase.from('accounts').select('id, email, full_name, subscription_status, created_at'),
      supabase.from('shopify_connections').select('account_id, shop_domain, shop_name, token_status, sync_status, last_synced_at'),
      supabase.from('account_subscriptions').select('account_id, plan_id, status, is_beta'),
      supabase.from('intelligence_briefs').select('id, account_id, brief_date, created_at').gte('created_at', fortyEightHoursAgo).order('created_at', { ascending: false }),
      supabase.from('email_log').select('id, account_id, channel, status').gte('sent_at', new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()),
      supabase.from('email_log').select('id, status').eq('status', 'failed').gte('sent_at', twentyFourHoursAgo),
      supabase.from('scheduler_locks').select('lock_name, acquired_at, expires_at'),
      supabase.from('pending_actions').select('id, account_id, type, status, created_at').eq('status', 'pending').order('created_at', { ascending: false }).limit(20),
      supabase.from('shopify_daily_snapshots').select('account_id, snapshot_date, total_revenue, total_orders').gte('snapshot_date', twoDaysAgo).order('snapshot_date', { ascending: false }),
      supabase.from('user_intelligence_config').select('account_id, send_enabled, send_hour, timezone'),
    ]);

    // Filter out Shopify reviewers and testers — not real merchants
    const GHOST_EMAILS = new Set([
      'reviewer@sillages.app',
      'purposeapp.tester7@shopify.com',
      'app.tester58@shopify.com',
    ]);
    const accounts = (accountsResult.data ?? []).filter(a => !GHOST_EMAILS.has(a.email));
    const connections = connectionsResult.data ?? [];
    const subscriptions = subscriptionsResult.data ?? [];
    const briefsRecent = briefsRecentResult.data ?? [];
    const emailsToday = emailsTodayResult.data ?? [];
    const errors24h = errorsResult.data ?? [];
    const locks = locksResult.data ?? [];
    const pendingActions = actionsResult.data ?? [];
    const snapshots = snapshotsResult.data ?? [];
    const configs = configsResult.data ?? [];

    // ═════════════════════════════════════════════════════════════════════
    // AGENT 1: PRODUCTION HEALTH
    // ═════════════════════════════════════════════════════════════════════

    const invalidTokens = connections.filter(c => c.token_status !== 'active');
    const syncErrors = connections.filter(c => c.sync_status === 'error');
    const stuckLocks = locks.filter(l => new Date(l.expires_at) < now);

    const healthIssues: string[] = [];
    if (invalidTokens.length > 0) healthIssues.push(`${invalidTokens.length} invalid token(s)`);
    if (syncErrors.length > 0) healthIssues.push(`${syncErrors.length} sync error(s)`);
    if (stuckLocks.length > 0) healthIssues.push(`${stuckLocks.length} stuck lock(s)`);
    if (errors24h.length > 0) healthIssues.push(`${errors24h.length} failed email(s) in 24h`);

    const healthStatus = healthIssues.length === 0 ? 'ok' : healthIssues.length <= 2 ? 'warning' : 'critical';

    // Find last scheduler run by looking at most recent snapshot
    const latestSnapshot = snapshots[0];
    const lastSyncAgo = connections
      .filter(c => c.last_synced_at)
      .map(c => Date.now() - new Date(c.last_synced_at).getTime())
      .sort((a, b) => a - b)[0];

    const agent1 = {
      name: 'Production Health',
      status: healthStatus,
      lastCheck: now.toISOString(),
      data: {
        backend: 'up',
        tokens: {
          active: connections.filter(c => c.token_status === 'active').length,
          invalid: invalidTokens.length,
          details: invalidTokens.map(c => c.shop_domain),
        },
        syncErrors: syncErrors.map(c => ({ shop: c.shop_domain, accountId: c.account_id })),
        schedulerLocks: locks,
        stuckLocks: stuckLocks.length,
        lastSync: lastSyncAgo ? `${Math.round(lastSyncAgo / 60000)}m ago` : 'never',
        emailsToday: emailsToday.length,
        emailsFailed24h: errors24h.length,
        issues: healthIssues,
        connections: connections.map(c => ({
          shop: c.shop_domain,
          name: c.shop_name,
          tokenStatus: c.token_status,
          syncStatus: c.sync_status,
          lastSynced: c.last_synced_at,
        })),
      },
    };

    // ═════════════════════════════════════════════════════════════════════
    // AGENT 2: MERCHANT ACTIVATION
    // ═════════════════════════════════════════════════════════════════════

    const todayStr = now.toISOString().slice(0, 10);

    // Build merchant detail list
    const merchants = accounts.map(a => {
      const conn = connections.find(c => c.account_id === a.id);
      const sub = subscriptions.find(s => s.account_id === a.id);
      const config = configs.find(c => c.account_id === a.id);
      const hasBriefRecent = briefsRecent.some(b => b.account_id === a.id);
      const hasSnapshot = snapshots.some(s => s.account_id === a.id);

      // Funnel stage
      let stage: string;
      if (!conn) {
        stage = 'installed'; // has account but no shopify connection
      } else if (!hasSnapshot) {
        stage = 'connected'; // connected but no data synced yet
      } else if (!hasBriefRecent) {
        stage = 'synced'; // data synced but no brief in 48h
      } else {
        stage = 'active'; // has recent brief
      }

      // Suggested action for stuck merchants
      let action: string | null = null;
      if (stage === 'installed') action = 'Send reconnect link — store not connected';
      else if (stage === 'connected') action = 'Trigger manual sync — no data yet';
      else if (stage === 'synced') action = 'Check scheduler — data exists but no brief generated';

      return {
        id: a.id,
        email: a.email,
        name: a.full_name,
        shop: conn?.shop_domain ?? null,
        shopName: conn?.shop_name ?? null,
        plan: sub?.plan_id ?? 'none',
        isBeta: sub?.is_beta ?? false,
        status: a.subscription_status,
        stage,
        action,
        sendEnabled: config?.send_enabled ?? false,
        createdAt: a.created_at,
      };
    });

    // Funnel counts
    const funnel = {
      total: merchants.length,
      installed: merchants.filter(m => m.stage === 'installed').length,
      connected: merchants.filter(m => m.stage === 'connected').length,
      synced: merchants.filter(m => m.stage === 'synced').length,
      active: merchants.filter(m => m.stage === 'active').length,
    };

    const newToday = accounts.filter(a => a.created_at.startsWith(todayStr)).length;
    const stuck = merchants.filter(m => m.action !== null);

    const agent2 = {
      name: 'Merchant Activation',
      status: stuck.length === 0 ? 'ok' : stuck.length <= 2 ? 'warning' : 'critical',
      lastCheck: now.toISOString(),
      data: {
        funnel,
        newToday,
        merchants,
        stuck: stuck.map(m => ({ email: m.email, shop: m.shop, stage: m.stage, action: m.action })),
        pendingActions: pendingActions.length,
        recentBriefs: briefsRecent.map(b => ({
          accountId: b.account_id,
          date: b.brief_date,
          createdAt: b.created_at,
        })),
      },
    };

    // ═════════════════════════════════════════════════════════════════════
    // AGENTS 3-4, 7: PLACEHOLDER (Phase 3)
    // ═════════════════════════════════════════════════════════════════════

    const placeholder = (name: string, phase: number) => ({
      name,
      status: 'offline' as const,
      lastCheck: null,
      data: { message: `Coming in Phase ${phase}` },
    });

    // ═════════════════════════════════════════════════════════════════════
    // AGENT 5: GROWTH CONTENT
    // ═════════════════════════════════════════════════════════════════════

    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // Monday
    const weekEndDate5 = new Date(weekStart);
    weekEndDate5.setDate(weekEndDate5.getDate() + 6); // Sunday

    const { data: allContent } = await supabase
      .from('growth_content')
      .select('id, scheduled_date, platform, content, status, engagement')
      .gte('scheduled_date', weekStart.toISOString().slice(0, 10))
      .lte('scheduled_date', weekEndDate5.toISOString().slice(0, 10))
      .order('scheduled_date');

    const contentItems = allContent ?? [];
    const todayContent = contentItems.find(c => c.scheduled_date === todayStr) ?? null;
    const publishedThisWeek = contentItems.filter(c => c.status === 'published').length;

    // Also get today's post even if outside this week range
    let todayPost = todayContent;
    if (!todayPost) {
      const { data: tp } = await supabase
        .from('growth_content')
        .select('id, scheduled_date, platform, content, status, engagement')
        .eq('scheduled_date', todayStr)
        .maybeSingle();
      todayPost = tp;
    }

    const agent5 = {
      name: 'Growth Content',
      status: todayPost ? (todayPost.status === 'published' ? 'ok' : 'warning') : 'ok',
      lastCheck: now.toISOString(),
      data: {
        todayPost: todayPost ? {
          id: todayPost.id,
          platform: todayPost.platform,
          content: todayPost.content,
          status: todayPost.status,
          engagement: todayPost.engagement,
        } : null,
        weekCalendar: contentItems.map(c => ({
          id: c.id,
          date: c.scheduled_date,
          platform: c.platform,
          status: c.status,
          preview: c.content.slice(0, 80) + (c.content.length > 80 ? '...' : ''),
        })),
        publishedThisWeek,
        totalThisWeek: contentItems.length,
      },
    };

    // ═════════════════════════════════════════════════════════════════════
    // AGENT 6: AGENCY OUTREACH
    // ═════════════════════════════════════════════════════════════════════

    const { data: agencies } = await supabase
      .from('agency_outreach')
      .select('id, name, url, contact_name, contact_linkedin, status, last_contact, notes')
      .order('created_at');

    const agencyList = agencies ?? [];
    const contacted = agencyList.filter(a => a.status !== 'not_contacted').length;
    const responded = agencyList.filter(a => ['responded', 'demo', 'converted'].includes(a.status)).length;
    const demos = agencyList.filter(a => ['demo', 'converted'].includes(a.status)).length;
    const converted = agencyList.filter(a => a.status === 'converted').length;

    const agent6 = {
      name: 'Agency Outreach',
      status: agencyList.length === 0 ? 'offline' : (demos > 0 ? 'ok' : 'warning'),
      lastCheck: now.toISOString(),
      data: {
        total: agencyList.length,
        contacted,
        responded,
        demos,
        converted,
        agencies: agencyList.map(a => ({
          id: a.id,
          name: a.name,
          url: a.url,
          contactName: a.contact_name,
          contactLinkedin: a.contact_linkedin,
          status: a.status,
          lastContact: a.last_contact,
          notes: a.notes,
        })),
        suggestedMessage: `Hi [name], I built a Shopify app called Sillages that sends store owners a daily AI brief about their business. I think it could be a great fit for your e-commerce clients. Would you be open to a quick 15-minute demo? apps.shopify.com/sillages`,
      },
    };

    res.json({
      timestamp: now.toISOString(),
      agents: [
        agent1,
        agent2,
        placeholder('Customer Intelligence', 3),
        placeholder('Product Decision', 3),
        agent5,
        agent6,
        placeholder('Review & Trust', 3),
      ],
    });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/tower/content/:id/publish — Mark content as published
// ═══════════════════════════════════════════════════════════════════════════

router.post('/content/:id/publish', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { error } = await supabase
      .from('growth_content')
      .update({ status: 'published' })
      .eq('id', req.params.id);

    if (error) throw new AppError(500, error.message);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/tower/content/:id/engagement — Update engagement data
// ═══════════════════════════════════════════════════════════════════════════

router.post('/content/:id/engagement', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { error } = await supabase
      .from('growth_content')
      .update({ engagement: req.body })
      .eq('id', req.params.id);

    if (error) throw new AppError(500, error.message);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/tower/agency — Add new agency
// ═══════════════════════════════════════════════════════════════════════════

router.post('/agency', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, url, contact_name, contact_linkedin, notes } = req.body;
    if (!name) throw new AppError(400, 'Name required');

    const { data, error } = await supabase
      .from('agency_outreach')
      .insert({ name, url, contact_name, contact_linkedin, notes })
      .select('id')
      .single();

    if (error) throw new AppError(500, error.message);
    res.json({ ok: true, id: data.id });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/tower/agency/:id — Update agency status
// ═══════════════════════════════════════════════════════════════════════════

router.patch('/agency/:id', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updates: Record<string, unknown> = {};
    if (req.body.status) {
      updates.status = req.body.status;
      if (req.body.status !== 'not_contacted') {
        updates.last_contact = new Date().toISOString();
      }
    }
    if (req.body.notes !== undefined) updates.notes = req.body.notes;
    if (req.body.contact_name) updates.contact_name = req.body.contact_name;
    if (req.body.contact_linkedin) updates.contact_linkedin = req.body.contact_linkedin;
    if (req.body.url) updates.url = req.body.url;

    const { error } = await supabase
      .from('agency_outreach')
      .update(updates)
      .eq('id', req.params.id);

    if (error) throw new AppError(500, error.message);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/tower/command — Command Center data
// ═══════════════════════════════════════════════════════════════════════════

router.get('/command', requireAuth, requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(Date.now() - 86400000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

    const PLAN_PRICES: Record<string, number> = { basico: 19, crecimiento: 39, pro: 59 };

    // ── Parallel queries ──────────────────────────────────────────────────
    const [
      workflowRunsResult,
      accountsResult,
      subsResult,
      leadsResult,
      nurtureLogResult,
      workflowHistoryResult,
    ] = await Promise.all([
      supabase.from('workflow_runs').select('workflow, duration_ms, merchants_succeeded, merchants_failed, results, created_at').gte('created_at', twentyFourHoursAgo).order('created_at', { ascending: false }),
      supabase.from('accounts').select('id, email, full_name, subscription_status, trial_ends_at, created_at'),
      supabase.from('account_subscriptions').select('account_id, plan_id, status, is_beta, started_at'),
      supabase.from('leads').select('id, shop_domain, shop_name, category, pain_score, pain_tags, status, contact_email, outreach_message, contacted_at, created_at').order('pain_score', { ascending: false }).limit(200),
      supabase.from('nurture_log').select('account_id, day, sent_at'),
      supabase.from('workflow_runs').select('workflow, merchants_total, merchants_succeeded, merchants_failed, created_at').gte('created_at', thirtyDaysAgo).order('created_at', { ascending: true }),
    ]);

    const workflowRuns = workflowRunsResult.data ?? [];
    const accounts = accountsResult.data ?? [];
    const subs = subsResult.data ?? [];
    const leads = leadsResult.data ?? [];
    const nurtureLog = nurtureLogResult.data ?? [];
    const workflowHistory = workflowHistoryResult.data ?? [];

    // Filter ghosts
    const GHOST_EMAILS = new Set(['reviewer@sillages.app', 'purposeapp.tester7@shopify.com', 'app.tester58@shopify.com']);
    const realAccounts = accounts.filter(a => !GHOST_EMAILS.has(a.email));

    // ── SECTION 1: SISTEMA ──────────────────────────────────────────────
    const activeWorkflows = new Set(workflowRuns.filter(r => r.merchants_succeeded > 0).map(r => r.workflow)).size;
    const lastRun = workflowRuns[0]?.created_at ?? null;
    const errorsToday = workflowRuns.filter(r => r.merchants_failed > 0).length;
    // Token count from results (if stored)
    let tokensToday = 0;
    for (const run of workflowRuns) {
      const results = run.results as Record<string, unknown> | Array<Record<string, unknown>> | null;
      if (Array.isArray(results)) {
        for (const r of results) {
          const t = r.tokens as { total?: number } | undefined;
          if (t?.total) tokensToday += t.total;
        }
      }
    }

    const sistema = { activeWorkflows, lastRun, errorsToday, tokensToday };

    // ── SECTION 2: MERCHANTS ────────────────────────────────────────────
    // MRR: count all active subs with a paid plan (including beta — they use Pro-level features)
    const paidSubs = subs.filter(s => s.status === 'active' && PLAN_PRICES[s.plan_id]);
    const mrr = paidSubs.reduce((sum, s) => sum + (PLAN_PRICES[s.plan_id] ?? 0), 0);
    const mrrPaying = paidSubs.filter(s => !s.is_beta).reduce((sum, s) => sum + (PLAN_PRICES[s.plan_id] ?? 0), 0);
    const trialsActive = realAccounts.filter(a => a.subscription_status === 'trialing' && a.trial_ends_at && new Date(a.trial_ends_at) > now).length;
    const trialToPaidWeek = subs.filter(s => s.status === 'active' && !s.is_beta && s.started_at && new Date(s.started_at) > new Date(sevenDaysAgo)).length;
    const threeDaysFromNow = new Date(Date.now() + 3 * 86400000);
    const atRisk = realAccounts.filter(a => a.subscription_status === 'trialing' && a.trial_ends_at && new Date(a.trial_ends_at) < threeDaysFromNow && new Date(a.trial_ends_at) > now).length;

    const merchants = { mrr, mrrPaying, trialsActive, trialToPaidWeek, atRisk, total: realAccounts.length };

    // ── SECTION 3: OUTREACH CRM FUNNEL ──────────────────────────────────
    const statusCounts: Record<string, number> = { new: 0, draft: 0, contacted: 0, installed: 0, converted: 0, bounced: 0 };
    for (const l of leads) { statusCounts[l.status] = (statusCounts[l.status] ?? 0) + 1; }

    const funnel = {
      nuevo: statusCounts.new + statusCounts.draft,
      contactado: statusCounts.contacted,
      instalado: statusCounts.installed,
      convertido: statusCounts.converted,
      perdido: statusCounts.bounced,
    };

    const leadsTable = leads.map(l => ({
      id: l.id,
      shopName: l.shop_name ?? l.shop_domain,
      shopDomain: l.shop_domain,
      category: l.category,
      painScore: l.pain_score,
      painTags: l.pain_tags,
      status: l.status,
      contactEmail: l.contact_email,
      outreachPreview: l.outreach_message?.slice(0, 100) ?? null,
      outreachFull: l.outreach_message ?? null,
      contactedAt: l.contacted_at,
      createdAt: l.created_at,
    }));

    // ── SECTION 4: NURTURE PIPELINE ─────────────────────────────────────
    const nurturePipeline = realAccounts.map(a => {
      const installDate = a.created_at;
      const daysSinceInstall = Math.floor((Date.now() - new Date(installDate).getTime()) / 86400000);
      const sentDays = nurtureLog.filter(n => n.account_id === a.id).map(n => n.day);
      const sub = subs.find(s => s.account_id === a.id);
      const STEPS = [0, 2, 5, 10, 13];
      const timeline = STEPS.map(day => ({
        day,
        sent: sentDays.includes(day),
        current: day === Math.max(...STEPS.filter(d => d <= daysSinceInstall)),
      }));

      return {
        accountId: a.id,
        email: a.email,
        name: a.full_name,
        plan: sub?.plan_id ?? 'none',
        daysSinceInstall,
        timeline,
      };
    }).filter(m => m.daysSinceInstall <= 30); // only show first 30 days

    // ── SECTION 5: DAILY HISTORY (30 days) ──────────────────────────────
    const dailyHistory: Record<string, { leads: number; outreach: number }> = {};
    for (const run of workflowHistory) {
      const date = run.created_at.slice(0, 10);
      if (!dailyHistory[date]) dailyHistory[date] = { leads: 0, outreach: 0 };
      if (run.workflow === 'leads') dailyHistory[date].leads += run.merchants_succeeded;
      if (run.workflow === 'outreach') dailyHistory[date].outreach += run.merchants_succeeded;
    }
    const dailyChart = Object.entries(dailyHistory)
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // ── SECTION 6: BRIEF DELIVERY (today) ───────────────────────────────
    // What Tony needs daily: did the daily brief actually get EMAILED, to whom?
    const todayStr = now.toISOString().slice(0, 10);
    const midnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const eightDaysAgo = new Date(Date.now() - 8 * 86400000).toISOString();

    const [eligibleMerchants, dailySentResult, lastWeeklyResult] = await Promise.all([
      getEligibleMerchants(),
      supabase.from('email_log').select('account_id, status, sent_at, message_id').eq('channel', 'daily_brief').gte('sent_at', midnightUtc),
      supabase.from('email_log').select('sent_at').eq('channel', 'weekly_email').eq('status', 'sent').order('sent_at', { ascending: false }).limit(1).maybeSingle(),
    ]);

    const dailySent = dailySentResult.data ?? [];
    const sentByAccount = new Map(dailySent.map(e => [e.account_id, e]));

    const recipients = eligibleMerchants.map(m => {
      const row = sentByAccount.get(m.account_id);
      return {
        shop: m.shop,
        email: m.email,
        sent: !!row && row.status === 'sent',
        sentAt: row?.sent_at ?? null,
        messageId: row?.message_id ?? null,
        status: row?.status ?? 'not_sent',
      };
    });

    const sentCount = recipients.filter(r => r.sent).length;
    const lastWeeklyAt = lastWeeklyResult.data?.sent_at ?? null;
    const weeklyStale = lastWeeklyAt ? new Date(lastWeeklyAt) < new Date(eightDaysAgo) : eligibleMerchants.length > 0;

    const briefDelivery = {
      date: todayStr,
      expected: eligibleMerchants.length,
      sentCount,
      allSent: eligibleMerchants.length > 0 && sentCount === eligibleMerchants.length,
      recipients,
      lastWeeklyAt,
      weeklyStale,
    };

    res.json({
      timestamp: now.toISOString(),
      sistema,
      merchants,
      funnel,
      leadsTable,
      nurturePipeline,
      dailyChart,
      briefDelivery,
    });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// LEADS MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// MANUAL WORKFLOW TRIGGERS
// ═══════════════════════════════════════════════════════════════════════════

router.post('/leads/run-now', requireAuth, requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { runLeadsWorkflow } = await import('../workflows/leads.js');
    const result = await runLeadsWorkflow();
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

router.post('/outreach/run-now', requireAuth, requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { runOutreachWorkflow } = await import('../workflows/outreach.js');
    const result = await runOutreachWorkflow();
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

router.post('/nurture/run-now', requireAuth, requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { runNurtureWorkflow } = await import('../workflows/nurture.js');
    const result = await runNurtureWorkflow();
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// LEADS MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/tower/leads/import — Bulk import leads from domain list
router.post('/leads/import', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { domains, category, source } = req.body as { domains?: string[]; category?: string; source?: string };
    if (!domains || !Array.isArray(domains) || domains.length === 0) {
      throw new AppError(400, 'domains array required');
    }

    const { importLeads } = await import('../workflows/leads.js');
    const result = await importLeads(domains, category ?? 'unknown', source ?? 'manual');
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

// POST /api/tower/leads/analyze — Run pain analysis on new leads now
router.post('/leads/analyze', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { runLeadsWorkflow } = await import('../workflows/leads.js');
    const result = await runLeadsWorkflow();
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

// GET /api/tower/leads — List all leads with optional status filter
router.get('/leads', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;
    let query = supabase
      .from('leads')
      .select('*')
      .order('pain_score', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query.limit(100);
    if (error) throw new AppError(500, error.message);

    res.json({ leads: data ?? [], count: data?.length ?? 0 });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/tower/leads/:id — Update lead status (contacted, installed, converted)
router.patch('/leads/:id', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updates: Record<string, unknown> = {};
    if (req.body.status) {
      updates.status = req.body.status;
      if (req.body.status === 'contacted') {
        updates.contacted_at = new Date().toISOString();
      }
    }
    if (req.body.contact_email) updates.contact_email = req.body.contact_email;
    if (req.body.contact_linkedin) updates.contact_linkedin = req.body.contact_linkedin;
    if (req.body.category) updates.category = req.body.category;
    if (req.body.outreach_message !== undefined) updates.outreach_message = req.body.outreach_message;

    const { error } = await supabase.from('leads').update(updates).eq('id', req.params.id);
    if (error) throw new AppError(500, error.message);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// INBOX
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/tower/inbox — List inbox emails
router.get('/inbox', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;
    let query = supabase
      .from('inbox')
      .select('id, from_email, from_name, subject, category, status, ai_summary, received_at')
      .order('received_at', { ascending: false })
      .limit(100);

    if (status && status !== 'all') query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw new AppError(500, error.message);

    const unreadCount = (data ?? []).filter(e => e.status === 'unread').length;
    res.json({ emails: data ?? [], unreadCount });
  } catch (err) { next(err); }
});

// GET /api/tower/inbox/:id — Single email detail
router.get('/inbox/:id', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await supabase
      .from('inbox')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw new AppError(404, 'Email not found');

    // Mark as read
    if (data.status === 'unread') {
      await supabase.from('inbox').update({ status: 'read' }).eq('id', req.params.id);
    }

    res.json({ email: data });
  } catch (err) { next(err); }
});

// POST /api/tower/inbox/:id/reply — Send reply
router.post('/inbox/:id/reply', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message } = req.body as { message?: string };
    if (!message) throw new AppError(400, 'message required');

    const { data: email, error } = await supabase
      .from('inbox')
      .select('from_email, from_name, subject')
      .eq('id', req.params.id)
      .single();

    if (error || !email) throw new AppError(404, 'Email not found');

    const { resend } = await import('../lib/resend.js');
    await resend.emails.send({
      from: 'Tony <tony@sillages.app>',
      to: email.from_email,
      reply_to: 'tony@sillages.app',
      subject: `Re: ${email.subject ?? ''}`,
      html: `<div style="font-family:Georgia,serif;font-size:15px;color:#2A1F14;line-height:1.7;max-width:560px;">${message.replace(/\n/g, '<br>')}</div>`,
    });

    await supabase.from('inbox').update({ status: 'replied' }).eq('id', req.params.id);

    console.log(`[tower/inbox] Replied to ${email.from_email}`);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /api/tower/inbox/:id — Update status (archive, mark as lead)
router.patch('/inbox/:id', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updates: Record<string, unknown> = {};
    if (req.body.status) updates.status = req.body.status;
    if (req.body.category) updates.category = req.body.category;

    const { error } = await supabase.from('inbox').update(updates).eq('id', req.params.id);
    if (error) throw new AppError(500, error.message);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/tower/inbox/backfill — Import historical emails from Resend API
router.post('/inbox/backfill', requireAuth, requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { env: envConfig } = await import('../config/env.js');
    const axios = (await import('axios')).default;

    let imported = 0;
    let skipped = 0;
    const INBOUND_ADDRESSES = ['info@sillages.app', 'support@sillages.app', 'tony@sillages.app'];

    // Resend REST API — no SDK list method, use direct API
    try {
      const { data } = await axios.get('https://api.resend.com/emails', {
        headers: { Authorization: `Bearer ${envConfig.RESEND_API_KEY}` },
        params: { limit: 100 },
        timeout: 15000,
      });

      const emails = data?.data ?? [];

      for (const email of emails) {
        const to = (email.to ?? []) as string[];
        const from = (email.from ?? '') as string;

        // Filter: only emails SENT TO our inbound addresses
        const isInbound = to.some((addr: string) => INBOUND_ADDRESSES.some(ia => addr.toLowerCase().includes(ia)));
        if (!isInbound) continue;

        const fromRaw = from;
        const fromMatch = fromRaw.match(/<([^>]+)>/);
        const fromEmail = fromMatch ? fromMatch[1] : fromRaw.replace(/.*<|>.*/g, '').trim();
        const fromName = fromRaw.replace(/<[^>]+>/, '').trim().replace(/^"|"$/g, '') || null;

        const createdAt = (email.created_at as string) ?? new Date().toISOString();

        const { error } = await supabase.from('inbox').insert({
          from_email: fromEmail,
          from_name: fromName,
          subject: (email.subject as string) ?? null,
          body_text: null, // list API doesn't return body
          body_html: null,
          status: 'unread',
          received_at: createdAt,
        });

        if (error) {
          skipped++;
        } else {
          imported++;
        }
      }
    } catch (fetchErr) {
      console.warn(`[tower/inbox/backfill] Resend API error: ${(fetchErr as Error).message}`);
    }

    // Run classifier on newly imported emails
    let classified = 0;
    if (imported > 0) {
      try {
        const { runInboxWorkflow } = await import('../workflows/inbox.js');
        const result = await runInboxWorkflow();
        classified = result.drafted;
      } catch (err) {
        console.warn(`[tower/inbox/backfill] Classifier failed: ${(err as Error).message}`);
      }
    }

    console.log(`[tower/inbox/backfill] Imported: ${imported}, Skipped: ${skipped}, Classified: ${classified}`);
    res.json({ ok: true, imported, skipped, classified });
  } catch (err) { next(err); }
});

export default router;
