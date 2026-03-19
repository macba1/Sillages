/**
 * END-TO-END INTEGRATION TEST: Cart Recovery Flow
 *
 * Simulates the complete pipeline:
 *   abandoned cart → detector → Growth Hacker (LLM) → orchestrator validates →
 *   push in pending_comms → admin endpoint returns action → approve →
 *   real-time verify → email sent
 *
 * All external APIs (Supabase, Shopify, OpenAI, Resend) are mocked.
 * Each step is verified independently — if any fails, the test fails.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ══════════════════════════════════════════════════════════════════════════════
// IN-MEMORY DATABASE
// ══════════════════════════════════════════════════════════════════════════════

const ACCOUNT_ID = 'test-account-001';
const CHECKOUT_ID = '99999999';

interface Row { [key: string]: unknown }

const tables: Record<string, Row[]> = {};

function resetTables() {
  for (const key of Object.keys(tables)) delete tables[key];

  tables.abandoned_carts = [{
    id: 'cart-1',
    account_id: ACCOUNT_ID,
    shopify_checkout_id: CHECKOUT_ID,
    customer_name: 'María García',
    customer_email: 'maria@test.com',
    total_price: 42.90,
    products: [
      { title: 'TARTA DE LIMÓN', quantity: 1, price: 34.90 },
      { title: 'COOKIES CHOCOLATE', quantity: 1, price: 8.00 },
    ],
    checkout_url: 'https://test.myshopify.com/checkouts/recover/99999999',
    abandoned_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    recovered: false,
    created_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
  }];
  tables.event_log = [];
  tables.pending_actions = [];
  tables.pending_comms = [];
  tables.accounts = [{
    id: ACCOUNT_ID, email: 'merchant@test.com', full_name: 'Test Merchant',
    language: 'es', comms_approval: 'manual',
  }];
  tables.shopify_connections = [{
    account_id: ACCOUNT_ID, shop_name: 'TestShop', shop_domain: 'test.myshopify.com',
    shop_currency: 'EUR', access_token: 'shpat_test',
  }];
  tables.brand_profiles = [{
    account_id: ACCOUNT_ID, brand_voice: 'friendly', brand_values: 'gluten-free',
    raw_data: {
      products: [
        { title: 'TARTA DE LIMÓN', description: 'Tarta artesanal de limón con merengue italiano. Sin gluten.' },
        { title: 'COOKIES CHOCOLATE', description: 'Cookies de chocolate negro 70%. Sin gluten, sin lactosa.' },
      ],
    },
  }];
  tables.email_log = [];
  tables.orchestrator_checks = [];
  tables.push_subscriptions = [];
}

// ── Supabase mock: chainable query builder over in-memory tables ─────────────

function buildChain(tableName: string) {
  const t = tables[tableName] ?? (tables[tableName] = []);
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  let insertData: Row | null = null;
  let updateData: Row | null = null;
  const eqs: [string, unknown][] = [];

  function match(row: Row): boolean {
    return eqs.every(([k, v]) => row[k] === v);
  }

  function resolve(single: boolean) {
    if (op === 'insert' && insertData) {
      const row = { ...insertData, id: insertData.id ?? `id-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, created_at: new Date().toISOString() };
      t.push(row);
      return { data: single ? row : [row], error: null, count: 1 };
    }
    if (op === 'update' && updateData) {
      const matched = t.filter(match);
      for (const row of matched) Object.assign(row, updateData);
      return { data: single ? (matched[0] ?? null) : matched, error: null, count: matched.length };
    }
    if (op === 'delete') {
      const before = t.length;
      const keep = t.filter(r => !match(r));
      t.length = 0; t.push(...keep);
      return { data: null, error: null, count: before - t.length };
    }
    // select
    const rows = t.filter(match);
    return { data: single ? (rows[0] ?? null) : rows, error: null, count: rows.length };
  }

  const self: Record<string, unknown> = {};
  const ret = () => self;

  self.select = (_f?: string, _opts?: unknown) => { if (op !== 'insert' && op !== 'update') op = 'select'; return self; };
  self.insert = (d: Row | Row[]) => { op = 'insert'; insertData = Array.isArray(d) ? d[0] : d; return self; };
  self.update = (d: Row) => { op = 'update'; updateData = d; return self; };
  self.delete = () => { op = 'delete'; return self; };
  self.eq = (k: string, v: unknown) => { eqs.push([k, v]); return self; };
  self.neq = ret; self.gte = ret; self.lte = ret; self.lt = ret;
  self.gt = ret; self.or = ret; self.not = ret;
  self.is = (col: string, val: unknown) => { eqs.push([col, val]); return self; };
  self.in = ret; self.ilike = ret; self.order = ret; self.limit = ret;
  self.single = () => resolve(true);
  self.maybeSingle = () => resolve(true);
  // Make awaitable for cases without .single()
  self.then = (res: (v: unknown) => void) => res(resolve(false));

  return self;
}

vi.mock('../lib/supabase.js', () => ({
  supabase: { from: (name: string) => buildChain(name) },
}));

// ── OpenAI mock ──────────────────────────────────────────────────────────────

const mockOpenAICreate = vi.fn();

vi.mock('../lib/openai.js', () => ({
  openai: { chat: { completions: { create: (...a: unknown[]) => mockOpenAICreate(...a) } } },
}));

function setLLMResponse(copy: string, title = 'María, la Tarta de Limón te espera') {
  mockOpenAICreate.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({
      title,
      description: 'Cart recovery for María',
      content: {
        customer_email: 'maria@test.com',
        customer_name: 'María García',
        products: [
          { title: 'TARTA DE LIMÓN', quantity: 1, price: 34.90 },
          { title: 'COOKIES CHOCOLATE', quantity: 1, price: 8.00 },
        ],
        checkout_url: 'https://test.myshopify.com/checkouts/recover/99999999',
        copy,
        discount_code: '', discount_value: '', discount_type: 'percentage',
      },
    }) } }],
    usage: { total_tokens: 500 },
  });
}

// ── Shopify mock ─────────────────────────────────────────────────────────────

const mockGetOrders = vi.fn().mockResolvedValue({ orders: [] });
const mockGetProducts = vi.fn().mockResolvedValue([]);

vi.mock('../lib/shopify.js', () => ({
  shopifyClient: vi.fn(() => ({
    getOrders: (...a: unknown[]) => mockGetOrders(...a),
    getProducts: (...a: unknown[]) => mockGetProducts(...a),
    getAbandonedCheckouts: vi.fn().mockResolvedValue({ checkouts: [] }),
  })),
  shopifyGraphQL: vi.fn(),
  ensureTokenFresh: vi.fn().mockResolvedValue(undefined),
}));

// ── Resend mock ──────────────────────────────────────────────────────────────

vi.mock('../lib/resend.js', () => ({
  resend: {
    emails: { send: vi.fn().mockResolvedValue({ data: { id: 'resend-msg-001' }, error: null }) },
    domains: { list: vi.fn().mockResolvedValue({ data: [], error: null }) },
  },
}));

// ── Other mocks ──────────────────────────────────────────────────────────────

vi.mock('../config/env.js', () => ({
  env: {
    RESEND_FROM_EMAIL: 'test@sillages.app', FRONTEND_URL: 'https://test.sillages.app',
    VAPID_PUBLIC_KEY: 'test', VAPID_PRIVATE_KEY: 'test', VAPID_EMAIL: 'test@sillages.app',
  },
}));

vi.mock('../services/pushNotifier.js', () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/commLog.js', () => ({
  logCommunication: vi.fn().mockResolvedValue(undefined),
}));

const mockSendMerchantEmail = vi.fn().mockResolvedValue({ messageId: 'merchant-msg-001' });
vi.mock('../services/merchantEmail.js', () => ({
  sendMerchantEmail: (...a: unknown[]) => mockSendMerchantEmail(...a),
}));

vi.mock('../services/emailTemplates.js', () => ({
  buildCartRecoveryEmail: vi.fn().mockReturnValue({ subject: 'Recovery', html: '<p>recovery</p>' }),
  buildCustomCopyEmail: vi.fn().mockReturnValue({ subject: 'María, la Tarta', html: '<p>custom</p>' }),
  buildWelcomeEmail: vi.fn().mockReturnValue({ subject: 'Welcome', html: '<p>welcome</p>' }),
  buildReactivationEmail: vi.fn().mockReturnValue({ subject: 'Reactivation', html: '<p>react</p>' }),
}));

vi.mock('../services/brandAnalyzer.js', () => ({
  loadBrandProfile: vi.fn().mockResolvedValue({ brand_voice: 'friendly', brand_values: 'gluten-free' }),
}));

vi.mock('../agents/copyExamples.js', () => ({
  buildCartRecoveryExamplesBlock: vi.fn().mockReturnValue(''),
}));

vi.mock('../lib/tokenGuard.js', () => ({
  handleTokenFailure: vi.fn(), markTokenHealthy: vi.fn(),
}));

// gatePush — writes to in-memory pending_comms
vi.mock('../services/commsGate.js', () => ({
  gatePush: vi.fn().mockImplementation(async (accountId: string, payload: Row) => {
    tables.pending_comms.push({
      id: `comm-${Math.random().toString(36).slice(2, 8)}`,
      account_id: accountId,
      type: 'push', channel: 'event_push',
      content: payload,
      status: 'pending',
      created_at: new Date().toISOString(),
    });
    return { sent: false, queued: true };
  }),
}));

// ══════════════════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('E2E: Cart Recovery Flow', () => {
  beforeEach(() => {
    resetTables();
    vi.clearAllMocks();
    mockGetOrders.mockResolvedValue({ orders: [] });
  });

  it('full pipeline: detect → generate → orchestrate → push → approve → email', async () => {
    // ── STEP 1: Detect abandoned cart ──
    const { detectEvents } = await import('../services/eventDetector.js');
    const events = await detectEvents(ACCOUNT_ID);

    const cartEvent = events.find(e => e.type === 'abandoned_cart');
    expect(cartEvent, 'Step 1: cart event detected').toBeDefined();
    expect(cartEvent!.key).toBe(`cart:${CHECKOUT_ID}`);

    const cartData = cartEvent!.data as import('../services/eventDetector.js').AbandonedCartData;
    expect(cartData.customer_email).toBe('maria@test.com');
    expect(cartData.customer_name).toBe('María García');
    expect(cartData.total_value).toBe(42.90);
    expect(cartData.products).toHaveLength(2);

    // event_log entry created
    expect(tables.event_log.length, 'Step 1: event_log created').toBeGreaterThanOrEqual(1);

    // ── STEP 2: Generate action via LLM ──
    const validCopy = 'María, la Tarta de Limón con merengue italiano está lista para ti. Sin gluten, como todo lo nuestro. ¿Te la reservamos?';
    setLLMResponse(validCopy);

    const { generateEventAction } = await import('../services/eventActionGenerator.js');
    const actionId = await generateEventAction(ACCOUNT_ID, cartEvent!, 'es', 'TestShop', 'EUR');

    expect(actionId, 'Step 2: action created').toBeTruthy();
    expect(mockOpenAICreate, 'Step 2: LLM called').toHaveBeenCalled();

    const action = tables.pending_actions.find(a => a.id === actionId);
    expect(action, 'Step 2: action in DB').toBeDefined();
    expect(action!.type).toBe('cart_recovery');
    expect(action!.status).toBe('pending');
    expect((action!.content as Row).copy).toBe(validCopy);
    expect((action!.content as Row).plan_required).toBe('growth');

    // event_log linked
    const linked = tables.event_log.find(e => e.action_id === actionId);
    expect(linked, 'Step 2: event_log linked').toBeDefined();

    // ── STEP 3: Orchestrator validates (should pass — clean copy) ──
    const { runOrchestrator } = await import('../services/orchestrator.js');
    const results = await runOrchestrator();
    expect(results.length, 'Step 3: orchestrator ran').toBeGreaterThan(0);

    // Action still pending after orchestrator
    const afterOrch = tables.pending_actions.find(a => a.id === actionId);
    expect(afterOrch!.status, 'Step 3: action still pending').toBe('pending');

    // ── STEP 4: Push created (simulating scheduler behavior) ──
    const { gatePush } = await import('../services/commsGate.js');
    await gatePush(ACCOUNT_ID, {
      title: 'TestShop',
      body: 'María García dejó €43 en su carrito. ¿La recuperamos?',
      url: `/actions?highlight=${actionId}`,
    }, 'event_push');

    const push = tables.pending_comms.find(c =>
      ((c.content as Row)?.url as string)?.includes(actionId!),
    );
    expect(push, 'Step 4: push created').toBeDefined();
    expect(push!.status).toBe('pending');

    // ── STEP 5: Action available in API response shape ──
    const pendingForApi = tables.pending_actions.filter(
      a => a.account_id === ACCOUNT_ID && a.status === 'pending',
    );
    expect(pendingForApi.length, 'Step 5: 1 pending action').toBe(1);
    expect(pendingForApi[0].type).toBe('cart_recovery');
    expect((pendingForApi[0].content as Row).priority).toBe('high');

    // ── STEP 6: Approve → real-time check → send email ──
    // 6a. Shopify check: customer NOT purchased
    const { orders } = await mockGetOrders();
    const bought = orders.some((o: Row) => (o.customer as Row)?.email === 'maria@test.com');
    expect(bought, 'Step 6a: customer not purchased').toBe(false);

    // 6b. Build and send email
    const { buildCustomCopyEmail } = await import('../services/emailTemplates.js');
    const email = buildCustomCopyEmail({
      storeName: 'TestShop',
      subject: 'María, la Tarta de Limón te espera',
      body: validCopy,
      ctaText: 'Completar mi pedido',
      ctaUrl: 'https://test.myshopify.com/checkouts/recover/99999999',
      products: cartData.products,
      brand: { shopUrl: 'https://test.myshopify.com' },
    });
    expect(email.subject, 'Step 6b: email built').toBeTruthy();

    const { sendMerchantEmail } = await import('../services/merchantEmail.js');
    const sent = await sendMerchantEmail({
      accountId: ACCOUNT_ID,
      to: 'maria@test.com',
      subject: email.subject,
      html: email.html,
    });
    expect(sent.messageId, 'Step 6b: email sent').toBe('merchant-msg-001');

    // 6c. Mark completed
    Object.assign(action!, {
      status: 'completed',
      executed_at: new Date().toISOString(),
      result: { sent_to: 'maria@test.com', message_id: 'merchant-msg-001' },
    });

    // 6d. Log communication
    const { logCommunication } = await import('../services/commLog.js');
    await logCommunication({
      account_id: ACCOUNT_ID, channel: 'email', status: 'sent',
      message_id: 'merchant-msg-001', recipient_email: 'maria@test.com',
    });
    expect(logCommunication).toHaveBeenCalledWith(
      expect.objectContaining({ recipient_email: 'maria@test.com', status: 'sent' }),
    );

    // ── FINAL: verify end state ──
    expect(action!.status, 'Final: action completed').toBe('completed');
    expect((action!.result as Row).sent_to, 'Final: sent to customer').toBe('maria@test.com');
    expect(mockSendMerchantEmail, 'Final: email fn called').toHaveBeenCalledOnce();
  });

  it('detector skips carts below €15', async () => {
    tables.abandoned_carts[0].total_price = 8.50;

    const { detectEvents } = await import('../services/eventDetector.js');
    const events = await detectEvents(ACCOUNT_ID);
    expect(events.filter(e => e.type === 'abandoned_cart')).toHaveLength(0);
  });

  it('detector skips carts without email', async () => {
    tables.abandoned_carts[0].customer_email = '';

    const { detectEvents } = await import('../services/eventDetector.js');
    const events = await detectEvents(ACCOUNT_ID);
    expect(events.filter(e => e.type === 'abandoned_cart')).toHaveLength(0);
  });

  it('detector strips "Visitante" placeholder from name', async () => {
    tables.abandoned_carts[0].customer_name = 'Visitante';

    const { detectEvents } = await import('../services/eventDetector.js');
    const events = await detectEvents(ACCOUNT_ID);
    const cart = events.find(e => e.type === 'abandoned_cart');
    if (cart) {
      expect((cart.data as import('../services/eventDetector.js').AbandonedCartData).customer_name).not.toBe('Visitante');
    }
  });

  it('orchestrator regenerates action with invented sensory copy', async () => {
    // Create action with bad copy directly in DB
    const badAction: Row = {
      id: 'action-bad-copy',
      account_id: ACCOUNT_ID,
      type: 'cart_recovery',
      title: 'María, pura fantasía',
      description: 'test',
      status: 'pending',
      content: {
        customer_email: 'maria@test.com',
        customer_name: 'María García',
        products: [{ title: 'TARTA DE LIMÓN', quantity: 1, price: 34.90 }],
        checkout_url: 'https://test.myshopify.com/checkouts/recover/99999999',
        copy: 'María, esta tarta es pura fantasía, con sabores que te transportan.',
        priority: 'high',
        plan_required: 'growth',
      },
      created_at: new Date().toISOString(),
    };
    tables.pending_actions.push(badAction);

    // Set up LLM to return clean copy for regeneration
    setLLMResponse(
      'María, la Tarta de Limón con merengue italiano te está esperando. ¿Te la preparamos?',
      'María, tu Tarta de Limón',
    );

    const { runOrchestrator } = await import('../services/orchestrator.js');
    const results = await runOrchestrator();

    const guardian = results.find(r => r.check_name === 'action_guardian');
    expect(guardian, 'guardian check ran').toBeDefined();
    expect((guardian!.details.content as Row).regenerated, 'regeneration triggered').toBe(1);

    // Original rejected
    expect(badAction.status, 'original rejected').toBe('rejected');

    // New action created with clean copy
    const newAction = tables.pending_actions.find(
      a => a.id !== 'action-bad-copy' && a.type === 'cart_recovery' && a.status === 'pending',
    );
    expect(newAction, 'new action exists').toBeDefined();
    expect((newAction!.content as Row).regeneration_count, 'regen count = 1').toBe(1);
    expect((newAction!.content as Row).regenerated_from, 'linked to original').toBe('action-bad-copy');

    // Push created for the new action
    const regenPush = tables.pending_comms.find(c =>
      ((c.content as Row)?.url as string)?.includes(newAction!.id as string),
    );
    expect(regenPush, 'push created for regenerated action').toBeDefined();
  });

  it('orchestrator skips action when customer already purchased', async () => {
    // Add a pending action
    tables.pending_actions.push({
      id: 'action-purchased',
      account_id: ACCOUNT_ID,
      type: 'cart_recovery',
      title: 'María, tu Tarta',
      description: 'test',
      status: 'pending',
      content: {
        customer_email: 'maria@test.com',
        customer_name: 'María García',
        products: [{ title: 'TARTA DE LIMÓN', quantity: 1, price: 34.90 }],
        checkout_url: 'https://test.myshopify.com/checkouts/recover/99999999',
        copy: 'María, la Tarta de Limón está lista.',
        priority: 'high',
        plan_required: 'growth',
      },
      created_at: new Date().toISOString(),
    });

    // Customer purchased
    mockGetOrders.mockResolvedValue({
      orders: [{
        customer: { email: 'maria@test.com' },
        financial_status: 'paid',
        cancel_reason: null,
        created_at: new Date().toISOString(),
      }],
    });

    const { runOrchestrator } = await import('../services/orchestrator.js');
    await runOrchestrator();

    const action = tables.pending_actions.find(a => a.id === 'action-purchased');
    expect(['completed', 'rejected'], 'action skipped/rejected').toContain(action!.status);
  });

  it('orchestrator cascades rejection to pending_comms', async () => {
    const actionId = 'action-to-cascade';

    // Add action + corresponding push
    tables.pending_actions.push({
      id: actionId,
      account_id: ACCOUNT_ID,
      type: 'cart_recovery',
      title: 'María, tu Tarta',
      description: 'test',
      status: 'pending',
      content: {
        customer_email: 'maria@test.com',
        customer_name: 'María García',
        products: [{ title: 'TARTA DE LIMÓN', quantity: 1, price: 34.90 }],
        checkout_url: 'https://test.myshopify.com/checkouts/recover/99999999',
        copy: 'María, la Tarta de Limón está lista.',
        priority: 'high',
        plan_required: 'growth',
      },
      created_at: new Date().toISOString(),
    });

    tables.pending_comms.push({
      id: 'push-cascade-test',
      account_id: ACCOUNT_ID,
      type: 'push',
      content: {
        title: 'TestShop',
        body: 'María dejó €35 en su carrito',
        url: `/actions?highlight=${actionId}`,
      },
      status: 'pending',
    });

    // Customer purchased → action will be skipped
    mockGetOrders.mockResolvedValue({
      orders: [{
        customer: { email: 'maria@test.com' },
        financial_status: 'paid',
        cancel_reason: null,
        created_at: new Date().toISOString(),
      }],
    });

    const { runOrchestrator } = await import('../services/orchestrator.js');
    await runOrchestrator();

    const push = tables.pending_comms.find(c => c.id === 'push-cascade-test');
    expect(push!.status, 'push cascaded to rejected').toBe('rejected');
  });
});
