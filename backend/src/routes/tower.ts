import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { supabase } from '../lib/supabase.js';

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

export default router;
