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

// Shared helper — verifies a raw JWT and returns the resolved accountId/userId.
// Used by requireAuth middleware and any route that needs to accept a token
// from a query parameter (e.g. OAuth initiations triggered by browser navigation).
export async function resolveAuthToken(
  token: string,
): Promise<{ userId: string; accountId: string }> {
  const anonClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error } = await anonClient.auth.getUser(token);

  if (error || !user) {
    throw new AppError(401, 'Invalid or expired token');
  }

  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (accountError || !account) {
    throw new AppError(401, 'Account not found');
  }

  return { userId: user.id, accountId: account.id };
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
    const { userId, accountId } = await resolveAuthToken(authHeader.slice(7));
    req.userId = userId;
    req.accountId = accountId;
    next();
  } catch (err) {
    next(err);
  }
}
