import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../lib/supabase.js';
import { verifyUnsubscribeToken } from '../lib/unsubscribe.js';

const router = Router();

/**
 * GET /api/unsubscribe?token=XXX
 * No auth required — link from email must work without login.
 * Renders a simple HTML page confirming unsubscription.
 */
router.get('/', async (req: Request, res: Response) => {
  const token = req.query.token as string | undefined;

  if (!token) {
    res.status(400).send(renderPage('Error', 'Link de baja inválido.', false));
    return;
  }

  const parsed = verifyUnsubscribeToken(token);
  if (!parsed) {
    res.status(400).send(renderPage('Error', 'Este link de baja no es válido o ha sido modificado.', false));
    return;
  }

  const { accountId, email } = parsed;

  // Get store name for the confirmation page
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_name')
    .eq('account_id', accountId)
    .maybeSingle();

  const storeName = conn?.shop_name ?? 'la tienda';

  // Insert unsubscribe (upsert to handle duplicate clicks)
  const { error } = await supabase.from('email_unsubscribes').upsert({
    account_id: accountId,
    email: email.toLowerCase(),
    unsubscribed_at: new Date().toISOString(),
  }, { onConflict: 'account_id,email' });

  if (error) {
    console.error(`[unsubscribe] DB error: ${error.message}`);
    res.status(500).send(renderPage('Error', 'Ha ocurrido un error. Por favor, inténtalo de nuevo.', false));
    return;
  }

  console.log(`[unsubscribe] ${email} unsubscribed from ${storeName} (account ${accountId})`);

  res.send(renderPage(
    'Baja confirmada',
    `Has sido dado de baja. No recibirás más emails de <strong>${escapeHtml(storeName)}</strong>.`,
    true,
  ));
});

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderPage(title: string, message: string, success: boolean): string {
  const color = success ? '#27ae60' : '#c0392b';
  const icon = success ? '&#10003;' : '&#10007;';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Sillages</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: #F7F1EC;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 48px 40px;
      max-width: 460px;
      text-align: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    .icon {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: ${color};
      color: white;
      font-size: 32px;
      line-height: 64px;
      margin: 0 auto 24px;
    }
    h1 { font-size: 22px; color: #3A2332; margin-bottom: 12px; }
    p { font-size: 15px; color: #6B5460; line-height: 1.6; }
    .footer { margin-top: 32px; font-size: 11px; color: #C4B0B9; }
    .footer a { color: #C4B0B9; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <p class="footer">Powered by <a href="https://sillages.app">Sillages</a></p>
  </div>
</body>
</html>`;
}

export default router;
