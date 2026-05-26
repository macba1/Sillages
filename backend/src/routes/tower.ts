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
    // AGENTS 3-7: PLACEHOLDER (Phase 2+3)
    // ═════════════════════════════════════════════════════════════════════

    const placeholder = (name: string, phase: number) => ({
      name,
      status: 'offline',
      lastCheck: null,
      data: { message: `Coming in Phase ${phase}` },
    });

    res.json({
      timestamp: now.toISOString(),
      agents: [
        agent1,
        agent2,
        placeholder('Customer Intelligence', 3),
        placeholder('Product Decision', 3),
        placeholder('Growth Content', 2),
        placeholder('Agency Outreach', 2),
        placeholder('Review & Trust', 3),
      ],
    });
  } catch (err) {
    next(err);
  }
});

export default router;
