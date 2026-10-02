// Resultado del mes (neto neto) e historial, y sugerencias armadas con tus datos.
const store = require('./store');
const sales = require('./sales');
const woo = require('./woo');
const stock = require('./stock');
const costs = require('./costs');
const { get } = require('./ml');

const r2 = (n) => Math.round((n || 0) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const monthRange = (ym) => { const [y, m] = ym.split('-').map(Number); return [`${ym}-01`, `${ym}-${pad(new Date(y, m, 0).getDate())}`]; };
const shiftMonth = (ym, k) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const thisMonth = () => { const d = new Date(Date.now() - 3 * 3600e3); return d.toISOString().slice(0, 7); };

// ---------- Resultado del mes ----------
function monthSummary(ym) {
  const [from, to] = monthRange(ym);
  const list = store.getSales(from, to).map(sales.enrich).filter(s => !['unpaid', 'ml_cancelled'].includes(s.order_state));
  const ok = list.filter(s => !s.cancelled);
  const sum = (a, k) => r2(a.reduce((t, s) => t + (s[k] || 0), 0));
  const canc = list.filter(s => s.order_state === 'cancelled'), ret = list.filter(s => s.order_state === 'returned');
  const withCost = ok.filter(s => s.net_after_cost !== null), noCost = ok.filter(s => s.net_after_cost === null);
  const ml = {
    sales: ok.length, units: ok.reduce((t, s) => t + (s.qty || 0), 0),
    gross_all: r2(sum(ok, 'gross') + sum(canc, 'gross') + sum(ret, 'gross')),
    cancelled: sum(canc, 'gross'), returned: sum(ret, 'gross'), cancelled_n: canc.length, returned_n: ret.length,
    gross: sum(ok, 'gross'), fee: sum(ok, 'fee'), ship: r2(sum(ok, 'ship_ml_deducted') + sum(ok, 'flex_cost')), tax: sum(ok, 'tax'),
    cost: sum(withCost, 'cost'), no_cost_n: noCost.length, no_cost_gross: sum(noCost, 'gross'),
  };
  ml.profit = r2(ml.gross - ml.fee - ml.ship - ml.tax - ml.cost);
  const orders = woo.ordersBetween(from, to).filter(o => o.counted);
  const webUnits = orders.reduce((t, o) => t + o.items.reduce((x, i) => x + i.qty, 0), 0);
  const wNoCost = orders.filter(o => o.net_after_cost === null);
  const wb = {
    orders: orders.length, units: webUnits, gross: sum(orders, 'gross'), tax: sum(orders, 'tax'), fee: sum(orders, 'fee'),
    cost: r2(orders.filter(o => o.net_after_cost !== null).reduce((t, o) => t + o.cost, 0)), no_cost_n: wNoCost.length,
  };
  wb.profit = r2(wb.gross - wb.tax - wb.fee - wb.cost);
  const exp = store.getExpenses().filter(e => e.date.startsWith(ym));
  const expenses = r2(exp.reduce((t, e) => t + e.amount, 0));
  return { month: ym, partial: ym === thisMonth(), ml, web: wb, expenses, expenses_n: exp.length, profit: r2(ml.profit + wb.profit), net_net: r2(ml.profit + wb.profit - expenses) };
}
function results(ym, months = 12) {
  const cur = /^\d{4}-\d{2}$/.test(ym || '') ? ym : thisMonth();
  const hist = [];
  for (let i = months - 1; i >= 0; i--) hist.push(monthSummary(shiftMonth(cur, -i)));
  return { month: cur, current: hist[hist.length - 1], prev: hist[hist.length - 2] || monthSummary(shiftMonth(cur, -1)), last_year: monthSummary(shiftMonth(cur, -12)), history: hist, has_woo_key: !!(store.getSettings().wc_key) };
}

// ---------- Calidad de publicaciones (si Mercado Libre lo informa) ----------
const GOALS = {
  picture: 'Mejorar las fotos', pictures: 'Mejorar las fotos', technical_specification: 'Completar la ficha técnica', attributes: 'Completar la ficha técnica',
  product_identifiers: 'Cargar el código universal (EAN)', gtin: 'Cargar el código universal (EAN)', variations: 'Agregar variantes',
  free_shipping: 'Ofrecer envío gratis', fulfillment: 'Mandar a Full', flex: 'Activar Flex', buybox: 'Ganar en el catálogo', catalog: 'Publicar en catálogo',
  size_chart: 'Agregar tabla de talles', video: 'Agregar un clip', clips: 'Agregar un clip', description: 'Mejorar la descripción', title: 'Mejorar el título',
  installments: 'Ofrecer cuotas', warranty: 'Informar la garantía', listing_type: 'Mejorar el tipo de publicación',
};
let qJob = { running: false };
function qualityStatus() { return { ...qJob }; }
function refreshQuality() {
  if (qJob.running) return false;
  qJob = { running: true, done: 0, total: 0, started_at: new Date().toISOString() };
  require('./bg').bg((async () => {
    const from = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
    const units = {};
    for (const s of store.getSales(from, null)) if (!s.cancelled) for (const i of s.items || []) if (i.item_id) {
      const k = s.account_id + '|' + i.item_id; units[k] = units[k] || { acc: s.account_id, id: i.item_id, title: i.title, units: 0 }; units[k].units += i.qty || 1;
    }
    const top = Object.values(units).sort((a, b) => b.units - a.units).slice(0, 60);
    qJob.total = top.length;
    const out = {}; let okN = 0, lastErr = '';
    for (const t of top) {
      const acc = store.getAccount(t.acc);
      if (acc) {
        const r = await get(acc, `/items/${t.id}/health`).catch(e => ({ ok: false, status: 0, data: { message: e.message } }));
        if (r.ok && r.data) {
          okN++;
          const goals = (r.data.goals || []).filter(g => g.apply !== false && Number(g.progress ?? 0) < Number(g.progress_max ?? 1))
            .map(g => ({ id: g.id, label: GOALS[g.id] || String(g.id).replace(/_/g, ' ') }));
          out[t.id] = { id: t.id, title: t.title, units: t.units, health: Number(r.data.health), level: r.data.level || '', goals };
        } else lastErr = `${r.status} ${r.data?.message || ''}`.trim();
      }
      qJob.done++;
    }
    store.saveQuality({ items: out, updated_at: new Date().toISOString(), error: okN ? '' : (top.length ? `Mercado Libre no informó la calidad de las publicaciones (${lastErr}).` : 'No hay ventas de los últimos 30 días para analizar.') });
    qJob.running = false; qJob.finished_at = new Date().toISOString();
  })());
  return true;
}

// ---------- Sugerencias ----------
function suggestions() {
  const out = [];
  const add = (sev, type, title, detail, link, linkLabel) => out.push({ sev, type, title, detail, link: link || '', link_label: linkLabel || '' });
  const now = Date.now();
  const d30 = new Date(now - 30 * 86400e3).toISOString().slice(0, 10), d60 = new Date(now - 60 * 86400e3).toISOString().slice(0, 10);
  const s60 = store.getSales(d60, null).map(sales.enrich).filter(s => !['unpaid', 'ml_cancelled'].includes(s.order_state));
  const s30 = s60.filter(s => s.date.slice(0, 10) >= d30);
  const money = (n) => '$ ' + Math.round(n).toLocaleString('es-AR');

  // 1) Margen por SKU (últimos 30 días)
  const bySku = {};
  for (const s of s30) {
    if (s.cancelled) continue;
    for (const i of s.items || []) {
      if (!i.sku) continue;
      const g = bySku[i.sku] = bySku[i.sku] || { sku: i.sku, title: i.title, item: i.item_id, units: 0, gross: 0, nac: 0, withCost: 0, fee: 0, tax: 0, ship: 0, n: 0 };
      if ((s.items || []).length > 1) continue; // en carritos no se puede separar bien
      g.units += i.qty || 1; g.n++; g.gross += s.gross; g.fee += s.fee; g.tax += s.tax; g.ship += (s.ship_ml_deducted || 0) + (s.flex_cost || 0);
      if (s.net_after_cost !== null) { g.nac += s.net_after_cost; g.withCost += s.gross; }
    }
  }
  for (const g of Object.values(bySku)) {
    if (!g.withCost || g.n < 1) continue;
    const margin = g.nac / g.withCost;
    const unitCost = costs.costFor(g.sku) || 0;
    const feeP = g.gross ? g.fee / g.gross : 0.14, taxP = g.gross ? g.tax / g.gross : 0.23, shipU = g.units ? g.ship / g.units : 0;
    const minPrice = unitCost ? Math.ceil((unitCost + shipU) / Math.max(0.2, 1 - feeP - taxP - 0.15) / 100) * 100 : null;
    const avgPrice = g.units ? g.gross / g.units : 0;
    if (g.nac < 0) add('alta', 'Precios', `${g.sku} pierde plata`, `En 30 días vendiste ${g.units} u. y perdiste ${money(-g.nac)} (margen ${Math.round(margin * 100)}%). Precio promedio ${money(avgPrice)}${minPrice ? `; para ganar ~15% debería estar en ${money(minPrice)}` : ''}.`, g.item ? `https://articulo.mercadolibre.com.ar/${g.item.replace(/^([A-Z]+)(\d+)$/, '$1-$2')}` : '', 'Ver publicación');
    else if (margin < 0.08) add('media', 'Precios', `${g.sku} deja muy poco margen`, `Margen de ${Math.round(margin * 100)}% en ${g.units} u. vendidas (precio promedio ${money(avgPrice)})${minPrice ? `. Para ~15% de margen: ${money(minPrice)}` : ''}.`, g.item ? `https://articulo.mercadolibre.com.ar/${g.item.replace(/^([A-Z]+)(\d+)$/, '$1-$2')}` : '', 'Ver publicación');
  }

  // 2) Full: por agotarse, no aptas, parado, pausadas con stock
  const fullInv = store.getFull().inventories || [];
  const soldFull = {};
  for (const s of s30) if (s.logistic === 'fulfillment' && !s.cancelled) for (const i of s.items || []) soldFull[i.item_id + '|' + (i.variation_id || '')] = (soldFull[i.item_id + '|' + (i.variation_id || '')] || 0) + (i.qty || 1);
  const fullSkus = new Set();
  for (const g of fullInv) {
    if (g.sku) fullSkus.add(String(g.sku).toUpperCase());
    if (g.error) continue;
    let units = 0; for (const it of g.items || []) units += (soldFull[it.id + '|' + (it.variation_id || '')] || 0) + (it.variation_id ? 0 : 0);
    if (!units) for (const it of g.items || []) units += soldFull[it.id + '|'] || 0;
    const name = `${g.title}${g.variation ? ' · ' + g.variation : ''}`;
    const days = units ? Math.floor(g.available / (units / 30)) : null;
    if (units && g.available === 0) add('alta', 'Full', `Sin stock en Full: ${name}`, `Vendiste ${units} u. en 30 días y no te queda nada en el depósito. Mandá al menos ${units} u. para cubrir un mes.`, '#full', 'Ver Full');
    else if (days !== null && days < 15) add('alta', 'Full', `Se agota en Full: ${name}`, `Quedan ${g.available} u. (≈${days} días al ritmo actual). Para cubrir 30 días mandá ${Math.max(1, units - g.available)} u.`, '#full', 'Ver Full');
    if (g.not_available > 0) add('media', 'Full', `Unidades no aptas en Full: ${name}`, `${g.not_available} u. no se pueden vender${(g.not_available_detail || []).length ? ' (' + g.not_available_detail.map(n => `${n.label}: ${n.quantity}`).join(', ') + ')' : ''}. Pedí el retiro o revisalas para no pagar almacenamiento.`, '#full', 'Ver Full');
    if (!units && g.available >= 5) add('baja', 'Full', `Stock parado en Full: ${name}`, `${g.available} u. sin ventas en 30 días. Probá bajar el precio, una promoción o retirar parte para no pagar almacenamiento.`, '#full', 'Ver Full');
    if (g.paused && g.available > 0) add('alta', 'Publicaciones', `Pausada con stock: ${name}`, `Tiene ${g.available} u. en Full pero la publicación está pausada. Reactivala para vender.`, (g.items || [])[0]?.permalink || '#full', 'Ver publicación');
  }

  // 3) Stock propio
  const own = stock.list();
  if (own.since) for (const i of own.items) {
    if (i.sold_30 > 0 && i.qty <= 0) add('alta', 'Stock', `Sin stock en el local: ${i.sku}`, `${i.name || ''} — vendiste ${i.sold_30} u. en 30 días. Reponé al menos ${i.sold_30} u.`, '#stock', 'Ver stock');
    else if (i.days_left !== null && i.days_left < 10) add('media', 'Stock', `Poco stock: ${i.sku}`, `${i.name || ''} — quedan ${i.qty} u. (≈${i.days_left} días). Para 30 días te faltan ${Math.max(1, i.sold_30 - i.qty)} u.`, '#stock', 'Ver stock');
  }

  // 4) Sin SKU / sin costo
  const noSku = new Map(), noCost = new Map();
  for (const s of s30) { if (s.cancelled) continue; for (const x of s.no_sku_items || []) noSku.set(x.item_id || x.title, x); for (const k of s.cost_missing || []) if (k) noCost.set(k, (noCost.get(k) || 0) + 1); }
  if (noSku.size) add('media', 'Datos', `${noSku.size} publicaciones vendidas sin SKU`, `Sin SKU no se puede calcular el costo ni descontar stock: ${[...noSku.values()].slice(0, 5).map(x => x.title).join(' · ')}${noSku.size > 5 ? '…' : ''}. Cargalo en Mercado Libre o a mano en Ventas.`, '#ventas', 'Ir a Ventas');
  if (noCost.size) add('media', 'Datos', `${noCost.size} SKU sin costo cargado`, `${[...noCost.keys()].slice(0, 10).join(', ')}${noCost.size > 10 ? '…' : ''}. Agregalos en la lista de precios para que la ganancia sea real.`, '#ventas', 'Ir a Ventas');

  // 5) Cancelaciones y devoluciones altas (60 días)
  const cr = {};
  for (const s of s60) for (const i of s.items || []) if (i.sku) { const c = cr[i.sku] = cr[i.sku] || { n: 0, bad: 0, title: i.title }; c.n++; if (['cancelled', 'returned'].includes(s.order_state)) c.bad++; }
  for (const [sku, c] of Object.entries(cr)) if (c.n >= 4 && c.bad / c.n >= 0.15) add('media', 'Publicaciones', `Muchas cancelaciones/devoluciones: ${sku}`, `${c.bad} de ${c.n} ventas en 60 días (${Math.round(c.bad / c.n * 100)}%). Revisá fotos, descripción y medidas: puede que el producto no sea lo que el comprador esperaba.`, '#ventas', 'Ir a Ventas');

  // 6) Los más vendidos que no están en Full
  if (fullInv.length) {
    const nf = {};
    for (const s of s30) if (!s.cancelled && s.logistic !== 'fulfillment') for (const i of s.items || []) if (i.sku) { nf[i.sku] = nf[i.sku] || { units: 0, title: i.title }; nf[i.sku].units += i.qty || 1; }
    Object.entries(nf).filter(([sku]) => !fullSkus.has(sku.toUpperCase())).sort((a, b) => b[1].units - a[1].units).slice(0, 5)
      .forEach(([sku, v]) => { if (v.units >= 5) add('baja', 'Full', `Candidato a Full: ${sku}`, `${v.title} — ${v.units} u. vendidas en 30 días sin Full. En Full suele vender más por la entrega rápida.`, '#full', 'Ver Full'); });
  }

  // 7) Calidad de publicaciones
  const q = store.getQuality();
  for (const it of Object.values(q.items || {})) {
    if (!(it.health < 0.8) || !it.goals.length) continue;
    add(it.health < 0.5 ? 'media' : 'baja', 'Calidad', `Calidad ${Math.round(it.health * 100)}%: ${it.title}`, `Mercado Libre sugiere: ${it.goals.map(g => g.label).join(', ')}. (${it.units} u. vendidas en 30 días)`, `https://articulo.mercadolibre.com.ar/${it.id.replace(/^([A-Z]+)(\d+)$/, '$1-$2')}`, 'Ver publicación');
  }

  const rank = { alta: 0, media: 1, baja: 2 };
  out.sort((a, b) => rank[a.sev] - rank[b.sev]);
  return { items: out, quality: { updated_at: q.updated_at || null, error: q.error || '' }, full_updated: store.getFull().updated_at || null, stock_since: own.since };
}

module.exports = { results, monthSummary, suggestions, refreshQuality, qualityStatus, shiftMonth };
