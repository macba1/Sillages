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

export default router;
