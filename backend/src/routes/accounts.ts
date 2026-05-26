import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { supabase } from '../lib/supabase.js';

const router = Router();

// GET /api/accounts/language — fetch language preference
router.get('/language', requireAuth, async (req, res, next) => {
  try {
    const accountId = req.accountId!;
    const { data, error } = await supabase
      .from('accounts')
      .select('language')
      .eq('id', accountId)
      .single();

    if (error) throw new AppError(500, error.message);
    res.json({ language: data?.language ?? 'en' });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/accounts/language — update language preference
router.patch('/language', requireAuth, async (req, res, next) => {
  try {
    const accountId = req.accountId!;
    const { language } = req.body as { language?: string };

    if (language !== 'en' && language !== 'es') {
      throw new AppError(400, 'language must be "en" or "es"');
    }

    console.log('Saving language:', language, 'for account:', accountId);

    const { error } = await supabase
      .from('accounts')
      .update({ language })
      .eq('id', accountId);

    if (error) throw new AppError(500, error.message);

    res.json({ ok: true, language });
  } catch (err) {
    next(err);
  }
});

// GET /api/accounts/auto-approve — get auto-approve cart recovery setting
router.get('/auto-approve', requireAuth, async (req, res, next) => {
  try {
    const { data } = await supabase
      .from('user_intelligence_config')
      .select('auto_approve_cart_recovery')
      .eq('account_id', req.accountId!)
      .maybeSingle();

    res.json({ auto_approve_cart_recovery: data?.auto_approve_cart_recovery ?? false });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/accounts/auto-approve — toggle auto-approve cart recovery
router.patch('/auto-approve', requireAuth, async (req, res, next) => {
  try {
    const { auto_approve_cart_recovery } = req.body as { auto_approve_cart_recovery?: boolean };
    if (typeof auto_approve_cart_recovery !== 'boolean') {
      throw new AppError(400, 'auto_approve_cart_recovery must be a boolean');
    }

    const { error } = await supabase
      .from('user_intelligence_config')
      .update({ auto_approve_cart_recovery })
      .eq('account_id', req.accountId!);

    if (error) throw new AppError(500, error.message);
    console.log(`[accounts] ${req.accountId} set auto_approve_cart_recovery=${auto_approve_cart_recovery}`);
    res.json({ ok: true, auto_approve_cart_recovery });
  } catch (err) {
    next(err);
  }
});

export default router;
