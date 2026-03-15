import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import axios from 'axios';

async function main() {
  // Get Andrea's connection
  const { data: acc } = await supabase
    .from('accounts')
    .select('id')
    .eq('email', 'andrea@nicolina.es')
    .single();
  
  if (!acc) { console.error('Account not found'); return; }

  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, access_token, token_status')
    .eq('account_id', acc.id)
    .single();

  if (!conn) { console.error('No connection'); return; }

  console.log(`Shop: ${conn.shop_domain} | Token: ${conn.token_status}`);
  
  const api = axios.create({
    baseURL: `https://${conn.shop_domain}/admin/api/2024-04`,
    headers: { 'X-Shopify-Access-Token': conn.access_token },
    timeout: 15000,
  });

  // ═══ 1. HISTORIAL COMPLETO ═══
  console.log('\n═══════════════════════════════════════════');
  console.log('  1. HISTORIAL COMPLETO DE PEDIDOS');
  console.log('═══════════════════════════════════════════');

  // Order count
  const { data: countData } = await api.get('/orders/count.json', { params: { status: 'any' } });
  console.log(`Total pedidos (Shopify): ${countData.count}`);

  // Get ALL orders paginated
  let allOrders: any[] = [];
  let pageUrl = '/orders.json?status=any&limit=250&fields=id,created_at,total_price,line_items,customer,financial_status';
  let pageNum = 0;
  
  while (pageUrl && pageNum < 20) {
    pageNum++;
    const resp = await api.get(pageUrl);
    const orders = resp.data.orders;
    allOrders = allOrders.concat(orders);
    
    // Check Link header for next page
    const linkHeader = resp.headers['link'] as string | undefined;
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (match) {
        pageUrl = match[1].replace(`https://${conn.shop_domain}/admin/api/2024-04`, '');
      } else {
        break;
      }
    } else {
      break;
    }
  }

  console.log(`Total pedidos descargados: ${allOrders.length}`);
  
  // Sort by date
  allOrders.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  
  const firstOrder = allOrders[0];
  const lastOrder = allOrders[allOrders.length - 1];
  console.log(`Primer pedido: ${firstOrder?.created_at?.slice(0, 10)} — ${firstOrder?.total_price}`);
  console.log(`Último pedido: ${lastOrder?.created_at?.slice(0, 10)} — ${lastOrder?.total_price}`);
  
  const totalRevenue = allOrders
    .filter((o: any) => o.financial_status !== 'refunded' && o.financial_status !== 'voided')
    .reduce((sum: number, o: any) => sum + parseFloat(o.total_price || '0'), 0);
  console.log(`Revenue total (no refunded): €${totalRevenue.toFixed(2)}`);
  console.log(`Revenue promedio por pedido: €${(totalRevenue / allOrders.filter((o: any) => o.financial_status !== 'refunded').length).toFixed(2)}`);

  // ═══ 2. VALIDACIÓN DÍA CONCRETO: 12 marzo ═══
  console.log('\n═══════════════════════════════════════════');
  console.log('  2. VALIDACIÓN — 12 MARZO 2026');
  console.log('═══════════════════════════════════════════');

  const dayStart = '2026-03-12T00:00:00+01:00';
  const dayEnd = '2026-03-12T23:59:59+01:00';

  const dayOrders = allOrders.filter((o: any) => {
    const d = o.created_at?.slice(0, 10);
    return d === '2026-03-12';
  });

  console.log(`\n── Shopify directo (12 marzo) ──`);
  console.log(`Pedidos: ${dayOrders.length}`);
  
  let dayRevenue = 0;
  const dayProducts: Record<string, number> = {};
  const dayCustomers: string[] = [];
  
  for (const o of dayOrders) {
    dayRevenue += parseFloat(o.total_price || '0');
    const custName = o.customer ? `${o.customer.first_name ?? ''} ${o.customer.last_name ?? ''}`.trim() : 'Guest';
    dayCustomers.push(custName);
    for (const li of o.line_items ?? []) {
      dayProducts[li.title] = (dayProducts[li.title] || 0) + li.quantity;
    }
  }
  
  console.log(`Revenue: €${dayRevenue.toFixed(2)}`);
  console.log(`Clientes: ${dayCustomers.join(', ') || 'ninguno'}`);
  console.log(`Productos:`);
  for (const [name, qty] of Object.entries(dayProducts)) {
    console.log(`  ${name}: ${qty} uds`);
  }

  // Compare with Supabase snapshot
  const { data: snapshot } = await supabase
    .from('shopify_daily_snapshots')
    .select('*')
    .eq('account_id', acc.id)
    .eq('snapshot_date', '2026-03-12')
    .maybeSingle();

  console.log(`\n── Supabase snapshot (12 marzo) ──`);
  if (snapshot) {
    console.log(`Pedidos: ${snapshot.total_orders}`);
    console.log(`Revenue: €${snapshot.total_revenue}`);
    console.log(`Sesiones: ${snapshot.sessions}`);
    console.log(`Nuevos clientes: ${snapshot.new_customers}`);
    console.log(`Conversión: ${(snapshot.conversion_rate * 100).toFixed(2)}%`);
    const topProds = snapshot.top_products as any[];
    if (topProds?.length > 0) {
      console.log(`Productos:`);
      for (const p of topProds) {
        console.log(`  ${p.title}: ${p.quantity_sold} uds — €${p.revenue}`);
      }
    }

    // Compare
    console.log(`\n── Comparación ──`);
    console.log(`Pedidos: Shopify=${dayOrders.length} vs Snapshot=${snapshot.total_orders} ${dayOrders.length === snapshot.total_orders ? '✅' : '❌ DIFERENCIA'}`);
    console.log(`Revenue: Shopify=€${dayRevenue.toFixed(2)} vs Snapshot=€${snapshot.total_revenue} ${Math.abs(dayRevenue - snapshot.total_revenue) < 1 ? '✅' : '❌ DIFERENCIA'}`);
  } else {
    console.log('❌ No hay snapshot para 12 marzo');
  }

  // Check a few more days
  for (const checkDate of ['2026-03-13', '2026-03-14', '2026-03-11', '2026-03-10']) {
    const dOrders = allOrders.filter((o: any) => o.created_at?.slice(0, 10) === checkDate);
    const dRevenue = dOrders.reduce((s: number, o: any) => s + parseFloat(o.total_price || '0'), 0);
    const { data: dSnap } = await supabase
      .from('shopify_daily_snapshots')
      .select('total_orders, total_revenue')
      .eq('account_id', acc.id)
      .eq('snapshot_date', checkDate)
      .maybeSingle();
    
    const ordersMatch = dSnap ? dOrders.length === dSnap.total_orders : false;
    const revMatch = dSnap ? Math.abs(dRevenue - dSnap.total_revenue) < 1 : false;
    console.log(`${checkDate}: Shopify ${dOrders.length} pedidos €${dRevenue.toFixed(2)} | Snapshot ${dSnap?.total_orders ?? 'N/A'} pedidos €${dSnap?.total_revenue ?? 'N/A'} ${ordersMatch && revMatch ? '✅' : dSnap ? '❌' : '⚠️ NO SNAP'}`);
  }

  // ═══ 3. CLIENTES ═══
  console.log('\n═══════════════════════════════════════════');
  console.log('  3. CLIENTES');
  console.log('═══════════════════════════════════════════');

  const { data: custCountData } = await api.get('/customers/count.json');
  console.log(`Total clientes en Shopify: ${custCountData.count}`);

  // Get all customers to analyze
  let allCustomers: any[] = [];
  let custUrl = '/customers.json?limit=250&fields=id,first_name,last_name,email,orders_count,total_spent,created_at';
  let custPage = 0;
  
  while (custUrl && custPage < 10) {
    custPage++;
    const resp = await api.get(custUrl);
    allCustomers = allCustomers.concat(resp.data.customers);
    
    const linkHeader = resp.headers['link'] as string | undefined;
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (match) {
        custUrl = match[1].replace(`https://${conn.shop_domain}/admin/api/2024-04`, '');
      } else break;
    } else break;
  }

  console.log(`Total clientes descargados: ${allCustomers.length}`);
  
  const oneTimers = allCustomers.filter((c: any) => c.orders_count === 1);
  const repeaters = allCustomers.filter((c: any) => c.orders_count > 1);
  const zeroOrders = allCustomers.filter((c: any) => c.orders_count === 0);
  
  console.log(`  0 pedidos (solo registrados): ${zeroOrders.length}`);
  console.log(`  1 pedido (una sola compra): ${oneTimers.length}`);
  console.log(`  2+ pedidos (recurrentes): ${repeaters.length}`);
  console.log(`  % recurrentes: ${((repeaters.length / (oneTimers.length + repeaters.length)) * 100).toFixed(1)}%`);

  // Our customer intelligence comparison
  console.log(`\n── Nuestro customerIntelligence usa pedidos de 60 días ──`);
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const recentOrders = allOrders.filter((o: any) => o.created_at?.slice(0, 10) >= sixtyDaysAgo);
  const recentCustomerMap = new Map<string, number>();
  for (const o of recentOrders) {
    const id = o.customer?.id?.toString() ?? 'guest';
    recentCustomerMap.set(id, (recentCustomerMap.get(id) || 0) + 1);
  }
  const recent1time = [...recentCustomerMap.values()].filter(c => c === 1).length;
  const recentRepeat = [...recentCustomerMap.values()].filter(c => c > 1).length;
  console.log(`  Clientes últimos 60 días: ${recentCustomerMap.size}`);
  console.log(`  1 pedido en 60d: ${recent1time}`);
  console.log(`  2+ pedidos en 60d: ${recentRepeat}`);

  // ═══ 4. CARRITOS ABANDONADOS ═══
  console.log('\n═══════════════════════════════════════════');
  console.log('  4. CARRITOS ABANDONADOS');
  console.log('═══════════════════════════════════════════');

  try {
    const { data: checkouts } = await api.get('/checkouts.json', { 
      params: { limit: 10, status: 'open' } 
    });
    
    const carts = checkouts.checkouts ?? [];
    console.log(`Carritos abandonados abiertos: ${carts.length}`);
    
    for (const cart of carts.slice(0, 5)) {
      const custName = cart.customer 
        ? `${cart.customer.first_name ?? ''} ${cart.customer.last_name ?? ''}`.trim() 
        : cart.email ?? 'Anónimo';
      const products = (cart.line_items ?? []).map((li: any) => `${li.title} x${li.quantity}`).join(', ');
      const total = cart.total_price ?? '?';
      const created = cart.created_at?.slice(0, 16) ?? '?';
      console.log(`  ${created} | ${custName} | €${total} | ${products}`);
    }
  } catch (err: any) {
    const status = err.response?.status;
    const msg = err.response?.data?.errors ?? err.message;
    console.log(`❌ Error al obtener carritos: HTTP ${status}`);
    console.log(`   ${JSON.stringify(msg)}`);
    console.log(`   ¿Scope necesario? read_checkouts — verificar en la app de Shopify`);
    
    // Try abandoned checkouts endpoint instead
    console.log('\n── Probando endpoint alternativo: /checkouts/count.json ──');
    try {
      const { data: cCount } = await api.get('/checkouts/count.json');
      console.log(`Checkouts count: ${cCount.count}`);
    } catch (err2: any) {
      console.log(`También falla: HTTP ${err2.response?.status} — ${JSON.stringify(err2.response?.data?.errors ?? err2.message)}`);
    }
  }

  // Also check what scopes we have
  console.log('\n── Scopes de nuestra app ──');
  try {
    const { data: shopData } = await api.get('/shop.json');
    console.log(`Shop: ${shopData.shop.name} (${shopData.shop.domain})`);
    console.log(`Plan: ${shopData.shop.plan_name}`);
    console.log(`Currency: ${shopData.shop.currency}`);
  } catch (err: any) {
    console.log(`Error: ${err.message}`);
  }
  
  // Check access scopes
  try {
    const resp = await axios.get(`https://${conn.shop_domain}/admin/oauth/access_scopes.json`, {
      headers: { 'X-Shopify-Access-Token': conn.access_token },
      timeout: 10000,
    });
    const scopes = resp.data.access_scopes.map((s: any) => s.handle);
    console.log(`Scopes: ${scopes.join(', ')}`);
    console.log(`¿read_checkouts? ${scopes.includes('read_checkouts') ? '✅ SÍ' : '❌ NO'}`);
  } catch (err: any) {
    console.log(`No se pudieron obtener scopes: ${err.message}`);
  }
}

main().catch(e => console.error(e));
