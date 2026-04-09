import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { supabase } from '../lib/supabase.js';
import { runSchedulerForced } from '../services/scheduler.js';
import { runAudit } from '../services/auditor.js';

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
// ADMIN PANEL — MONITORING ONLY
// Tony does NOT approve actions. Merchants manage their own actions from PWA.
// Admin panel shows: store health, metrics, alerts, orchestrator logs.
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/admin/run-scheduler
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
router.post('/run-auditor', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log(`[admin] Force-running auditor — requested by account ${req.accountId}`);
    await runAudit();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/status — Store health + global metrics for monitoring
router.get('/status', requireAuth, requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, email, full_name, language, subscription_status')
      .or('subscription_status.in.(active,trialing,beta),subscription_status.is.null');

    const stores = [];
    for (const account of accounts ?? []) {
      const { data: conn } = await supabase
        .from('shopify_connections')
        .select('shop_domain, shop_name, token_status, token_failing_since, token_retry_count')
        .eq('account_id', account.id)
        .maybeSingle();

      const { data: brief } = await supabase
        .from('intelligence_briefs')
        .select('brief_date, status, generated_at, generation_error')
        .eq('account_id', account.id)
        .order('brief_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Last executed action (read-only)
      const { data: lastAction } = await supabase
        .from('pending_actions')
        .select('type, title, status, executed_at')
        .eq('account_id', account.id)
        .not('executed_at', 'is', null)
        .order('executed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

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
        push_subscriptions: pushSubCount ?? 0,
        last_comm_channel: lastCommChannel,
        last_comm_status: lastCommStatus,
        last_comm_at: lastCommAt,
        last_weekly_week: lastWeeklyWeek,
        last_weekly_status: lastWeeklyStatus,
        last_weekly_sent_at: lastWeeklySentAt,
      });
    }

    // Recent admin alerts
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

    // Last audit run
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

    // Recent deliveries from email_log
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

    // System Health from orchestrator
    let systemHealth: {
      overall_status: string;
      ok: number;
      auto_fixed: number;
      needs_attention: number;
      last_run: string | null;
      auto_fixed_details: Array<Record<string, unknown>>;
      needs_attention_details: Array<Record<string, unknown>>;
    } = {
      overall_status: 'unknown',
      ok: 0, auto_fixed: 0, needs_attention: 0,
      last_run: null,
      auto_fixed_details: [],
      needs_attention_details: [],
    };
    try {
      const { data: orchChecks } = await supabase
        .from('orchestrator_checks')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (orchChecks && orchChecks.length > 0) {
        const byName = new Map<string, Record<string, unknown>>();
        for (const c of orchChecks as Array<Record<string, unknown>>) {
          const name = c.check_name as string;
          if (!byName.has(name)) byName.set(name, c);
        }
        const all = [...byName.values()];
        const ok = all.filter(c => c.status === 'ok' || c.status === 'info');
        const autoFixed = all.filter(c => c.auto_fixed === true);
        const needsAtt = all.filter(c => (c.status === 'critical' || c.status === 'warning') && !c.auto_fixed);

        const hasCrit = needsAtt.some(c => c.status === 'critical');
        systemHealth = {
          overall_status: hasCrit ? 'critical' : needsAtt.length > 0 ? 'warning' : autoFixed.length > 0 ? 'auto_fixed' : 'ok',
          ok: ok.length,
          auto_fixed: autoFixed.length,
          needs_attention: needsAtt.length,
          last_run: (orchChecks[0] as Record<string, unknown>).created_at as string,
          auto_fixed_details: autoFixed.map(c => ({ check_name: c.check_name, details: c.details })),
          needs_attention_details: needsAtt.map(c => ({ check_name: c.check_name, status: c.status, details: c.details })),
        };
      }
    } catch {
      // orchestrator_checks table may not exist yet
    }

    // Global metrics
    let globalMetrics = { emails_sent: 0, pushes_sent: 0, carts_recovered: 0, recovery_revenue: 0 };
    try {
      const { count: emailCount } = await supabase
        .from('email_log')
        .select('*', { count: 'exact', head: true })
        .in('channel', ['weekly_email', 'brief']);

      const { count: pushCount } = await supabase
        .from('email_log')
        .select('*', { count: 'exact', head: true })
        .in('channel', ['push', 'event_push', 'daily_summary_push']);

      const { data: recoveryCarts } = await supabase
        .from('abandoned_carts')
        .select('recovered, recovery_revenue')
        .eq('recovered', true);

      globalMetrics = {
        emails_sent: emailCount ?? 0,
        pushes_sent: pushCount ?? 0,
        carts_recovered: recoveryCarts?.length ?? 0,
        recovery_revenue: recoveryCarts?.reduce((sum, c) => sum + (c.recovery_revenue ?? 0), 0) ?? 0,
      };
    } catch {
      // tables may not exist
    }

    res.json({
      stores,
      system_health: systemHealth,
      recent_alerts: recentAlerts,
      last_audit: lastAudit,
      recent_deliveries: recentDeliveries,
      global_metrics: globalMetrics,
      server_time: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/email-log — Full email tracking log (read-only)
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

    const funnel = {
      sent: logs.length,
      delivered: logs.filter(l => l.delivered_at).length,
      opened: logs.filter(l => l.opened_at).length,
      clicked: logs.filter(l => l.clicked_at).length,
      bounced: logs.filter(l => l.bounced_at).length,
    };

    const { data: recoveryCarts } = await supabase
      .from('abandoned_carts')
      .select('recovered, recovery_revenue, recovery_attribution')
      .in('account_id', accountIds);

    const recoveredCarts = recoveryCarts?.filter(c => c.recovered) ?? [];
    const bySillages = recoveredCarts.filter(c => (c as Record<string, unknown>).recovery_attribution === 'by_sillages');
    const organic = recoveredCarts.filter(c => (c as Record<string, unknown>).recovery_attribution !== 'by_sillages');

    const recovery = {
      total_carts: recoveryCarts?.length ?? 0,
      recovered: recoveredCarts.length,
      revenue: recoveredCarts.reduce((sum, c) => sum + (c.recovery_revenue ?? 0), 0),
      by_sillages: bySillages.length,
      by_sillages_revenue: bySillages.reduce((sum, c) => sum + (c.recovery_revenue ?? 0), 0),
      organic: organic.length,
      organic_revenue: organic.reduce((sum, c) => sum + (c.recovery_revenue ?? 0), 0),
    };

    res.json({ logs: enriched, funnel, recovery });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/admin/orchestrator — System health dashboard (read-only)
router.get('/orchestrator', requireAuth, requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { data: latest } = await supabase
      .from('orchestrator_checks')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    const latestByName = new Map<string, Record<string, unknown>>();
    for (const check of (latest ?? []) as Array<Record<string, unknown>>) {
      const name = check.check_name as string;
      if (!latestByName.has(name)) {
        latestByName.set(name, check);
      }
    }

    const allChecks = [...latestByName.values()];
    const checksOk = allChecks.filter(c => c.status === 'ok' || c.status === 'info');
    const checksAutoFixed = allChecks.filter(c => c.auto_fixed === true);
    const checksNeedsAttention = allChecks.filter(c =>
      (c.status === 'critical' || c.status === 'warning') && !c.auto_fixed
    );

    const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: history } = await supabase
      .from('orchestrator_checks')
      .select('check_type, check_name, status, auto_fixed, details, created_at')
      .gte('created_at', oneDayAgo)
      .order('created_at', { ascending: false });

    const autoFixCount24h = (history ?? []).filter(h => h.auto_fixed).length;

    const hasCriticalUnfixed = checksNeedsAttention.some(c => c.status === 'critical');
    const hasWarningUnfixed = checksNeedsAttention.length > 0;
    const hasAutoFixed = checksAutoFixed.length > 0;

    let overall_status: string;
    if (hasCriticalUnfixed) overall_status = 'critical';
    else if (hasWarningUnfixed) overall_status = 'warning';
    else if (hasAutoFixed) overall_status = 'auto_fixed';
    else overall_status = 'ok';

    res.json({
      overall_status,
      summary: {
        ok: checksOk.length,
        auto_fixed: checksAutoFixed.length,
        needs_attention: checksNeedsAttention.length,
        auto_fixes_24h: autoFixCount24h,
      },
      checks_ok: checksOk,
      checks_auto_fixed: checksAutoFixed,
      checks_needs_attention: checksNeedsAttention,
      history_24h: history ?? [],
      last_run: latest?.[0]?.created_at ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/orchestrator/run — Force run the orchestrator
router.post('/orchestrator/run', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { runOrchestrator } = await import('../services/orchestrator.js');
    console.log(`[admin] Force-running orchestrator — requested by account ${req.accountId}`);
    const results = await runOrchestrator();
    const critical = results.filter(r => r.status === 'critical').length;
    const warnings = results.filter(r => r.status === 'warning').length;
    const autoFixed = results.filter(r => r.auto_fixed).length;
    res.json({ ok: true, checks: results.length, critical, warnings, auto_fixed: autoFixed, results });
  } catch (err) {
    next(err);
  }
});

export default router;
