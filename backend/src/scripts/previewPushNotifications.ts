import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { detectEvents } from '../services/eventDetector.js';
import type { NewFirstBuyerData, AbandonedCartData, OverdueCustomerData } from '../services/eventDetector.js';

/**
 * Preview what push notifications would look like for NICOLINA
 * using real Shopify data. Does NOT send anything.
 */
async function main() {
  // Get Andrea's account
  const { data: acc } = await supabase
    .from('accounts')
    .select('id, full_name, language')
    .eq('email', 'andrea@nicolina.es')
    .single();

  if (!acc) { console.error('Account not found'); process.exit(1); }

  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_name, shop_currency')
    .eq('account_id', acc.id)
    .single();

  const storeName = conn?.shop_name ?? 'NICOLINA';
  const currency = conn?.shop_currency ?? 'EUR';
  const cs = currency === 'EUR' ? '€' : '$';

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  PREVIEW: 5 TIPOS DE PUSH NOTIFICATION — ${storeName}`);
  console.log(`  Datos reales de Shopify. NO se envía nada.`);
  console.log(`${'═'.repeat(60)}\n`);

  // ── Detect real events ──
  console.log('Detectando eventos reales...\n');
  const events = await detectEvents(acc.id);

  // ── TIPO 1: Nueva compra de primer cliente ──
  console.log(`${'─'.repeat(60)}`);
  console.log(`  📱 TIPO 1 — NUEVA COMPRA DE PRIMER CLIENTE`);
  console.log(`${'─'.repeat(60)}`);

  const firstBuyerEvents = events.filter(e => e.type === 'new_first_buyer');
  if (firstBuyerEvents.length > 0) {
    for (const ev of firstBuyerEvents.slice(0, 2)) {
      const d = ev.data as NewFirstBuyerData;
      console.log(`\n  TITLE: ${storeName}`);
      console.log(`  BODY:  ${d.customer_name} compró ${d.product_purchased} por primera vez. ¿Le mandamos un agradecimiento?`);
      console.log(`  URL:   /actions?highlight=<action_id>`);
      console.log(`  → Al tocar: abre acción welcome_email para ${d.customer_name}`);
    }
  } else {
    // Simulate with last order data
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const { data: snap } = await supabase
      .from('shopify_daily_snapshots')
      .select('top_products')
      .eq('account_id', acc.id)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .single();

    const topProduct = (snap?.top_products as any[])?.[0]?.title ?? 'VOLCÁN DE CHOCOLATE';
    console.log(`\n  (Sin nuevos primeros compradores hoy — ejemplo con datos recientes)\n`);
    console.log(`  TITLE: ${storeName}`);
    console.log(`  BODY:  Laura Maier compró ${topProduct} por primera vez. ¿Le mandamos un agradecimiento?`);
    console.log(`  URL:   /actions?highlight=<action_id>`);
    console.log(`  → Al tocar: abre acción welcome_email para Laura Maier`);
  }

  // ── TIPO 2: Carrito abandonado ──
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  📱 TIPO 2 — CARRITO ABANDONADO DETECTADO`);
  console.log(`${'─'.repeat(60)}`);

  const cartEvents = events.filter(e => e.type === 'abandoned_cart');
  if (cartEvents.length > 0) {
    for (const ev of cartEvents.slice(0, 2)) {
      const d = ev.data as AbandonedCartData;
      const products = d.products.map(p => p.title).join(', ');
      console.log(`\n  TITLE: ${storeName}`);
      console.log(`  BODY:  ${d.customer_name} dejó ${cs}${d.total_value.toFixed(0)} en su carrito (${products}). ¿La recuperamos?`);
      console.log(`  URL:   /actions?highlight=<action_id>`);
      console.log(`  → Al tocar: abre acción cart_recovery con email preparado`);
    }
  } else {
    // Load from abandoned_carts table
    const { data: carts } = await supabase
      .from('abandoned_carts')
      .select('customer_name, customer_email, products, total_price')
      .eq('account_id', acc.id)
      .order('abandoned_at', { ascending: false })
      .limit(2);

    if (carts && carts.length > 0) {
      console.log(`\n  (Carritos ya detectados previamente — mostrando ejemplo)\n`);
      for (const cart of carts) {
        const products = (cart.products as any[])?.map((p: any) => p.title).join(', ') ?? '?';
        console.log(`  TITLE: ${storeName}`);
        console.log(`  BODY:  ${cart.customer_name} dejó ${cs}${Number(cart.total_price).toFixed(0)} en su carrito (${products}). ¿La recuperamos?`);
        console.log(`  URL:   /actions?highlight=<action_id>`);
        console.log(`  → Al tocar: abre acción cart_recovery con email preparado\n`);
      }
    }
  }

  // ── TIPO 3: Cliente habitual que no vuelve ──
  console.log(`${'─'.repeat(60)}`);
  console.log(`  📱 TIPO 3 — CLIENTE HABITUAL QUE NO VUELVE`);
  console.log(`${'─'.repeat(60)}`);

  const overdueEvents = events.filter(e => e.type === 'overdue_customer');
  if (overdueEvents.length > 0) {
    for (const ev of overdueEvents.slice(0, 2)) {
      const d = ev.data as OverdueCustomerData;
      console.log(`\n  TITLE: ${storeName}`);
      console.log(`  BODY:  ${d.customer_name} no compra desde hace ${d.days_since} días. Suele comprar cada ${d.usual_cycle_days}. ¿Le escribimos?`);
      console.log(`  URL:   /actions?highlight=<action_id>`);
      console.log(`  → Al tocar: abre acción reactivation_email para ${d.customer_name}`);
    }
  } else {
    console.log(`\n  (Sin clientes overdue detectados — ejemplo con datos simulados)\n`);
    console.log(`  TITLE: ${storeName}`);
    console.log(`  BODY:  Raquel Moreno-Torres no compra desde hace 28 días. Suele comprar cada 27. ¿Le escribimos?`);
    console.log(`  URL:   /actions?highlight=<action_id>`);
    console.log(`  → Al tocar: abre acción reactivation_email para Raquel`);
  }

  // ── TIPO 4: Resumen del día ──
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  📱 TIPO 4 — RESUMEN DEL DÍA`);
  console.log(`${'─'.repeat(60)}`);

  const { data: latestSnap } = await supabase
    .from('shopify_daily_snapshots')
    .select('total_revenue, total_orders, new_customers, snapshot_date')
    .eq('account_id', acc.id)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .single();

  if (latestSnap) {
    let body = `Ayer ${cs}${latestSnap.total_revenue.toFixed(0)} · ${latestSnap.total_orders} pedidos`;
    if (latestSnap.new_customers > 0) {
      body += `. ${latestSnap.new_customers} ${latestSnap.new_customers === 1 ? 'cliente nuevo' : 'clientes nuevos'}.`;
    }
    console.log(`\n  TITLE: ${storeName}`);
    console.log(`  BODY:  ${body}`);
    console.log(`  URL:   /dashboard`);
    console.log(`  → Solo informativo, sin acción. Se envía una vez al día.`);
    console.log(`  (Datos del ${latestSnap.snapshot_date})`);
  }

  // ── TIPO 5: Acciones pendientes ──
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  📱 TIPO 5 — ACCIONES PENDIENTES`);
  console.log(`${'─'.repeat(60)}`);

  const { count } = await supabase
    .from('pending_actions')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', acc.id)
    .eq('status', 'pending');

  const n = count ?? 0;
  console.log(`\n  TITLE: ${storeName}`);
  if (n > 0) {
    console.log(`  BODY:  Tienes ${n} ${n === 1 ? 'acción lista' : 'acciones listas'} para aprobar.`);
  } else {
    console.log(`  BODY:  Tienes 4 acciones listas para aprobar.`);
    console.log(`  (Ejemplo — actualmente ${n} pendientes)`);
  }
  console.log(`  URL:   /actions`);
  console.log(`  → Al tocar: abre la tab de Acciones con badge`);

  // ── Summary ──
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  RESUMEN`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Eventos detectados en esta ejecución: ${events.length}`);
  console.log(`    - Primeros compradores: ${firstBuyerEvents.length}`);
  console.log(`    - Carritos abandonados: ${cartEvents.length}`);
  console.log(`    - Clientes overdue:     ${overdueEvents.length}`);
  console.log(`\n  Cada evento genera:`);
  console.log(`    1. Una acción en pending_actions (con copy personalizado)`);
  console.log(`    2. Una push notification que lleva a esa acción`);
  console.log(`\n  El merchant toca la push → ve la acción → Aprobar/Editar/Rechazar`);
  console.log(`  Sin briefs largos. Sin emails diarios. Solo acciones concretas.`);
  console.log(`\n  NO se envió nada. Esto es solo un preview.\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
