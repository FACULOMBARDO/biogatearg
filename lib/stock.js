// Stock propio (depósito/local). Arranca con la columna STOCK de la lista de precios y
// baja solo con las ventas de Mercado Libre (menos Full) y de la web, más los movimientos a mano.
const crypto = require('crypto');
const store = require('./store');
const costs = require('./costs');

const key = (s) => String(s ?? '').trim().toUpperCase();
const newId = () => crypto.randomBytes(5).toString('hex');
const BAD_ML = ['cancelled', 'returned', 'unpaid', 'ml_cancelled'];

function ensure(sku, name) {
  const st = store.getStock();
  const k = key(sku);
  if (!st.items[k]) st.items[k] = { sku: k, name: name || '', qty: 0, min: null };
  if (name && !st.items[k].name) st.items[k].name = name;
  return st.items[k];
}
function move(sku, qty, type, opts = {}) {
  const st = store.getStock();
  const it = ensure(sku, opts.name);
  it.qty = Math.round((it.qty + qty) * 1000) / 1000;
  it.updated_at = new Date().toISOString();
  const m = { id: newId(), sku: it.sku, qty, type, date: opts.date || new Date().toISOString(), ref: opts.ref || '', note: opts.note || '', after: it.qty, user: opts.user || '' };
  st.moves.push(m);
  if (st.moves.length > 50000) st.moves.splice(0, st.moves.length - 50000);
  return m;
}

// Carga (o recarga) el stock desde la columna STOCK de la lista de precios.
function initFromPriceList() {
  const items = (store.getCosts().items || []).filter(i => i.sku);
  if (!items.length) throw new Error('La lista de precios no tiene productos cargados. Tocá "Actualizar costos" en Ventas.');
  const st = store.getStock();
  const now = new Date().toISOString();
  let n = 0;
  for (const i of items) {
    const it = ensure(i.sku, i.name);
    const target = Number.isFinite(i.stock) && i.stock !== null ? i.stock : 0;
    const delta = target - it.qty;
    if (delta || !st.since) move(i.sku, delta, 'inicial', { note: 'Stock de la lista de precios', name: i.name });
    n++;
  }
  // Solo se descuentan las ventas posteriores a este momento.
  st.since = now; st.applied = {};
  store.saveStock();
  return { count: n, since: now };
}

// Descuenta (o devuelve) las ventas de ML y de la web posteriores a "since". Cada venta se aplica una sola vez.
function applySales() {
  const st = store.getStock();
  if (!st.since) return { applied: 0 };
  const since = new Date(st.since);
  const sales = require('./sales');
  let changed = 0;
  // Mercado Libre (Full sale del depósito de ML: no toca tu stock)
  for (const raw of store.getSales(st.since.slice(0, 10), null)) {
    if (new Date(raw.date) < since || raw.logistic === 'fulfillment') continue;
    const s = sales.enrich(raw);
    const k = 'ml:' + s.order_id;
    const bad = BAD_ML.includes(s.order_state);
    if (!st.applied[k] && !bad) {
      for (const i of s.items || []) if (i.sku) move(i.sku, -(i.qty || 1), 'venta_ml', { ref: `ML ${s.order_id}`, note: `${s.account_nickname || ''} · ${i.title}`.trim(), date: s.date, name: i.title });
      st.applied[k] = 'out'; changed++;
    } else if (st.applied[k] === 'out' && bad) {
      for (const i of s.items || []) if (i.sku) move(i.sku, i.qty || 1, 'devolucion', { ref: `ML ${s.order_id}`, note: s.order_state === 'returned' ? 'Venta devuelta' : 'Venta cancelada', name: i.title });
      st.applied[k] = 'back'; changed++;
    }
  }
  // Web (WooCommerce): solo pedidos pagos. Si un pedido deja de estar pago (cancelado, reembolsado,
  // vuelve a "en espera") las unidades vuelven; si se paga después, se descuenta.
  const { isCounted } = require('./woo');
  for (const o of Object.values(store.getWoo().orders || {})) {
    if (new Date(o.date) < since) continue;
    const k = 'web:' + o.id, paid = isCounted(o);
    if (paid && st.applied[k] !== 'out') {
      for (const i of o.items) if (i.sku) move(i.sku, -i.qty, 'venta_web', { ref: `Web #${o.number}`, note: `${o.customer} · ${i.name}`, date: o.date, name: i.name });
      st.applied[k] = 'out'; changed++;
    } else if (!paid && st.applied[k] === 'out') {
      for (const i of o.items) if (i.sku) move(i.sku, i.qty, 'devolucion', { ref: `Web #${o.number}`, note: `Pedido ${o.status_es || o.status}`, name: i.name });
      st.applied[k] = 'back'; changed++;
    }
  }
  if (changed) store.saveStock();
  return { applied: changed };
}

// Vista del stock con valor al costo, ventas de 30 días y días que alcanza.
function list() {
  const st = store.getStock();
  const from = Date.now() - 30 * 86400e3;
  const out30 = {};
  for (const m of st.moves) if (['venta_ml', 'venta_web', 'venta_local'].includes(m.type) && new Date(m.date) >= from) out30[m.sku] = (out30[m.sku] || 0) - m.qty;
  const back30 = {};
  for (const m of st.moves) if (m.type === 'devolucion' && new Date(m.date) >= from) back30[m.sku] = (back30[m.sku] || 0) + m.qty;
  const names = {};
  for (const i of store.getCosts().items || []) if (i.sku && i.name) names[key(i.sku)] = i.name;
  const defMin = Number(store.getSettings().stock_min_default) || 3;
  const items = Object.values(st.items).map(i => {
    const sold = Math.max(0, (out30[i.sku] || 0) - (back30[i.sku] || 0));
    const perDay = sold / 30;
    const cost = costs.costFor(i.sku);
    const min = i.min ?? defMin;
    return { ...i, name: i.name || names[i.sku] || '', min, min_custom: i.min !== null && i.min !== undefined, sold_30: sold, cost, value: cost ? Math.round(cost * Math.max(0, i.qty)) : null,
      days_left: perDay > 0 ? Math.floor(Math.max(0, i.qty) / perDay) : null, state: i.qty <= 0 ? 'out' : i.qty <= min ? 'low' : 'ok' };
  });
  return { since: st.since || null, default_min: defMin, items, moves_count: st.moves.length };
}

function history(sku, limit = 200) {
  const k = key(sku);
  return store.getStock().moves.filter(m => m.sku === k).slice(-limit).reverse();
}

module.exports = { initFromPriceList, applySales, move, list, history, ensure, key };
