import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { supabase } from '../lib/supabase.js';
import { runSchedulerForced } from '../services/scheduler.js';
import { runAudit } from '../services/auditor.js';
import { sendPushNotification } from '../services/pushNotifier.js';
import { sendWeeklyBriefEmail } from '../services/weeklyEmailSender.js';
import { logCommunication } from '../services/commLog.js';

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

// POST /api/admin/run-scheduler
// Force-runs the brief pipeline for all send-enabled accounts, bypassing send_hour.
router.post('/run-scheduler', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log(`[admin] Force-running scheduler — requested by account ${req.accountId}`);
    const processed = await runSchedulerForced();
    console.log(`[admin] Scheduler force-run complete — processed ${processed.length} account(s): ${processed.join(', ')}`);
    res.json({ ok: true, processed, count: processed.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/run-auditor
// Force-runs the system auditor — checks briefs, tokens, stale actions, data freshness.
router.post('/run-auditor', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log(`[admin] Force-running auditor — requested by account ${req.accountId}`);
    await runAudit();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/status
// Returns full system status for the admin dashboard
router.get('/status', requireAuth, requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // 1. All accounts with their connection status
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, email, full_name, language, subscription_status, comms_approval')
      .or('subscription_status.in.(active,trialing,beta),subscription_status.is.null');

    const stores = [];
    for (const account of accounts ?? []) {
      // Connection info
      const { data: conn } = await supabase
        .from('shopify_connections')
        .select('shop_domain, shop_name, token_status, token_failing_since, token_retry_count')
        .eq('account_id', account.id)
        .maybeSingle();

      // Latest brief
      const { data: brief } = await supabase
        .from('intelligence_briefs')
        .select('brief_date, status, generated_at, generation_error')
        .eq('account_id', account.id)
        .order('brief_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Latest executed action
      const { data: lastAction } = await supabase
        .from('pending_actions')
        .select('type, title, status, executed_at')
        .eq('account_id', account.id)
        .not('executed_at', 'is', null)
        .order('executed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Pending actions count
      const { count: pendingCount } = await supabase
        .from('pending_actions')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', account.id)
        .eq('status', 'pending');

      // Push subscription count
      const { count: pushSubCount } = await supabase
        .from('push_subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', account.id);

      // Last communication from email_log
      let lastCommChannel: string | null = null;
      let lastCommStatus: string | null = null;
      let lastCommAt: string | null = null;
      try {
        const { data: commRow } = await supabase
          .from('email_log')
          .select('channel, status, sent_at')
          .eq('account_id', account.id)
          .order('sent_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (commRow) {
          const cr = commRow as Record<string, string>;
          lastCommChannel = cr.channel ?? null;
          lastCommStatus = cr.status ?? null;
          lastCommAt = cr.sent_at ?? null;
        }
      } catch {
        // table may not exist
      }

      // Last weekly brief
      let lastWeeklyWeek: string | null = null;
      let lastWeeklyStatus: string | null = null;
      let lastWeeklySentAt: string | null = null;
      try {
        const { data: weeklyRow } = await supabase
          .from('weekly_briefs')
          .select('week_start, week_end, status, sent_at')
          .eq('account_id', account.id)
          .order('week_end', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (weeklyRow) {
          const wr = weeklyRow as Record<string, string>;
          lastWeeklyWeek = `${wr.week_start}→${wr.week_end}`;
          lastWeeklyStatus = wr.status ?? null;
          lastWeeklySentAt = wr.sent_at ?? null;
        }
      } catch {
        // table may not exist
      }

      stores.push({
        account_id: account.id,
        email: account.email,
        name: account.full_name,
        subscription: account.subscription_status ?? 'null',
        comms_approval: account.comms_approval ?? 'manual',
        shop_domain: conn?.shop_domain ?? null,
        shop_name: conn?.shop_name ?? null,
        token_status: conn?.token_status ?? 'no_connection',
        token_failing_since: conn?.token_failing_since ?? null,
        last_brief_date: brief?.brief_date ?? null,
        last_brief_status: brief?.status ?? null,
        last_brief_generated_at: brief?.generated_at ?? null,
        last_brief_error: brief?.generation_error ?? null,
        last_action_type: lastAction?.type ?? null,
        last_action_title: lastAction?.title ?? null,
        last_action_executed: lastAction?.executed_at ?? null,
        pending_actions: pendingCount ?? 0,
        push_subscriptions: pushSubCount ?? 0,
        last_comm_channel: lastCommChannel,
        last_comm_status: lastCommStatus,
        last_comm_at: lastCommAt,
        last_weekly_week: lastWeeklyWeek,
        last_weekly_status: lastWeeklyStatus,
        last_weekly_sent_at: lastWeeklySentAt,
      });
    }

    // 2. Recent admin alerts
    let recentAlerts: Array<{ id: string; alert_type: string; account_id: string | null; message: string; sent_at: string }> = [];
    try {
      const { data } = await supabase
        .from('admin_alerts')
        .select('id, alert_type, account_id, message, sent_at')
        .order('sent_at', { ascending: false })
        .limit(20);
      recentAlerts = (data ?? []) as typeof recentAlerts;
    } catch {
      // table may not exist
    }

    // 3. Last audit run
    let lastAudit = null;
    try {
      const { data } = await supabase
        .from('audit_log')
        .select('ran_at, alerts_count, duration_ms')
        .order('ran_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      lastAudit = data;
    } catch {
      // table may not exist
    }

    // 4. Recent deliveries from email_log
    let recentDeliveries: Array<{
      account_email: string;
      channel: string;
      status: string;
      sent_at: string;
      error_message: string | null;
      brief_id: string | null;
      weekly_brief_id: string | null;
    }> = [];
    try {
      const { data: logs } = await supabase
        .from('email_log')
        .select('account_id, channel, status, sent_at, error_message, brief_id, weekly_brief_id')
        .order('sent_at', { ascending: false })
        .limit(20);

      if (logs && logs.length > 0) {
        // Join with account emails
        const accountIds = [...new Set(logs.map(l => l.account_id))];
        const { data: accs } = await supabase
          .from('accounts')
          .select('id, email')
          .in('id', accountIds);
        const emailMap = new Map((accs ?? []).map(a => [a.id, a.email]));

        recentDeliveries = logs.map(l => ({
          account_email: emailMap.get(l.account_id) ?? l.account_id,
          channel: l.channel,
          status: l.status,
          sent_at: l.sent_at,
          error_message: l.error_message ?? null,
          brief_id: l.brief_id ?? null,
          weekly_brief_id: l.weekly_brief_id ?? null,
        }));
      }
    } catch {
      // table may not exist
    }

    // 5. Pending comms count
    let pendingCommsCount = 0;
    try {
      const { count } = await supabase
        .from('pending_comms')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      pendingCommsCount = count ?? 0;
    } catch {
      // table may not exist
    }

    res.json({
      stores,
      recent_alerts: recentAlerts,
      last_audit: lastAudit,
      recent_deliveries: recentDeliveries,
      pending_comms_count: pendingCommsCount,
      server_time: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/actions — All actions across all accounts with full details
router.get('/actions', requireAuth, requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { data: actions } = await supabase
      .from('pending_actions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (!actions || actions.length === 0) {
      res.json({ actions: [] });
      return;
    }

    // Join with account info and shop info
    const accountIds = [...new Set(actions.map(a => a.account_id))];
    const [{ data: accounts }, { data: connections }] = await Promise.all([
      supabase.from('accounts').select('id, email, full_name').in('id', accountIds),
      supabase.from('shopify_connections').select('account_id, shop_name, shop_domain').in('account_id', accountIds),
    ]);

    const accountMap = new Map((accounts ?? []).map(a => [a.id, a]));
    const connMap = new Map((connections ?? []).map(c => [c.account_id, c]));

    const enriched = actions.map(action => ({
      ...action,
      account_email: accountMap.get(action.account_id)?.email ?? null,
      account_name: accountMap.get(action.account_id)?.full_name ?? null,
      shop_name: connMap.get(action.account_id)?.shop_name ?? null,
      shop_domain: connMap.get(action.account_id)?.shop_domain ?? null,
    }));

    res.json({ actions: enriched });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/actions/:id/approve — Admin approves and executes
router.put('/actions/:id/approve', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actionId = req.params.id;

    const { data: action, error: fetchError } = await supabase
      .from('pending_actions')
      .select('*')
      .eq('id', actionId)
      .single();

    if (fetchError || !action) throw new AppError(404, 'Action not found');
    if (action.status !== 'pending') throw new AppError(400, `Action is already ${action.status}`);

    // Mark as approved by admin
    await supabase
      .from('pending_actions')
      .update({
        status: 'completed',
        approved_at: new Date().toISOString(),
        executed_at: new Date().toISOString(),
        result: { approved_by: 'admin', note: 'Approved via admin panel' },
      })
      .eq('id', actionId);

    const { data: updated } = await supabase.from('pending_actions').select('*').eq('id', actionId).single();
    res.json({ action: updated });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/actions/:id/reject — Admin rejects
router.put('/actions/:id/reject', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actionId = req.params.id;

    const { data: action, error: fetchError } = await supabase
      .from('pending_actions')
      .select('id, status')
      .eq('id', actionId)
      .single();

    if (fetchError || !action) throw new AppError(404, 'Action not found');
    if (action.status !== 'pending') throw new AppError(400, `Action is already ${action.status}`);

    await supabase
      .from('pending_actions')
      .update({ status: 'rejected' })
      .eq('id', actionId);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/email-log — Full email tracking log
router.get('/email-log', requireAuth, requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { data: logs } = await supabase
      .from('email_log')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(50);

    if (!logs || logs.length === 0) {
      res.json({ logs: [] });
      return;
    }

    const accountIds = [...new Set(logs.map(l => l.account_id))];
    const [{ data: accounts }, { data: connections }] = await Promise.all([
      supabase.from('accounts').select('id, email, full_name').in('id', accountIds),
      supabase.from('shopify_connections').select('account_id, shop_name').in('account_id', accountIds),
    ]);

    const accountMap = new Map((accounts ?? []).map(a => [a.id, a]));
    const connMap = new Map((connections ?? []).map(c => [c.account_id, c]));

    const enriched = logs.map(log => ({
      ...log,
      account_email: accountMap.get(log.account_id)?.email ?? null,
      shop_name: connMap.get(log.account_id)?.shop_name ?? null,
    }));

    res.json({ logs: enriched });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/email-tracking — Enriched email log with delivery funnel + recovery stats
router.get('/email-tracking', requireAuth, requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { data: logs } = await supabase
      .from('email_log')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(100);

    if (!logs || logs.length === 0) {
      res.json({ logs: [], funnel: { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 }, recovery: { total_carts: 0, recovered: 0, revenue: 0 } });
      return;
    }

    // Enrich with account info
    const accountIds = [...new Set(logs.map(l => l.account_id))];
    const [{ data: accounts }, { data: connections }] = await Promise.all([
      supabase.from('accounts').select('id, email, full_name').in('id', accountIds),
      supabase.from('shopify_connections').select('account_id, shop_name').in('account_id', accountIds),
    ]);

    const accountMap = new Map((accounts ?? []).map(a => [a.id, a]));
    const connMap = new Map((connections ?? []).map(c => [c.account_id, c]));

    const enriched = logs.map(log => ({
      ...log,
      account_email: accountMap.get(log.account_id)?.email ?? null,
      shop_name: connMap.get(log.account_id)?.shop_name ?? null,
    }));

    // Compute funnel stats
    const funnel = {
      sent: logs.length,
      delivered: logs.filter(l => l.delivered_at).length,
      opened: logs.filter(l => l.opened_at).length,
      clicked: logs.filter(l => l.clicked_at).length,
      bounced: logs.filter(l => l.bounced_at).length,
    };

    // Recovery stats from abandoned_carts
    const { data: recoveryCarts } = await supabase
      .from('abandoned_carts')
      .select('recovered, recovery_revenue')
      .in('account_id', accountIds);

    const recovery = {
      total_carts: recoveryCarts?.length ?? 0,
      recovered: recoveryCarts?.filter(c => c.recovered).length ?? 0,
      revenue: recoveryCarts?.filter(c => c.recovered).reduce((sum, c) => sum + (c.recovery_revenue ?? 0), 0) ?? 0,
    };

    res.json({ logs: enriched, funnel, recovery });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PENDING COMMS — Admin approval gate for merchant communications
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/pending-comms — All pending communications
router.get('/pending-comms', requireAuth, requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { data: comms } = await supabase
      .from('pending_comms')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (!comms || comms.length === 0) {
      res.json({ comms: [] });
      return;
    }

    const accountIds = [...new Set(comms.map(c => c.account_id))];
    const [{ data: accounts }, { data: connections }] = await Promise.all([
      supabase.from('accounts').select('id, email, full_name').in('id', accountIds),
      supabase.from('shopify_connections').select('account_id, shop_name').in('account_id', accountIds),
    ]);

    const accountMap = new Map((accounts ?? []).map(a => [a.id, a]));
    const connMap = new Map((connections ?? []).map(c => [c.account_id, c]));

    const enriched = comms.map(c => ({
      ...c,
      account_email: accountMap.get(c.account_id)?.email ?? null,
      account_name: accountMap.get(c.account_id)?.full_name ?? null,
      shop_name: connMap.get(c.account_id)?.shop_name ?? null,
    }));

    res.json({ comms: enriched });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/pending-comms/:id/approve — Approve and execute the communication
router.put('/pending-comms/:id/approve', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const commId = req.params.id;

    const { data: comm, error: fetchError } = await supabase
      .from('pending_comms')
      .select('*')
      .eq('id', commId)
      .single();

    if (fetchError || !comm) throw new AppError(404, 'Pending comm not found');
    if (comm.status !== 'pending') throw new AppError(400, `Comm is already ${comm.status}`);

    // Actually send the communication
    if (comm.type === 'push') {
      await sendPushNotification(comm.account_id, comm.content as { title: string; body: string; url?: string });
      await logCommunication({
        account_id: comm.account_id,
        channel: comm.channel,
        status: 'sent',
      });
    } else if (comm.type === 'weekly_email') {
      const weeklyBriefId = (comm.content as { weekly_brief_id: string }).weekly_brief_id;
      await sendWeeklyBriefEmail(weeklyBriefId);
      await logCommunication({
        account_id: comm.account_id,
        weekly_brief_id: weeklyBriefId,
        channel: 'weekly_email',
        status: 'sent',
      });
    }

    await supabase
      .from('pending_comms')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: 'admin',
      })
      .eq('id', commId);

    console.log(`[admin] Approved and sent pending comm ${commId} (${comm.type}/${comm.channel})`);
    res.json({ ok: true, sent: true });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/pending-comms/:id/reject — Reject a pending communication
router.put('/pending-comms/:id/reject', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const commId = req.params.id;

    const { data: comm, error: fetchError } = await supabase
      .from('pending_comms')
      .select('id, status')
      .eq('id', commId)
      .single();

    if (fetchError || !comm) throw new AppError(404, 'Pending comm not found');
    if (comm.status !== 'pending') throw new AppError(400, `Comm is already ${comm.status}`);

    await supabase
      .from('pending_comms')
      .update({ status: 'rejected' })
      .eq('id', commId);

    console.log(`[admin] Rejected pending comm ${commId}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/accounts/:id/comms-approval — Toggle comms_approval for an account
router.put('/accounts/:id/comms-approval', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accountId = req.params.id;
    const { comms_approval } = req.body;

    if (!['manual', 'auto'].includes(comms_approval)) {
      throw new AppError(400, 'comms_approval must be "manual" or "auto"');
    }

    await supabase
      .from('accounts')
      .update({ comms_approval })
      .eq('id', accountId);

    console.log(`[admin] Set comms_approval=${comms_approval} for ${accountId}`);
    res.json({ ok: true, comms_approval });
  } catch (err) {
    next(err);
  }
});

export default router;
