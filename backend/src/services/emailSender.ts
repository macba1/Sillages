import { format, parseISO } from 'date-fns';
import { resend } from '../lib/resend.js';
import { supabase } from '../lib/supabase.js';
import { env } from '../config/env.js';
import type { IntelligenceBrief, Account } from '../types.js';

// ── Entry point ───────────────────────────────────────────────────────────────

export async function sendBriefEmail(briefId: string): Promise<void> {
  const { data: brief, error: briefErr } = await supabase
    .from('intelligence_briefs')
    .select('*')
    .eq('id', briefId)
    .single();

  if (briefErr || !brief) throw new Error(`Brief not found: ${briefErr?.message}`);

  const b = brief as IntelligenceBrief;
  if (b.status !== 'ready') throw new Error(`Brief ${briefId} is not ready (status: ${b.status})`);

  const [{ data: account, error: accErr }, { data: shopConn }] = await Promise.all([
    supabase.from('accounts').select('email, full_name').eq('id', b.account_id).single(),
    supabase.from('shopify_connections').select('shop_name').eq('account_id', b.account_id).single(),
  ]);

  if (accErr || !account) throw new Error(`Account not found: ${accErr?.message}`);

  const acc = account as Pick<Account, 'email' | 'full_name'>;
  const ownerName = acc.full_name?.split(' ')[0] ?? acc.email.split('@')[0];

  const rawShopName: string = (shopConn as { shop_name: string | null } | null)?.shop_name ?? ownerName;
  const emailSlug = rawShopName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const fromAddress = `${emailSlug}@sillages.app`;
  const fromField = `${rawShopName} via Sillages <${fromAddress}>`;

  console.log(`[emailSender] Sending from: ${fromField}`);

  const subjectHeadline = b.section_signal?.headline ?? b.section_yesterday?.summary ?? 'Your daily brief';
  const subject = `${ownerName}, ${subjectHeadline}`;

  const html = buildEmailHtml({ brief: b, ownerName });

  const { data: sent, error: sendErr } = await resend.emails.send({
    from: fromField,
    to: acc.email,
    subject,
    html,
  });

  if (sendErr || !sent) throw new Error(`Resend error: ${(sendErr as Error)?.message}`);

  await supabase
    .from('intelligence_briefs')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      email_message_id: sent.id,
    })
    .eq('id', briefId);

  console.log(`[emailSender] Sent brief ${briefId} to ${acc.email}`);
}

// ── Email HTML builder ────────────────────────────────────────────────────────

interface BuildEmailInput {
  brief: IntelligenceBrief;
  ownerName: string;
}

function buildEmailHtml({ brief, ownerName }: BuildEmailInput): string {
  const dateStr = format(parseISO(brief.brief_date), 'EEEE, MMMM d, yyyy');
  const y = brief.section_yesterday;
  const ww = brief.section_whats_working;
  const wnw = brief.section_whats_not_working;
  const sig = brief.section_signal;
  const gap = brief.section_gap;
  const act = brief.section_activation;

  function fmt(n: number, style: 'currency' | 'decimal' = 'decimal'): string {
    if (style === 'currency') {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
    }
    return new Intl.NumberFormat('en-US').format(n);
  }

  const workingItems = ww?.items.map((item) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #F0E8E0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="width:8px;vertical-align:top;padding-top:2px;">
              <div style="width:6px;height:6px;background:#22c55e;border-radius:50%;margin-top:5px;"></div>
            </td>
            <td style="padding-left:10px;">
              <span style="font-size:13px;font-weight:600;color:#3A2332;">${item.title}</span>
              <span style="font-size:13px;color:#22c55e;font-weight:600;margin-left:8px;">${item.metric}</span>
              <p style="margin:4px 0 0;font-size:13px;color:#6B5460;line-height:1.5;">${item.insight}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`).join('') ?? '';

  const notWorkingItems = wnw?.items.map((item) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #F0E8E0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="width:8px;vertical-align:top;padding-top:2px;">
              <div style="width:6px;height:6px;background:#ef4444;border-radius:50%;margin-top:5px;"></div>
            </td>
            <td style="padding-left:10px;">
              <span style="font-size:13px;font-weight:600;color:#3A2332;">${item.title}</span>
              <span style="font-size:13px;color:#ef4444;font-weight:600;margin-left:8px;">${item.metric}</span>
              <p style="margin:4px 0 0;font-size:13px;color:#6B5460;line-height:1.5;">${item.insight}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`).join('') ?? '';

  const howSteps = act?.how.map((step, i) => `
    <tr>
      <td style="padding:8px 0;">
        <table cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="width:24px;vertical-align:top;">
              <div style="width:20px;height:20px;background:#F0E3D0;border-radius:50%;text-align:center;line-height:20px;font-size:11px;font-weight:600;color:#3A2332;">${i + 1}</div>
            </td>
            <td style="padding-left:10px;font-size:13px;color:#4A3342;line-height:1.6;">${step}</td>
          </tr>
        </table>
      </td>
    </tr>`).join('') ?? '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Sillages Brief</title>
</head>
<body style="margin:0;padding:0;background:#F7F1EC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F1EC;min-height:100vh;">
    <tr>
      <td align="center" style="padding:32px 16px 48px;">

        <!-- Container -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

          <!-- Header -->
          <tr>
            <td style="padding-bottom:28px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <p style="margin:0;font-size:18px;font-weight:700;color:#3A2332;letter-spacing:-0.3px;">sillages</p>
                  </td>
                  <td align="right">
                    <p style="margin:0;font-size:12px;color:#9A8090;text-transform:uppercase;letter-spacing:0.08em;">${dateStr}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding-bottom:24px;">
              <p style="margin:0;font-size:22px;font-weight:600;color:#3A2332;line-height:1.3;">
                Good morning, ${ownerName}.
              </p>
            </td>
          </tr>

          ${y ? `
          <!-- ── YESTERDAY ── -->
          <tr>
            <td style="padding-bottom:8px;">
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#9A8090;">Yesterday</p>
            </td>
          </tr>
          <tr>
            <td style="background:#FFFFFF;border-radius:12px;border:1px solid #EDE5DC;padding:20px 24px 24px;margin-bottom:16px;">
              <p style="margin:0 0 20px;font-size:14px;font-weight:500;color:#3A2332;line-height:1.6;">${y.summary}</p>
              <!-- Stats grid -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="width:33%;padding-bottom:16px;vertical-align:top;">
                    <p style="margin:0 0 2px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">Revenue</p>
                    <p style="margin:0;font-size:18px;font-weight:600;color:#3A2332;">${fmt(y.revenue, 'currency')}</p>
                  </td>
                  <td style="width:33%;padding-bottom:16px;vertical-align:top;">
                    <p style="margin:0 0 2px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">Orders</p>
                    <p style="margin:0;font-size:18px;font-weight:600;color:#3A2332;">${fmt(y.orders)}</p>
                  </td>
                  <td style="width:33%;padding-bottom:16px;vertical-align:top;">
                    <p style="margin:0 0 2px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">AOV</p>
                    <p style="margin:0;font-size:18px;font-weight:600;color:#3A2332;">${fmt(y.aov, 'currency')}</p>
                  </td>
                </tr>
                <tr>
                  <td style="vertical-align:top;">
                    <p style="margin:0 0 2px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">Sessions</p>
                    <p style="margin:0;font-size:18px;font-weight:600;color:#3A2332;">${fmt(y.sessions)}</p>
                  </td>
                  <td style="vertical-align:top;">
                    <p style="margin:0 0 2px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">Conversion</p>
                    <p style="margin:0;font-size:18px;font-weight:600;color:#3A2332;">${(y.conversion_rate * 100).toFixed(2)}%</p>
                  </td>
                  <td style="vertical-align:top;">
                    <p style="margin:0 0 2px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">New Customers</p>
                    <p style="margin:0;font-size:18px;font-weight:600;color:#3A2332;">${fmt(y.new_customers)}</p>
                  </td>
                </tr>
              </table>
              ${y.top_product ? `
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #F0E8E0;margin-top:16px;padding-top:16px;">
                <tr>
                  <td>
                    <p style="margin:0 0 2px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">Top Product</p>
                    <p style="margin:0;font-size:13px;font-weight:500;color:#3A2332;">${y.top_product}</p>
                  </td>
                </tr>
              </table>` : ''}
            </td>
          </tr>
          <tr><td style="height:16px;"></td></tr>
          ` : ''}

          ${ww && workingItems ? `
          <!-- ── WHAT'S WORKING ── -->
          <tr>
            <td style="padding-bottom:8px;padding-top:8px;">
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#9A8090;">What's Working</p>
            </td>
          </tr>
          <tr>
            <td style="background:#FFFFFF;border-radius:12px;border:1px solid #EDE5DC;padding:8px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">${workingItems}</table>
            </td>
          </tr>
          <tr><td style="height:16px;"></td></tr>
          ` : ''}

          ${wnw && notWorkingItems ? `
          <!-- ── WHAT'S NOT WORKING ── -->
          <tr>
            <td style="padding-bottom:8px;padding-top:8px;">
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#9A8090;">What's Not Working</p>
            </td>
          </tr>
          <tr>
            <td style="background:#FFFFFF;border-radius:12px;border:1px solid #EDE5DC;padding:8px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">${notWorkingItems}</table>
            </td>
          </tr>
          <tr><td style="height:16px;"></td></tr>
          ` : ''}

          ${sig ? `
          <!-- ── THE SIGNAL ── -->
          <tr>
            <td style="padding-bottom:8px;padding-top:8px;">
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#9A8090;">The Signal</p>
            </td>
          </tr>
          <tr>
            <td style="background:#1A1A2E;border-radius:12px;padding:24px;">
              <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:#D8B07A;line-height:1.4;">${sig.headline}</p>
              <p style="margin:0 0 16px;font-size:13px;color:rgba(255,255,255,0.65);line-height:1.6;">${sig.market_context}</p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid rgba(255,255,255,0.1);padding-top:16px;margin-top:0;">
                <tr>
                  <td>
                    <p style="margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.25);">For your store</p>
                    <p style="margin:0;font-size:13px;color:#FFFFFF;line-height:1.6;">${sig.store_implication}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td style="height:16px;"></td></tr>
          ` : ''}

          ${gap ? `
          <!-- ── THE GAP ── -->
          <tr>
            <td style="padding-bottom:8px;padding-top:8px;">
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#9A8090;">The Gap</p>
            </td>
          </tr>
          <tr>
            <td style="background:#FFFFFF;border-radius:12px;border:1px solid #EDE5DC;padding:20px 24px;">
              <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">Gap</p>
              <p style="margin:0 0 16px;font-size:13px;color:#3A2332;line-height:1.6;">${gap.gap}</p>
              <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;">Opportunity</p>
              <p style="margin:0 0 16px;font-size:13px;color:#3A2332;line-height:1.6;">${gap.opportunity}</p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background:#F5EBD8;border-radius:8px;padding:10px 14px;">
                    <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#9A8090;font-weight:600;">Upside &nbsp;</span>
                    <span style="font-size:13px;font-weight:600;color:#3A2332;">${gap.estimated_upside}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td style="height:16px;"></td></tr>
          ` : ''}

          ${act ? `
          <!-- ── TODAY'S ACTIVATION ── -->
          <tr>
            <td style="padding-bottom:8px;padding-top:8px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td><p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#9A8090;">Today's Activation</p></td>
                  <td align="right"><p style="margin:0;font-size:11px;color:#9A8090;">⏱ 30 min</p></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#FFFFFF;border-radius:12px;border:1px solid #EDE5DC;overflow:hidden;">
              <!-- WHAT -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:20px 24px 16px;border-bottom:1px solid #F0E8E0;">
                    <p style="margin:0 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#D8B07A;">What</p>
                    <p style="margin:0;font-size:15px;font-weight:600;color:#3A2332;line-height:1.4;">${act.what}</p>
                  </td>
                </tr>
                <!-- WHY -->
                <tr>
                  <td style="padding:16px 24px;border-bottom:1px solid #F0E8E0;background:#FDFAF7;">
                    <p style="margin:0 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#9A8090;">Why</p>
                    <p style="margin:0;font-size:13px;color:#4A3342;line-height:1.6;">${act.why}</p>
                  </td>
                </tr>
                <!-- HOW -->
                <tr>
                  <td style="padding:16px 24px;border-bottom:1px solid #F0E8E0;">
                    <p style="margin:0 0 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#9A8090;">How</p>
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">${howSteps}</table>
                  </td>
                </tr>
                <!-- EXPECTED IMPACT -->
                <tr>
                  <td style="padding:16px 24px;background:#1A1A2E;border-radius:0 0 12px 12px;">
                    <p style="margin:0 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.3);">Expected Impact</p>
                    <p style="margin:0;font-size:13px;font-weight:600;color:#D8B07A;line-height:1.5;">${act.expected_impact}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td style="height:16px;"></td></tr>
          ` : ''}

          <!-- Footer -->
          <tr>
            <td style="padding-top:24px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <p style="margin:0;font-size:12px;color:#9A8090;">
                      <a href="${process.env.FRONTEND_URL}/briefs" style="color:#9A8090;text-decoration:none;">View in app</a>
                      &nbsp;·&nbsp;
                      <a href="${process.env.FRONTEND_URL}/settings" style="color:#9A8090;text-decoration:none;">Manage preferences</a>
                    </p>
                  </td>
                  <td align="right">
                    <p style="margin:0;font-size:12px;color:#C4B0B9;">sillages</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
