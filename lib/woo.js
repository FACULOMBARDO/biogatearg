// Pedidos de la web (WooCommerce), con la clave de solo lectura.
const store = require('./store');
const web = require('./web');
const costs = require('./costs');

// Solo cuentan los pedidos PAGOS: "Procesando" y "Completado".
// "En espera" (transferencia sin confirmar) y "Pendiente de pago" no están pagos; cancelados, reembolsados y fallidos tampoco cuentan.
const COUNTED = ['processing', 'completed'];
const UNPAID = ['pending', 'on-hold', 'checkout-draft'];
// Estado que marcás vos en el panel (no se cambia nada en la web). Solo suma lo que marcás como "completed".
const PANEL = { pending: '⏳ Pendiente', completed: '✅ Completado', cancelled: '❌ Cancelado' };
const panelStatus = (o) => (store.getWoo().panel || {})[String(o.id)] || 'pending';
const isCounted = (o) => panelStatus(o) === 'completed';
function setPanelStatus(ids, st) {
  if (!PANEL[st]) throw new Error('Estado inválido.');
  const w = store.getWoo();
  w.panel = w.panel || {};
  let n = 0;
  for (const id of ids) { const k = String(id); if (!w.orders[k]) continue; if (st === 'pending') delete w.panel[k]; else w.panel[k] = st; n++; }
  store.upsertWoo([]);
  return n;
}
// Clave de costo: el SKU, o el nombre del producto si en la web no tiene SKU.
const costKey = (i) => i.sku || ('N:' + String(i.name || '').trim().toUpperCase().replace(/\s+/g, ' '));
const STATUS_ES = {
  pending: 'Pendiente de pago', processing: 'Procesando', 'on-hold': 'En espera', completed: 'Completado', cancelled: 'Cancelado',
  refunded: 'Reembolsado', failed: 'Fallido', 'checkout-draft': 'Borrador', trash: 'Papelera',
};

function auth() {
  const st = store.getSettings();
  if (!st.wc_key || !st.wc_secret) throw new Error('Falta la clave de WooCommerce: cargala en Estados de WhatsApp → Configurar web.');
  return `consumer_key=${encodeURIComponent(st.wc_key)}&consumer_secret=${encodeURIComponent(st.wc_secret)}`;
}
async function getJson(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'BiogatePanel/1.0', accept: 'application/json' }, redirect: 'follow', signal: AbortSignal.timeout(45000) });
  const text = await r.text();
  let data = null; try { data = JSON.parse(text); } catch { /* no es JSON */ }
  return { ok: r.ok, status: r.status, data, headers: r.headers };
}
// Provincias de WooCommerce Argentina (códigos) → nombre.
const STATE_AR = { C: 'Capital Federal', B: 'Buenos Aires', K: 'Catamarca', H: 'Chaco', U: 'Chubut', X: 'Córdoba', W: 'Corrientes', E: 'Entre Ríos', P: 'Formosa', Y: 'Jujuy', L: 'La Pampa', F: 'La Rioja', M: 'Mendoza', N: 'Misiones', Q: 'Neuquén', R: 'Río Negro', A: 'Salta', J: 'San Juan', D: 'San Luis', Z: 'Santa Cruz', S: 'Santa Fe', G: 'Santiago del Estero', V: 'Tierra del Fuego', T: 'Tucumán' };
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function mapOrder(o) {
  const b = o.billing || {}, sh = o.shipping || {};
  const refunded = (o.refunds || []).reduce((t, r) => t + Math.abs(num(r.total)), 0);
  return {
    id: String(o.id), number: String(o.number || o.id), status: o.status, status_es: STATUS_ES[o.status] || o.status,
    counted: COUNTED.includes(o.status),
    date: o.date_created_gmt ? o.date_created_gmt + 'Z' : new Date(o.date_created).toISOString(),
    paid_at: o.date_paid_gmt ? o.date_paid_gmt + 'Z' : null,
    total: num(o.total), shipping: num(o.shipping_total), discount: num(o.discount_total), refunded,
    payment: o.payment_method_title || o.payment_method || '',
    customer: web.clean(`${b.first_name || ''} ${b.last_name || ''}`) || web.clean(`${sh.first_name || ''} ${sh.last_name || ''}`),
    email: b.email || '', phone: b.phone || '', city: web.clean(sh.city || b.city || ''), state: web.clean(STATE_AR[sh.state || b.state] || sh.state || b.state || ''),
    address: web.clean([sh.address_1 || b.address_1, sh.address_2 || b.address_2].filter(Boolean).join(', ')), zip: web.clean(sh.postcode || b.postcode || ''),
    shipping_method: (o.shipping_lines || []).map(s => web.clean(s.method_title)).filter(Boolean).join(', '),
    items: (o.line_items || []).map(i => ({ name: web.clean(i.name), sku: String(i.sku || '').trim().toUpperCase(), qty: num(i.quantity) || 1, total: num(i.total) + num(i.total_tax), product_id: i.product_id })),
    modified: o.date_modified_gmt ? o.date_modified_gmt + 'Z' : null,
  };
}

let job = { running: false };
function status() { return { ...job }; }

// Trae pedidos nuevos o modificados. La primera vez, los de los últimos `months` meses.
function sync({ months = 12, full = false } = {}) {
  if (job.running) return false;
  job = { running: true, phase: 'Leyendo pedidos de la web…', done: 0, started_at: new Date().toISOString() };
  require('./bg').bg((async () => {
    try {
      const a = auth();
      const w = store.getWoo();
      const site = web.siteUrl();
      let filter;
      if (w.schema !== 2) { full = true; months = Math.max(months, 12); }   // una vez: volver a leer todo para tener las direcciones
      if (w.last_sync && !full) filter = `modified_after=${encodeURIComponent(new Date(new Date(w.last_sync) - 2 * 3600e3).toISOString().slice(0, 19))}`;
      else filter = `after=${encodeURIComponent(new Date(Date.now() - months * 31 * 86400e3).toISOString().slice(0, 19))}`;
      const started = new Date().toISOString();
      const got = [];
      for (let p = 1; p <= 200; p++) {
        const r = await getJson(`${site}/wp-json/wc/v3/orders?per_page=100&page=${p}&orderby=date&order=desc&${filter}&${a}`);
        if (!r.ok) throw new Error(`La web respondió ${r.status} al pedir los pedidos: ${r.data?.message || 'revisá la clave'}.`);
        if (!Array.isArray(r.data) || !r.data.length) break;
        got.push(...r.data.map(mapOrder));
        job.done = got.length; job.phase = `Leyendo pedidos de la web… ${got.length}`;
        const pages = Number(r.headers.get('x-wp-totalpages')) || 0;
        if (r.data.length < 100 || (pages && p >= pages)) break;
      }
      store.upsertWoo(got, started);
      w.schema = 2;
      job.phase = 'Listo'; job.saved = got.length;
    } catch (e) { job.phase = 'Error'; job.error = e.message; }
    job.running = false; job.finished_at = new Date().toISOString();
    try { require('./stock').applySales(); } catch (e) { console.log('Stock:', e.message); }
  })());
  return true;
}

// Pedidos del período con impuestos, comisión del medio de pago y costo de mercadería.
function ordersBetween(from, to) {
  const a = from ? new Date(from + 'T00:00:00-03:00') : new Date(0);
  const b = to ? new Date(to + 'T23:59:59-03:00') : new Date(8.64e15);
  const st = store.getSettings();
  const taxPct = st.tax_pct ?? 23, feePct = Number(st.web_fee_pct) || 0;
  return Object.values(store.getWoo().orders || {}).filter(o => { const d = new Date(o.date); return d >= a && d <= b; }).map(o => {
    const gross = Math.max(0, o.total - (o.refunded || 0));
    const counted = isCounted(o);
    const shp = (store.getWoo().ship || {})[String(o.id)];
    o = { ...o, counted, ship: shp && shp.on ? { ...shp, ...require('./zones').zoneFor(shp, st) } : null, panel_status: panelStatus(o), woo_paid: COUNTED.includes(o.status), unpaid: UNPAID.includes(o.status) };
    let cost = 0; const missing = [];
    for (const i of o.items) { const c = costs.costFor(costKey(i)); if (c) cost += c * i.qty; else missing.push({ key: costKey(i), label: i.sku || i.name }); }
    const tax = o.counted ? Math.round(gross * taxPct) / 100 : 0;
    const fee = o.counted ? Math.round(gross * feePct) / 100 : 0;
    const net = o.counted ? Math.round((gross - tax - fee) * 100) / 100 : 0;
    const hasCost = o.counted && !missing.length;
    return { ...o, gross, tax, fee, tax_pct: taxPct, fee_pct: feePct, cost: o.counted ? Math.round(cost * 100) / 100 : 0, cost_missing: missing, net, net_after_cost: o.counted ? (hasCost ? Math.round((net - cost) * 100) / 100 : null) : 0 };
  }).sort((x, y) => new Date(y.date) - new Date(x.date));
}

module.exports = { sync, status, ordersBetween, COUNTED, UNPAID, isCounted, costKey, setPanelStatus, PANEL };
