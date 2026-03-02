import type { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import { supabase } from '../lib/supabase.js';
import { AppError } from './errorHandler.js';

// Extend Express Request to carry auth context
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      accountId?: string;
    }
  }
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(401, 'Missing authorization header');
    }

    const token = authHeader.slice(7);

    // Verify JWT with Supabase (anon key needed for user verification)
    const anonClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user }, error } = await anonClient.auth.getUser(token);

    if (error || !user) {
      throw new AppError(401, 'Invalid or expired token');
    }

    // Look up the account record
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (accountError || !account) {
      throw new AppError(401, 'Account not found');
    }

    req.userId = user.id;
    req.accountId = account.id;
    next();
  } catch (err) {
    next(err);
  }
}
