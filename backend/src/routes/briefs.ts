import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { syncYesterdayForAccount } from '../services/shopifySync.js';
import { generateBrief } from '../services/briefGenerator.js';
import { supabase } from '../lib/supabase.js';

const router = Router();

// GET  /api/briefs        — list briefs for authed account
// GET  /api/briefs/:id    — get single brief

// POST /api/briefs/trigger-now
// Auth-protected. Syncs yesterday's Shopify data then generates a brief
// immediately. Returns the completed brief. Intended for manual testing.
router.post('/trigger-now', requireAuth, async (req, res, next) => {
  try {
    const accountId = req.accountId!;

    // 1. Pull yesterday's orders from Shopify and upsert the daily snapshot
    const { snapshotDate } = await syncYesterdayForAccount(accountId);

    // 2. Run the GPT-4o brief generation against that snapshot
    await generateBrief({ accountId, briefDate: snapshotDate });

    // 3. Fetch and return the completed brief record
    const { data: brief, error } = await supabase
      .from('intelligence_briefs')
      .select('*')
      .eq('account_id', accountId)
      .eq('brief_date', snapshotDate)
      .single();

    if (error || !brief) {
      throw new AppError(500, 'Brief generated but could not be retrieved');
    }

    res.json({ brief });
  } catch (err) {
    next(err);
  }
});

export default router;
