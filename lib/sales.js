// Ventas de Mercado Libre: precio, comisión, costo de envío y neto.
const store = require('./store');
const ml = require('./ml');
const zones = require('./zones');
const costs = require('./costs');

const MP_API = process.env.MP_API_BASE || 'https://api.mercadopago.com';
const { get, pick } = ml;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n) => Math.round(n * 100) / 100;

// Rango de fechas en hora de Argentina, partido en meses (la búsqueda de ML pagina mejor así).
function monthChunks(from, to) {
  const out = [];
  let cur = new Date(from + 'T00:00:00-03:00');
  const end = new Date(to + 'T23:59:59-03:00');
  while (cur <= end) {
    const next = new Date(cur); next.setUTCMonth(next.getUTCMonth() + 1);
    const chunkEnd = next > end ? end : new Date(next - 1);
    out.push([cur, chunkEnd]);
    cur = next;
  }
  return out;
}
const mlDate = (d) => {
  // ISO con offset de Argentina: 2026-09-01T00:00:00.000-03:00
  const local = new Date(d.getTime() - 3 * 3600000).toISOString().replace('Z', '');
  return local + '-03:00';
};

async function searchOrders(acc, from, to, onPage) {
  const orders = [];
  for (const [a, b] of monthChunks(from, to)) {
    for (let offset = 0; offset < 10000; offset += 50) {
      const url = `/orders/search?seller=${acc.user_id}&order.date_created.from=${encodeURIComponent(mlDate(a))}&order.date_created.to=${encodeURIComponent(mlDate(b))}&sort=date_asc&limit=50&offset=${offset}`;
      const r = await get(acc, url);
      if (!r.ok) throw new Error(`No pude listar las ventas de ${acc.nickname || acc.user_id}: ${r.data?.message || r.status}`);
      orders.push(...(r.data.results || []));
      if (onPage) onPage(orders.length);
      if (offset + 50 >= (r.data.paging?.total || 0)) break;
    }
  }
  return orders;
}

// Lo recibido en Mercado Pago por los pagos de la venta (si la conexión lo permite).
async function mpReceived(acc, payments) {
  let total = 0, ok = false;
  for (const p of payments || []) {
    if (!p.id || (p.status && p.status !== 'approved')) continue;
    try {
      if (!acc.expires_at || acc.expires_at - Date.now() < 5 * 60 * 1000) await get(acc, '/users/me'); // renueva token si hace falta
      const r = await fetch(`${MP_API}/v1/payments/${p.id}`, { headers: { Authorization: `Bearer ${acc.access_token}` } });
      if (!r.ok) return null;
      const d = await r.json();
      const net = d.transaction_details?.net_received_amount ?? d.net_received_amount;
      if (net === undefined || net === null) return null;
      total += num(net); ok = true;
    } catch { return null; }
  }
  return ok ? round2(total) : null;
}

// Estado de la venta, con el mismo criterio que el resumen de Mercado Libre:
//  ok · cancelled (cancelada después de pagar) · returned (devuelta/reembolsada) · unpaid (nunca se pagó: ML no la cuenta)
//  ml_cancelled: cancelada por Mercado Libre (fraude / control interno): ML la saca de sus métricas.
function orderState(o, shipStatus) {
  const pays = o.payments || [];
  const tags = o.tags || [];
  const cd = o.cancel_detail || {};
  const by = String(cd.requested_by || cd.group || '').toLowerCase();
  const paid = tags.includes('paid') || pays.some(p => ['approved', 'refunded', 'charged_back', 'partially_refunded', 'in_mediation'].includes(p.status));
  const refunded = pays.some(p => ['refunded', 'charged_back'].includes(p.status));
  // Devuelta = el paquete salió hacia el comprador (y después volvió). Si se canceló antes de despachar, es cancelada.
  const shippedOut = ['shipped', 'delivered', 'not_delivered'].includes(shipStatus) || tags.includes('delivered');
  if (o.status === 'cancelled' || o.status === 'invalid') {
    if (!paid) return 'unpaid';
    if (shippedOut) return 'returned';                 // el paquete salió: devolución, la haya procesado quien sea
    if (['fraud', 'internal', 'mercadolibre', 'ml', 'meli'].includes(by)) return 'ml_cancelled';
    return 'cancelled';
  }
  if (refunded) return 'returned';
  return 'ok';
}
// Motivo legible de la cancelación.
function cancelReason(o) {
  const cd = o.cancel_detail || {};
  const by = String(cd.requested_by || cd.group || '').toLowerCase();
  const map = { buyer: 'cancelada por el comprador', seller: 'cancelada por vos', fraud: 'cancelada por Mercado Libre (control de fraude)',
    internal: 'cancelada por Mercado Libre', shipment: 'cancelada por un problema con el envío', mediations: 'cancelada por reclamo' };
  return map[by] || cd.description || '';
}
const EXCLUDED = ['unpaid', 'ml_cancelled'];

// Arma el registro de una venta. shippingSeen evita contar dos veces el envío de un carrito (pack).
async function buildSale(acc, o, shippingSeen, useMp) {
  const items = (o.order_items || []).map(i => ({
    title: i.item?.title || '', sku: pick(i.item?.seller_sku, i.item?.seller_custom_field), item_id: pick(i.item?.id), variation_id: pick(i.item?.variation_id), qty: num(i.quantity) || 1,
    unit_price: num(i.unit_price), fee: round2(num(i.sale_fee) * (num(i.quantity) || 1)),
  }));
  const gross = round2(num(o.total_amount) || items.reduce((t, i) => t + i.unit_price * i.qty, 0));
  const fee = round2(items.reduce((t, i) => t + i.fee, 0));
  const shipId = pick(o.shipping?.id);

  let shipCost = 0, logistic = '', city = '', state = '', firstOfShipment = false, shipStatus = '';
  if (shipId && !shippingSeen.has(shipId)) {
    shippingSeen.add(shipId); firstOfShipment = true;
    const sh = await get(acc, `/shipments/${shipId}`).catch(() => null);
    if (sh?.ok) {
      logistic = pick(sh.data.logistic_type, sh.data.logistic?.type);
      shipStatus = pick(sh.data.status);
      const ra = sh.data.receiver_address || sh.data.destination?.shipping_address || {};
      city = pick(ra.city?.name); state = pick(ra.state?.name);
    }
    const c = await get(acc, `/shipments/${shipId}/costs`).catch(() => null);
    if (c?.ok) {
      const senders = c.data.senders || [];
      const mine = senders.find(x => String(x.user_id) === String(acc.user_id)) || senders[0];
      shipCost = round2(num(mine?.cost));
    }
  }

  // Estado de la venta, con el mismo criterio que el resumen de Mercado Libre:
  //  ok · cancelled (cancelada después de pagar) · returned (devuelta/reembolsada) · unpaid (nunca se pagó: ML no la cuenta)
  const tags = o.tags || [];
  const saleState = orderState(o, shipStatus);
  const cancelled = saleState !== 'ok';
  const net = cancelled ? 0 : round2(gross - fee - shipCost);
  const received = !cancelled && useMp ? await mpReceived(acc, o.payments) : null;

  const sale = {
    order_id: String(o.id), pack_id: pick(o.pack_id), account_id: acc.user_id, account_nickname: acc.nickname || '',
    date: o.date_created, status: o.status, order_state: saleState, cancelled, cancel_reason: cancelReason(o),
    cancel_detail: o.cancel_detail ? { group: o.cancel_detail.group || '', requested_by: o.cancel_detail.requested_by || '', code: o.cancel_detail.code || '', description: o.cancel_detail.description || '' } : null, buyer: pick(o.buyer?.nickname), tags, ship_status: shipStatus,
    items, title: items.map(i => (i.qty > 1 ? `${i.qty}x ` : '') + i.title).join(' | '), qty: items.reduce((t, i) => t + i.qty, 0),
    gross, fee, ship_cost: shipCost, net, mp_received: received,
    shipment_id: shipId, logistic, is_flex: logistic === 'self_service', city, state, first_of_shipment: firstOfShipment,
    fetched_at: new Date().toISOString(),
  };
  return sale;
}

// Agrega zona y "neto después de tu envío Flex" (se calcula al momento con los precios actuales).
// Impuestos (IVA + Ingresos Brutos) como % del precio de venta; editable en Configuración.
const DEFAULT_TAX_PCT = 23;
const titleKey = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
// Etapa para el filtro: to_ship (por enviar) · in_transit (en camino) · delivered (entregada) · cancelled (cancelada/devuelta)
function stageOf(sale, shipStatus) {
  if ((sale.order_state || (sale.cancelled ? 'cancelled' : 'ok')) !== 'ok') return 'cancelled';
  if (!sale.shipment_id) return 'delivered'; // sin envío de ML (retiro / acordar con el vendedor)
  const st = shipStatus || '';
  if (['pending', 'handling', 'ready_to_ship'].includes(st)) return 'to_ship';
  if (['shipped', 'not_delivered', 'cancelled'].includes(st)) return 'in_transit';
  if (st === 'delivered') return 'delivered';
  return (sale.tags || []).includes('delivered') ? 'delivered' : 'to_ship';
}

// Revisa en ML el estado de las ventas que todavía no están entregadas (las entregadas ya no cambian).
async function refreshStatuses(list) {
  const pending = list.filter(s => s.first_of_shipment && s.shipment_id && !EXCLUDED.includes(s.order_state)
    && !(s.ship_status === 'delivered' && s.order_state === 'ok')
    && !['cancelled', 'returned', 'ml_cancelled'].includes(s.order_state)).slice(0, 300);
  let updated = 0, next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const s = pending[next++];
      const acc = store.getAccount(s.account_id);
      if (!acc) continue;
      try {
        const sh = await get(acc, `/shipments/${s.shipment_id}`);
        if (!sh.ok) continue;
        const st = pick(sh.data.status);
        const changes = {};
        if (st && st !== s.ship_status) changes.ship_status = st;
        if (['cancelled', 'not_delivered'].includes(st) || st === 'delivered') {
          const o = await get(acc, `/orders/${s.order_id}`);
          if (o.ok) {
            const newState = orderState(o.data, st);
            changes.tags = o.data.tags || [];
            changes.status = o.data.status;
            if (newState !== s.order_state) { changes.order_state = newState; changes.cancelled = newState !== 'ok'; changes.cancel_reason = cancelReason(o.data); }
          }
        }
        if (Object.keys(changes).length) { store.updateSale(s.order_id, changes); updated++; }
      } catch { /* se reintenta la próxima vez */ }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { checked: pending.length, updated };
}

function enrich(sale) {
  const out = { ...sale };
  // Estado de la venta (ventas viejas sin este dato: cancelada). Una corrección manual manda.
  out.order_state_auto = sale.order_state || (out.cancelled ? 'cancelled' : 'ok');
  const ov = (store.getSettings().state_override || {})[sale.order_id];
  out.order_state = ov || out.order_state_auto;
  out.state_manual = !!ov;
  out.cancelled = out.order_state !== 'ok';
  const pct = store.getSettings().tax_pct ?? DEFAULT_TAX_PCT;
  out.tax_pct = pct;
  out.tax = out.cancelled ? 0 : round2(sale.gross * pct / 100);

  // Envío: en ventas Flex solo se descuenta TU costo de reparto (según zona), nunca el cargo de envío de ML.
  out.flex_cost = 0;
  if (sale.is_flex && sale.first_of_shipment && !out.cancelled) {
    const z = zones.zoneFor({ city: sale.city, state: sale.state }, store.getSettings());
    out.zone = z.zone; out.flex_cost = z.cost || 0;
  }
  out.ship_ml_deducted = sale.is_flex || out.cancelled ? 0 : sale.ship_cost;

  // Neto = precio − comisión − impuestos − envío (Flex: tu reparto · otros: el de ML). Mercado Pago queda solo como referencia.
  out.net = out.cancelled ? 0 : round2(sale.gross - sale.fee - out.tax - out.ship_ml_deducted - out.flex_cost);


  // SKU: el de Mercado Libre; si la publicación no tiene, el cargado a mano (por publicación o por título).
  const st = store.getSettings();
  const byItem = st.sku_by_item || {}, byTitle = st.sku_by_title || {};
  out.items = (sale.items || []).map(i => {
    if (i.sku) return i;
    const manual = (i.item_id && byItem[i.item_id]) || byTitle[titleKey(i.title)];
    return manual ? { ...i, sku: manual, sku_manual: true } : i;
  });

  // Costo de mercadería por SKU (planilla de costos o cargado a mano).
  out.skus = [...new Set(out.items.map(i => i.sku).filter(Boolean))];
  out.no_sku = out.items.some(i => !i.sku);
  out.no_sku_items = out.items.filter(i => !i.sku).map(i => ({ item_id: i.item_id || '', title: i.title }));
  out.cost_missing = [];
  let cost = 0;
  // TUYO (productos de Amazon): el costo es el cargado por publicación en dólares + peso.
  out.tuyo = require('./tuyo').isTuyo(sale.account_id);
  for (const i of out.items) {
    const c = out.tuyo ? require('./tuyo').costFor(i) : i.sku ? costs.costFor(i.sku) : null;
    if (c === null) out.cost_missing.push(out.tuyo ? (i.item_id || i.sku || '') : (i.sku || ''));
    else cost += c * (i.qty || 1);
  }
  out.cost = out.cost_missing.length ? null : round2(cost);
  out.net_after_cost = out.cancelled ? 0 : (out.cost === null ? null : round2(out.net - out.cost));
  out.margin_pct = out.net_after_cost !== null && sale.gross ? Math.round(out.net_after_cost / sale.gross * 1000) / 10 : null;
  return out;
}

// Datos crudos de ML de una venta (para revisar casos raros).
async function rawInfo(sale) {
  const acc = store.getAccount(sale.account_id);
  if (!acc) throw new Error('La cuenta de esta venta no está conectada.');
  const o = await get(acc, `/orders/${sale.order_id}`);
  if (!o.ok) throw new Error(`Mercado Libre respondió ${o.status}.`);
  const d = o.data;
  let ship = null;
  const sid = pick(d.shipping?.id);
  if (sid) { const sh = await get(acc, `/shipments/${sid}`); if (sh.ok) ship = { id: sid, status: sh.data.status, substatus: sh.data.substatus, logistic_type: pick(sh.data.logistic_type, sh.data.logistic?.type) }; }
  return {
    venta: d.id, carrito: d.pack_id, estado: d.status, detalle_estado: d.status_detail, etiquetas: d.tags, cancelacion: d.cancel_detail || null,
    pagos: (d.payments || []).map(p => ({ id: p.id, estado: p.status, detalle: p.status_detail, monto: p.total_paid_amount ?? p.transaction_amount })),
    reclamos: d.mediations || [], envio: ship, total: d.total_amount, fecha: d.date_created,
    como_la_clasifica_el_programa: orderState(d, ship?.status),
  };
}

module.exports = { searchOrders, buildSale, enrich, DEFAULT_TAX_PCT, titleKey, stageOf, refreshStatuses, rawInfo, EXCLUDED };
