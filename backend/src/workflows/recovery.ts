/**
 * Dynamic Recovery Workflow — parallel event processing for N merchants.
 *
 * Replaces sequential processEventsForAccount in scheduler when USE_DYNAMIC_RECOVERY=true.
 * Each merchant spawns parallel subagents for:
 *   - Cart Recovery (abandoned carts)
 *   - Welcome (first buyers)
 *   - Reactivation (overdue customers)
 *
 * Per-merchant error isolation. Timing logs per subagent type.
 */

import { supabase } from '../lib/supabase.js';
import { shopifyClient } from '../lib/shopify.js';
import { detectEvents } from '../services/eventDetector.js';
import type { DetectedEvent, AbandonedCartData } from '../services/eventDetector.js';
import { generateEventAction } from '../services/eventActionGenerator.js';
import { syncAbandonedCarts } from '../services/abandonedCartsSync.js';
import { executeCartRecovery } from '../routes/actions.js';
import { gatePush } from '../services/commsGate.js';

const LOG = '[workflow:recovery]';

// ── Types ──────────────────────────────────────────────────────────────────

interface MerchantRecoveryInput {
  accountId: string;
}

interface SubAgentResult {
  type: 'abandoned_cart' | 'new_first_buyer' | 'overdue_customer';
  detected: number;
  generated: number;
  autoApproved: number;
  skipped: number;
  duration_ms: number;
}

interface MerchantRecoveryResult {
  accountId: string;
  success: boolean;
  error?: string;
  subagents: SubAgentResult[];
  totalActions: number;
  totalDuration_ms: number;
}

export interface RecoveryWorkflowResult {
  merchants: MerchantRecoveryResult[];
  totalDuration_ms: number;
  succeeded: number;
  failed: number;
}

// ── Main entry ─────────────────────────────────────────────────────────────

export async function runRecoveryWorkflow(merchants: MerchantRecoveryInput[]): Promise<RecoveryWorkflowResult> {
  const workflowStart = Date.now();
  console.log(`${LOG} Starting recovery workflow for ${merchants.length} merchant(s)`);

  const results = await Promise.all(
    merchants.map(m => runSingleMerchantRecovery(m).catch(err => ({
      accountId: m.accountId,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      subagents: [],
      totalActions: 0,
      totalDuration_ms: Date.now() - workflowStart,
    } satisfies MerchantRecoveryResult))),
  );

  const totalDuration = Date.now() - workflowStart;
  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  // Log run (non-fatal)
  try {
    await supabase.from('workflow_runs').insert({
      workflow: 'recovery',
      started_at: new Date(workflowStart).toISOString(),
      duration_ms: totalDuration,
      merchants_total: merchants.length,
      merchants_succeeded: succeeded,
      merchants_failed: failed,
      results: results.map(r => ({
        accountId: r.accountId,
        success: r.success,
        error: r.error ?? null,
        subagents: r.subagents,
        totalActions: r.totalActions,
      })),
    });
  } catch {
    // Table may not exist
  }

  console.log(`${LOG} Complete: ${succeeded}/${merchants.length} succeeded, ${totalDuration}ms`);

  for (const r of results) {
    if (r.success) {
      const agentSummary = r.subagents.map(s => `${s.type}:${s.detected}→${s.generated}(${s.autoApproved}auto)`).join(' ');
      console.log(`${LOG} [${r.accountId}] OK — ${agentSummary} total:${r.totalDuration_ms}ms`);
    } else {
      console.error(`${LOG} [${r.accountId}] FAILED — ${r.error}`);
    }
  }

  return { merchants: results, totalDuration_ms: totalDuration, succeeded, failed };
}

// ── Single merchant recovery ──────────────────────────────────────────────

async function runSingleMerchantRecovery(input: MerchantRecoveryInput): Promise<MerchantRecoveryResult> {
  const { accountId } = input;
  const merchantStart = Date.now();

  // 1. Sync abandoned carts
  try {
    await syncAbandonedCarts(accountId);
  } catch (err) {
    console.warn(`${LOG} [${accountId}] Cart sync failed (non-fatal): ${(err as Error).message}`);
  }

  // 2. Detect all events (internally runs 3 detectors in parallel)
  const detectStart = Date.now();
  const events = await detectEvents(accountId);
  const detectDuration = Date.now() - detectStart;

  if (events.length === 0) {
    return {
      accountId, success: true, subagents: [],
      totalActions: 0, totalDuration_ms: Date.now() - merchantStart,
    };
  }

  console.log(`${LOG} [${accountId}] ${events.length} event(s) detected in ${detectDuration}ms`);

  // 3. Load metadata
  const [{ data: acc }, { data: conn }, { data: shopConn }, { data: configData }] = await Promise.all([
    supabase.from('accounts').select('language, full_name').eq('id', accountId).single(),
    supabase.from('shopify_connections').select('shop_name, shop_currency').eq('account_id', accountId).eq('token_status', 'active').order('last_synced_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    supabase.from('shopify_connections').select('shop_domain, access_token').eq('account_id', accountId).eq('token_status', 'active').order('last_synced_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    supabase.from('user_intelligence_config').select('auto_approve_cart_recovery, auto_approve_welcome, auto_approve_reactivation').eq('account_id', accountId).maybeSingle(),
  ]);

  const lang: 'en' | 'es' = acc?.language === 'es' ? 'es' : 'en';
  const storeName = conn?.shop_name ?? 'Tu tienda';
  const currency = conn?.shop_currency ?? 'EUR';

  const autoApproveFlags: Record<string, boolean> = {
    abandoned_cart: (configData as Record<string, unknown> | null)?.auto_approve_cart_recovery === true,
    new_first_buyer: (configData as Record<string, unknown> | null)?.auto_approve_welcome === true,
    overdue_customer: (configData as Record<string, unknown> | null)?.auto_approve_reactivation === true,
  };

  // 4. Group events by type and process each type as a "subagent"
  const eventsByType = new Map<string, DetectedEvent[]>();
  for (const event of events) {
    const list = eventsByType.get(event.type) ?? [];
    list.push(event);
    eventsByType.set(event.type, list);
  }

  // 5. Run all 3 subagents in parallel
  const subagentPromises = Array.from(eventsByType.entries()).map(
    ([type, typeEvents]) => processSubAgent(accountId, type, typeEvents, lang, storeName, currency, shopConn, autoApproveFlags[type] ?? false),
  );

  const subagents = await Promise.all(subagentPromises);
  const totalActions = subagents.reduce((sum, s) => sum + s.generated, 0);

  // 6. Send ONE grouped push for all new actions
  if (totalActions > 0) {
    const isEs = lang === 'es';
    const body = totalActions === 1
      ? (isEs ? 'Tienes 1 acción lista para revisar.' : 'You have 1 action ready to review.')
      : (isEs ? `Tienes ${totalActions} acciones listas para revisar.` : `You have ${totalActions} actions ready to review.`);

    try {
      await gatePush(accountId, { title: storeName, body, url: '/actions' }, 'event_push');
    } catch { /* non-fatal */ }
  }

  return {
    accountId,
    success: true,
    subagents,
    totalActions,
    totalDuration_ms: Date.now() - merchantStart,
  };
}

// ── SubAgent: process events of one type ──────────────────────────────────

async function processSubAgent(
  accountId: string,
  type: string,
  events: DetectedEvent[],
  lang: 'en' | 'es',
  storeName: string,
  currency: string,
  shopConn: { shop_domain: string; access_token: string } | null,
  autoApprove: boolean,
): Promise<SubAgentResult> {
  const start = Date.now();
  let generated = 0;
  let autoApproved = 0;
  let skipped = 0;

  for (const event of events) {
    // Pre-check: for abandoned carts, verify customer hasn't purchased
    if (event.type === 'abandoned_cart' && shopConn) {
      const cartData = event.data as AbandonedCartData;
      try {
        const client = shopifyClient(shopConn.shop_domain, shopConn.access_token);
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
        const { orders } = await client.getOrders({
          created_at_min: sevenDaysAgo,
          created_at_max: new Date().toISOString(),
        });
        const alreadyBought = orders.some(
          o => o.customer?.email?.toLowerCase() === cartData.customer_email.toLowerCase() &&
               o.financial_status !== 'voided' && !o.cancel_reason,
        );
        if (alreadyBought) {
          console.log(`${LOG} [${accountId}] SKIP ${cartData.customer_name} — already purchased`);
          await supabase
            .from('abandoned_carts')
            .update({ recovered: true, recovered_at: new Date().toISOString(), recovery_attribution: 'organic' })
            .eq('account_id', accountId)
            .eq('customer_email', cartData.customer_email)
            .or('recovered.is.null,recovered.eq.false');
          skipped++;
          continue;
        }
      } catch (err) {
        console.warn(`${LOG} [${accountId}] Purchase verify failed for ${(event.data as AbandonedCartData).customer_email} — skipping (fail-closed)`);
        skipped++;
        continue;
      }
    }

    // Generate action
    const actionId = await generateEventAction(accountId, event, lang, storeName, currency);
    if (!actionId) { skipped++; continue; }
    generated++;

    // Mark in event_log
    await supabase.from('event_log').update({ push_sent: true }).eq('account_id', accountId).eq('event_key', event.key);

    // Auto-approve if merchant opted in
    if (autoApprove && actionId) {
      try {
        const { data: action } = await supabase.from('pending_actions').select('content').eq('id', actionId).single();
        if (action) {
          await executeCartRecovery(accountId, actionId, action.content as Record<string, unknown>);
          autoApproved++;
          console.log(`${LOG} [${accountId}] Auto-approved ${type} action ${actionId}`);
        }
      } catch (autoErr) {
        console.warn(`${LOG} [${accountId}] Auto-approve failed for ${actionId}: ${(autoErr as Error).message}`);
      }
    }
  }

  return {
    type: type as SubAgentResult['type'],
    detected: events.length,
    generated,
    autoApproved,
    skipped,
    duration_ms: Date.now() - start,
  };
}
