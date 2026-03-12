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

export default router;
