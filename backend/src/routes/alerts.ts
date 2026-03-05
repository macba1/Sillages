import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { supabase } from '../lib/supabase.js';

const router = Router();

// GET /api/alerts — return unread alerts for authed account
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const accountId = req.accountId!;

    const { data, error } = await supabase
      .from('alerts')
      .select('*')
      .eq('account_id', accountId)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw new AppError(500, error.message);

    res.json({ alerts: data ?? [] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/alerts/:id/read — mark a single alert as read
router.patch('/:id/read', requireAuth, async (req, res, next) => {
  try {
    const accountId = req.accountId!;
    const { id } = req.params;

    const { error } = await supabase
      .from('alerts')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', accountId); // prevent reading another account's alerts

    if (error) throw new AppError(500, error.message);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
