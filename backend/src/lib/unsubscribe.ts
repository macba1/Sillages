import crypto from 'crypto';
import { supabase } from './supabase.js';
import { env } from '../config/env.js';

/**
 * Unsubscribe token: HMAC-SHA256 signed with SUPABASE_SERVICE_ROLE_KEY.
 * Token = base64url(accountId:email) + "." + base64url(hmac)
 * No expiry — unsubscribe links must work forever (GDPR).
 */

const HMAC_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

export function generateUnsubscribeToken(accountId: string, email: string): string {
  const payload = Buffer.from(`${accountId}:${email}`).toString('base64url');
  const hmac = crypto.createHmac('sha256', HMAC_KEY).update(payload).digest('base64url');
  return `${payload}.${hmac}`;
}

export function verifyUnsubscribeToken(token: string): { accountId: string; email: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payload, signature] = parts;
  const expectedHmac = crypto.createHmac('sha256', HMAC_KEY).update(payload).digest('base64url');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedHmac))) {
    return null;
  }

  const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
  const colonIdx = decoded.indexOf(':');
  if (colonIdx === -1) return null;

  return {
    accountId: decoded.slice(0, colonIdx),
    email: decoded.slice(colonIdx + 1),
  };
}

export function buildUnsubscribeUrl(accountId: string, email: string): string {
  const token = generateUnsubscribeToken(accountId, email);
  // SHOPIFY_APP_URL is the backend's public URL (works in both dev and production)
  const backendBase = env.SHOPIFY_APP_URL.replace(/\/$/, '');
  return `${backendBase}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

/**
 * Check if an email is unsubscribed for a given account.
 * Returns true if the email has unsubscribed (should NOT send).
 */
export async function isUnsubscribed(accountId: string, email: string): Promise<boolean> {
  const { data } = await supabase
    .from('email_unsubscribes')
    .select('id')
    .eq('account_id', accountId)
    .eq('email', email.toLowerCase())
    .maybeSingle();

  return !!data;
}

/**
 * Check if an email is blacklisted (bounced) for a given account.
 */
export async function isBlacklisted(accountId: string, email: string): Promise<boolean> {
  const { data } = await supabase
    .from('email_blacklist')
    .select('id')
    .eq('account_id', accountId)
    .eq('email', email.toLowerCase())
    .maybeSingle();

  return !!data;
}

/**
 * Combined check: should we NOT send to this email?
 * Returns reason string if blocked, null if OK to send.
 */
export async function checkEmailBlocked(accountId: string, email: string): Promise<string | null> {
  const emailLower = email.toLowerCase();

  const [unsub, blacklist] = await Promise.all([
    isUnsubscribed(accountId, emailLower),
    isBlacklisted(accountId, emailLower),
  ]);

  if (unsub) return 'customer_unsubscribed';
  if (blacklist) return 'email_blacklisted';
  return null;
}
