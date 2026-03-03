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

// POST /api/briefs/seed-test-data
// Auth-protected. Inserts a realistic beauty e-commerce snapshot directly into
// Supabase (bypasses Shopify entirely), then generates a brief from it.
// Use this when the Shopify orders API is unavailable (scope issues, 403s, etc).
router.post('/seed-test-data', requireAuth, async (req, res, next) => {
  try {
    const accountId = req.accountId!;

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const snapshotDate = yesterday.toISOString().slice(0, 10);

    const topProducts = [
      {
        product_id: 'seed-001',
        title: 'Vitamin C Brightening Serum',
        quantity_sold: 18,
        revenue: 2160.00,
        variant_breakdown: [{ variant_id: 'seed-001-v1', title: '30ml', quantity: 18 }],
      },
      {
        product_id: 'seed-002',
        title: 'Hyaluronic Acid Moisturizer',
        quantity_sold: 12,
        revenue: 1080.00,
        variant_breakdown: [{ variant_id: 'seed-002-v1', title: '50ml', quantity: 12 }],
      },
      {
        product_id: 'seed-003',
        title: 'Retinol Night Repair Cream',
        quantity_sold: 8,
        revenue: 960.00,
        variant_breakdown: [{ variant_id: 'seed-003-v1', title: '30ml', quantity: 8 }],
      },
    ];

    const { error: upsertError } = await supabase
      .from('shopify_daily_snapshots')
      .upsert(
        {
          account_id: accountId,
          snapshot_date: snapshotDate,
          total_revenue: 4820.00,
          net_revenue: 4675.00,
          total_orders: 38,
          average_order_value: 126.84,
          sessions: 1118,
          conversion_rate: 0.034,
          returning_customer_rate: 0.4211,
          new_customers: 22,
          returning_customers: 16,
          total_customers: 38,
          top_products: topProducts,
          total_refunds: 145.00,
          cancelled_orders: 2,
          wow_revenue_pct: 12.3,
          wow_orders_pct: 8.1,
          wow_aov_pct: 3.7,
          wow_conversion_pct: null,
          wow_new_customers_pct: 15.2,
          raw_shopify_payload: { seeded: true },
        },
        { onConflict: 'account_id,snapshot_date' },
      );

    if (upsertError) {
      throw new AppError(500, `Failed to seed snapshot: ${upsertError.message}`);
    }

    // Generate brief from the seeded snapshot
    await generateBrief({ accountId, briefDate: snapshotDate });

    const { data: brief, error: fetchError } = await supabase
      .from('intelligence_briefs')
      .select('*')
      .eq('account_id', accountId)
      .eq('brief_date', snapshotDate)
      .single();

    if (fetchError || !brief) {
      throw new AppError(500, 'Brief generated but could not be retrieved');
    }

    res.json({ brief, snapshotDate });
  } catch (err) {
    next(err);
  }
});

export default router;
