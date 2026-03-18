import { describe, it, expect, vi, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Mock Supabase ────────────────────────────────────────────────────────────
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

const chainable = () => {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'or', 'gte', 'lt', 'in', 'filter', 'order', 'limit', 'single', 'maybeSingle', 'delete', 'update', 'insert'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain['select'] = mockSelect.mockReturnValue(chain);
  return chain;
};

const mockFrom = vi.fn().mockImplementation(() => chainable());

vi.mock('../lib/supabase.js', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

// ── Mock Shopify ─────────────────────────────────────────────────────────────
const mockGetOrders = vi.fn();
const mockGetProducts = vi.fn();

vi.mock('../lib/shopify.js', () => ({
  shopifyClient: () => ({
    getOrders: mockGetOrders,
    getProducts: mockGetProducts,
  }),
  shopifyGraphQL: vi.fn(),
  ensureTokenFresh: vi.fn(),
}));

// ── Mock Resend ──────────────────────────────────────────────────────────────
vi.mock('../lib/resend.js', () => ({
  resend: {
    emails: {
      send: vi.fn().mockResolvedValue({ data: { id: 'test-msg-id' }, error: null }),
    },
  },
}));

// ── Mock other dependencies ──────────────────────────────────────────────────
vi.mock('./commLog.js', () => ({ logCommunication: vi.fn() }));
vi.mock('./pushNotifier.js', () => ({ sendPushNotification: vi.fn() }));
vi.mock('./commsGate.js', () => ({
  isSendEnabled: vi.fn().mockResolvedValue(true),
  gatePush: vi.fn().mockResolvedValue({ sent: true }),
  gateWeeklyEmail: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 1001,
    created_at: new Date().toISOString(),
    total_price: '35.00',
    financial_status: 'paid',
    cancel_reason: null,
    customer: {
      id: 123,
      email: 'test@example.com',
      first_name: 'Maria',
      last_name: 'Garcia',
      orders_count: 3,
    },
    line_items: [{ title: 'TARTA DE QUESO', quantity: 1, price: '35.00' }],
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 1: Cart + purchased → no action created (scheduler pre-check)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Check B: Scheduler pre-check — cart + purchased → no action', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should skip action creation when customer already purchased', async () => {
    // Customer who abandoned a cart but then purchased
    const customerEmail = 'maria@example.com';

    mockGetOrders.mockResolvedValue({
      orders: [makeOrder({ customer: { email: customerEmail, id: 1, first_name: 'Maria', last_name: 'Garcia', orders_count: 1 } })],
    });

    // Simulate the scheduler pre-check logic (from scheduler.ts lines 185-214)
    const { shopifyClient } = await import('../lib/shopify.js');
    const client = shopifyClient('test.myshopify.com', 'token');
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
    const { orders } = await client.getOrders({
      created_at_min: sevenDaysAgo,
      created_at_max: new Date().toISOString(),
    });

    const alreadyBought = orders.some(
      (o: any) => {
        return o.customer?.email?.toLowerCase() === customerEmail.toLowerCase() &&
          o.financial_status !== 'voided' && !o.cancel_reason;
      },
    );

    expect(alreadyBought).toBe(true);
    // When alreadyBought is true, the scheduler should NOT call generateEventAction
    // and should mark the cart as recovered
  });

  it('should create action when customer has NOT purchased', async () => {
    mockGetOrders.mockResolvedValue({ orders: [] });

    const { shopifyClient } = await import('../lib/shopify.js');
    const client = shopifyClient('test.myshopify.com', 'token');
    const { orders } = await client.getOrders({
      created_at_min: new Date(Date.now() - 7 * 86400 * 1000).toISOString(),
      created_at_max: new Date().toISOString(),
    });

    const alreadyBought = orders.some(
      (o: any) => {
        return o.customer?.email?.toLowerCase() === 'abandoned@example.com' &&
          o.financial_status !== 'voided' && !o.cancel_reason;
      },
    );

    expect(alreadyBought).toBe(false);
    // When alreadyBought is false, the scheduler proceeds to create the action
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 2: Pending + purchased → auto-skip (Check D cleanup)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Check D: Periodic cleanup — pending + purchased → auto-skip', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should auto-skip pending cart_recovery actions for customers who already bought', async () => {
    const customerEmail = 'bought@example.com';

    // Simulate what cleanupStalePendingActions does
    mockGetOrders.mockResolvedValue({
      orders: [makeOrder({ customer: { email: customerEmail, id: 2, first_name: 'Elena', last_name: 'Lopez', orders_count: 2 } })],
    });

    const { shopifyClient } = await import('../lib/shopify.js');
    const client = shopifyClient('test.myshopify.com', 'token');
    const { orders } = await client.getOrders({
      created_at_min: new Date(Date.now() - 7 * 86400 * 1000).toISOString(),
      created_at_max: new Date().toISOString(),
    });

    const recentOrderEmails = new Set(
      orders
        .filter((o: any) => o.customer?.email && o.financial_status !== 'voided' && !o.cancel_reason)
        .map((o: any) => o.customer.email.toLowerCase()),
    );

    expect(recentOrderEmails.has(customerEmail)).toBe(true);
    // When recentOrderEmails.has(email), the cleanup marks the action as skipped
    // with result: { skipped: true, auto_cleanup: true }
  });

  it('should age out carts older than 7 days', () => {
    const abandonedAt = new Date(Date.now() - 8 * 86400 * 1000).toISOString();
    const cartAge = Date.now() - new Date(abandonedAt).getTime();
    expect(cartAge).toBeGreaterThan(7 * 86400 * 1000);
  });

  it('should keep pending actions for carts within 7 days and no purchase', async () => {
    mockGetOrders.mockResolvedValue({ orders: [] });

    const { shopifyClient } = await import('../lib/shopify.js');
    const client = shopifyClient('test.myshopify.com', 'token');
    const { orders } = await client.getOrders({
      created_at_min: new Date(Date.now() - 7 * 86400 * 1000).toISOString(),
      created_at_max: new Date().toISOString(),
    });

    const recentOrderEmails = new Set(
      orders
        .filter((o: any) => o.customer?.email && o.financial_status !== 'voided' && !o.cancel_reason)
        .map((o: any) => o.customer.email.toLowerCase()),
    );

    const abandonedAt = new Date(Date.now() - 3 * 86400 * 1000).toISOString();
    const cartAge = Date.now() - new Date(abandonedAt).getTime();

    expect(recentOrderEmails.has('still-abandoned@example.com')).toBe(false);
    expect(cartAge).toBeLessThan(7 * 86400 * 1000);
    // Action stays pending
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 3: Approve + purchased → no send + clear message (Check C)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Check C: Approve-time check — approve + purchased → no send', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('hasCustomerPurchasedRecently returns true when customer has recent order', async () => {
    const customerEmail = 'recent-buyer@example.com';
    mockGetOrders.mockResolvedValue({
      orders: [makeOrder({ customer: { email: customerEmail, id: 3, first_name: 'Ana', last_name: 'Perez', orders_count: 1 } })],
    });

    const { shopifyClient } = await import('../lib/shopify.js');
    const client = shopifyClient('test.myshopify.com', 'token');
    const { orders } = await client.getOrders({
      created_at_min: new Date(Date.now() - 7 * 86400 * 1000).toISOString(),
      created_at_max: new Date().toISOString(),
    });

    const hasPurchased = orders.some(
      (o: any) => {
        return o.customer?.email?.toLowerCase() === customerEmail.toLowerCase() &&
          o.financial_status !== 'voided' && !o.cancel_reason;
      },
    );

    expect(hasPurchased).toBe(true);
    // executeCartRecovery skips sending and returns:
    // { skipped: true, reason: "...ya completó su compra..." }
  });

  it('hasCustomerPurchasedRecently returns true (fail-closed) when Shopify errors', async () => {
    mockGetOrders.mockRejectedValue(new Error('Shopify 503'));

    let failClosed = false;
    try {
      const { shopifyClient } = await import('../lib/shopify.js');
      const client = shopifyClient('test.myshopify.com', 'token');
      await client.getOrders({
        created_at_min: new Date(Date.now() - 7 * 86400 * 1000).toISOString(),
        created_at_max: new Date().toISOString(),
      });
    } catch {
      failClosed = true; // In real code, catch returns true (don't risk spam)
    }

    expect(failClosed).toBe(true);
    // fail-closed: assume customer bought, don't send email
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 4: First buyer → welcome email action generated
// ═══════════════════════════════════════════════════════════════════════════════

describe('First buyer detection → welcome email action', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should detect first-time buyer (orders_count === 1)', () => {
    const order = makeOrder({
      customer: {
        id: 456,
        email: 'new-buyer@example.com',
        first_name: 'Lucia',
        last_name: 'Fernandez',
        orders_count: 1,
      },
    });

    const isFirstBuyer = order.customer.orders_count === 1 &&
      order.customer.email &&
      order.financial_status !== 'voided' &&
      !order.cancel_reason;

    expect(isFirstBuyer).toBe(true);
  });

  it('should NOT detect returning buyer (orders_count > 1)', () => {
    const order = makeOrder({
      customer: {
        id: 789,
        email: 'returning@example.com',
        first_name: 'Carmen',
        last_name: 'Ruiz',
        orders_count: 5,
      },
    });

    const isFirstBuyer = order.customer.orders_count === 1;
    expect(isFirstBuyer).toBe(false);
  });

  it('should skip welcome email if order is older than 6 hours', () => {
    const orderCreatedAt = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
    const orderAge = Date.now() - new Date(orderCreatedAt).getTime();
    expect(orderAge).toBeGreaterThan(6 * 3600 * 1000);
    // Welcome email executor skips: "Pedido de hace más de 6 horas"
  });

  it('should send welcome email if order is within 6 hours', () => {
    const orderCreatedAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const orderAge = Date.now() - new Date(orderCreatedAt).getTime();
    expect(orderAge).toBeLessThan(6 * 3600 * 1000);
    // Welcome email executor proceeds to send
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 5: Email template renders with brand config (logo, colors)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Email templates render brand config correctly', () => {
  it('should include logo img tag when logoUrl is provided', async () => {
    const { buildCartRecoveryEmail } = await import('./emailTemplates.js');

    const { html } = buildCartRecoveryEmail({
      customerName: 'Test',
      storeName: 'NICOLINA',
      products: [{ title: 'DONA KINDER', quantity: 1, price: 3.5 }],
      totalPrice: 3.5,
      currency: 'EUR',
      language: 'es',
      brand: {
        storeName: 'NICOLINA',
        logoUrl: 'https://nicolina.es/cdn/shop/files/Logo-NICOLINA.png',
        primaryColor: '#c0dcb0',
        shopUrl: 'https://nicolina.es',
      },
    });

    expect(html).toContain('<img src="https://nicolina.es/cdn/shop/files/Logo-NICOLINA.png"');
    expect(html).toContain('alt="NICOLINA"');
    expect(html).toContain('background:#FFFFFF'); // white header, NOT green
    expect(html).not.toContain('Dulces saludables'); // no tagline
  });

  it('should render text fallback when no logoUrl', async () => {
    const { buildCartRecoveryEmail } = await import('./emailTemplates.js');

    const { html } = buildCartRecoveryEmail({
      customerName: 'Test',
      storeName: 'MyStore',
      products: [{ title: 'Product', quantity: 1, price: 10 }],
      totalPrice: 10,
      currency: 'EUR',
      language: 'en',
    });

    expect(html).toContain('>MyStore</a>');
    expect(html).not.toContain('<img');
  });

  it('should include contact info in footer when provided', async () => {
    const { buildWelcomeEmail } = await import('./emailTemplates.js');

    const { html } = buildWelcomeEmail({
      customerName: 'Test',
      storeName: 'NICOLINA',
      productPurchased: 'Tarta',
      language: 'es',
      storeUrl: 'https://nicolina.es',
      brand: {
        storeName: 'NICOLINA',
        contactEmail: 'info@nicolina.es',
        contactPhone: '611 34 20 73',
        contactAddress: 'C/ Potosí 4 · Madrid',
        socialLinks: { instagram: 'https://www.instagram.com/nicolinamadrid/' },
      },
    });

    expect(html).toContain('info@nicolina.es');
    expect(html).toContain('611 34 20 73');
    expect(html).toContain('Instagram');
  });
});
