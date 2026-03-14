import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { syncYesterdayForAccount } from '../services/shopifySync.js';
import { generateBrief } from '../services/briefGenerator.js';
import { supabase } from '../lib/supabase.js';
import { openai } from '../lib/openai.js';

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

// POST /api/briefs/:id/chat
// Auth-protected. Accepts a conversation and returns the assistant's next reply
// using the full brief JSON as context. Scoped strictly to the authed account.
router.post('/:id/chat', requireAuth, async (req, res, next) => {
  try {
    const accountId = req.accountId!;
    const briefId = req.params.id;

    const { messages } = req.body as {
      messages: { role: 'user' | 'assistant'; content: string }[];
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new AppError(400, 'messages array is required');
    }

    // Fetch brief — verify it belongs to the authed account
    const { data: brief, error: briefErr } = await supabase
      .from('intelligence_briefs')
      .select('*')
      .eq('id', briefId)
      .eq('account_id', accountId)
      .single();

    if (briefErr || !brief) {
      throw new AppError(404, 'Brief not found');
    }

    const systemPrompt = `You are Sillages, a store intelligence agent. You have just delivered the morning brief for this store. The merchant wants to go deeper on something specific from the brief. Here is today's brief data:

${JSON.stringify(brief, null, 2)}

STRICT RULES for this chat:
- Only answer questions directly related to this store, these products, and today's brief data
- If asked anything outside of: improving this store, acting on today's data, writing specific copy or content for this store — respond: I can only help with things directly related to our store and today's data.
- Never give generic marketing advice — always reference the specific products, numbers, and situations from the brief
- You can help write: exact email copy, exact social captions, exact product description changes, exact ad copy — always using the real product names and numbers from the brief
- Always respond in the same language as the brief
- Keep responses short and actionable — this is a quick consultation, not a lecture`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      max_tokens: 600,
      temperature: 0.7,
    });

    const reply = completion.choices[0]?.message?.content ?? '';
    res.json({ reply });
  } catch (err) {
    next(err);
  }
});

// POST /api/briefs/:id/feedback
// Auth-protected. Submits feedback for a brief. One per brief per account.
router.post('/:id/feedback', requireAuth, async (req, res, next) => {
  try {
    const accountId = req.accountId!;
    const briefId = req.params.id;

    const { rating, want_more_topic, free_text } = req.body as {
      rating: 'useful' | 'not_useful' | 'want_more';
      want_more_topic?: 'customers' | 'social_media' | 'products' | 'competition' | null;
      free_text?: string | null;
    };

    if (!['useful', 'not_useful', 'want_more'].includes(rating)) {
      throw new AppError(400, 'rating must be useful, not_useful, or want_more');
    }

    // Verify the brief belongs to this account
    const { data: brief, error: briefErr } = await supabase
      .from('intelligence_briefs')
      .select('id')
      .eq('id', briefId)
      .eq('account_id', accountId)
      .single();

    if (briefErr || !brief) {
      throw new AppError(404, 'Brief not found');
    }

    const { error: insertErr } = await supabase
      .from('brief_feedback')
      .upsert(
        {
          brief_id: briefId,
          account_id: accountId,
          rating,
          want_more_topic: want_more_topic ?? null,
          free_text: free_text ?? null,
        },
        { onConflict: 'brief_id,account_id' },
      );

    if (insertErr) {
      throw new AppError(500, `Failed to save feedback: ${insertErr.message}`);
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/briefs/:id/feedback
// Auth-protected. Returns existing feedback for this brief + account.
router.get('/:id/feedback', requireAuth, async (req, res, next) => {
  try {
    const accountId = req.accountId!;
    const briefId = req.params.id;

    const { data, error } = await supabase
      .from('brief_feedback')
      .select('*')
      .eq('brief_id', briefId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (error) {
      throw new AppError(500, `Failed to fetch feedback: ${error.message}`);
    }

    res.json({ feedback: data });
  } catch (err) {
    next(err);
  }
});

export default router;
