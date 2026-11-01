// Embudo de conversión: visitas, ventas y conversión de cada publicación (últimos 30 días vs. los 30 anteriores)
// y un diagnóstico de por qué no vende: "visitas sin ventas" (problema de la publicación) o "pocas visitas" (exposición).
const store = require('./store');
const ml = require('./ml');
const { get } = ml;

const F = () => store.getFunnel();
const now = () => new Date().toISOString();
const ymd = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });

async function retry(fn) {
  let r = null;
  for (let i = 0; i < 3; i++) {
    r = await fn().catch(e => ({ ok: false, status: 0, data: { message: e.message } }));
    if (r.ok || (r.status && r.status !== 429 && r.status < 500)) return r;
    await new Promise(ok => setTimeout(ok, 800 * 2 ** i));
  }
  return r;
}
async function pool(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; await fn(list[k]); } }));
}

// Visitas de varias publicaciones en un rango (de a 50). Si ML no acepta el pedido en grupo, se pide de a una.
async function visits(acc, ids, from, to) {
  const out = {};
  const chunks = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
  let single = false;
  await pool(chunks, 2, async (ch) => {
    if (!single) {
      const r = await retry(() => get(acc, `/items/visits?ids=${ch.join(',')}&date_from=${from}&date_to=${to}`));
      if (r && r.ok) { for (const x of [].concat(r.data || [])) if (x && x.item_id) out[x.item_id] = Number(x.total_visits) || 0; return; }
      single = true;
    }
    await pool(ch, 4, async (id) => {
      const r = await retry(() => get(acc, `/items/${id}/visits?date_from=${from}&date_to=${to}`));
      if (r && r.ok) out[id] = Number((r.data && (r.data.total_visits ?? r.data[id])) || 0);
    });
  });
  return out;
}

let job = { running: false };
function status() { return { ...job }; }
function refresh() {
  if (job.running) return false;
  job = { running: true, started_at: now(), done: 0, total: store.getAccounts().length, errors: [] };
  require('./bg').bg((async () => {
    const items = Object.values(store.getListings().items || {});
    const d1 = ymd(Date.now() - 86400e3), d30 = ymd(Date.now() - 30 * 86400e3), d31 = ymd(Date.now() - 31 * 86400e3), d60 = ymd(Date.now() - 60 * 86400e3);
    const rows = {};
    await pool(store.getAccounts(), 2, async (acc) => {
      try {
        if (acc.needs_reconnect) throw new Error('hay que volver a conectar la cuenta');
        const ids = items.filter(i => i.account_id === String(acc.user_id)).map(i => i.id);
        if (ids.length) {
          const [cur, prev] = [await visits(acc, ids, d30, d1), await visits(acc, ids, d60, d31)];
          for (const id of ids) if (cur[id] !== undefined || prev[id] !== undefined) rows[id] = [cur[id] ?? null, prev[id] ?? null];
        }
      } catch (e) { job.errors.push(`${acc.nickname || acc.user_id}: ${e.message}`); }
      job.done++;
    });
    F().rows = rows; F().at = now(); F().range = { from: d30, to: d1 }; F().errors = job.errors;
    if (!Object.keys(rows).length && items.length) F().errors = [...job.errors, 'Mercado Libre no devolvió visitas.'];
    store.saveFunnel();
    job.running = false; job.finished_at = now();
  })().catch(e => { job.running = false; job.errors.push(e.message); }));
  return true;
}

// Ventas por publicación (cantidad de ventas y unidades) en un rango de días.
function salesBy(fromDays, toDays) {
  const from = ymd(Date.now() - fromDays * 86400e3), to = ymd(Date.now() - toDays * 86400e3);
  const out = {};
  for (const s of store.getSales(from, to)) {
    if (s.cancelled) continue;
    for (const i of s.items || []) if (i.item_id) { const o = out[i.item_id] = out[i.item_id] || { n: 0, u: 0, gross: 0 }; o.n++; o.u += i.qty || 1; o.gross += (s.items.length === 1 ? s.gross : 0); }
  }
  return out;
}
const median = (a) => { const s = a.filter(x => x != null && isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

function list(account) {
  const L = store.getListings(), all = Object.values(L.items || {}).filter(i => !account || i.account_id === account);
  const rows = F().rows || {};
  const s30 = salesBy(30, 1), sPrev = salesBy(60, 31);
  // Precios de la competencia (si se sigue el producto)
  const comp = {};
  try { for (const g of require('./competition').list(30).items) for (const it of g.mine) comp[it.id] = { median: g.median, min: g.min, n: g.competitors.length, full: g.competitors.some(c => c.full) }; } catch { /* sin competencia */ }
  const base = all.map(it => {
    const [v, vp] = rows[it.id] || [null, null];
    const sa = s30[it.id] || { n: 0, u: 0 }, sp = sPrev[it.id] || { n: 0, u: 0 };
    return { it, v, vp, sales: sa.n, units: sa.u, sales_prev: sp.n, conv: v ? sa.n / v : null, conv_prev: vp ? sp.n / vp : null };
  });
  const medConv = median(base.filter(b => b.v >= 50 && b.sales > 0).map(b => b.conv)) || 0.02;
  const medVis = median(base.filter(b => b.sales > 0).map(b => b.v)) || 100;
  const out = base.map(b => {
    const it = b.it, c = comp[it.id], reasons = [];
    let kind = 'ok';
    const q = it.health != null ? it.health : null;
    if (it.status === 'active' && it.stock <= 0 && it.logistic !== 'fulfillment') kind = 'nostock';
    else if (b.v == null) kind = 'nodata';
    else if (b.v >= Math.max(60, medVis * 0.5) && (b.conv || 0) < medConv * 0.5) {
      kind = 'leak';
      if (c && c.median && it.price > c.median * 1.1) reasons.push(`precio ${Math.round((it.price / c.median - 1) * 100)}% arriba de la competencia`);
      if (q != null && q < 0.7) reasons.push(`calidad ${Math.round(q * 100)}% (completá ficha y fotos)`);
      if (it.pictures && it.pictures < 5) reasons.push(`solo ${it.pictures} fotos`);
      if (it.logistic !== 'fulfillment' && c && c.full) reasons.push('la competencia tiene Full');
      if (it.price >= 60000 && it.listing_type !== 'gold_pro') reasons.push('sin cuotas sin interés (probá Premium)');
      if (it.stock > 0 && it.stock <= 2) reasons.push('stock muy bajo');
      if (it.manufacturing) reasons.push(`entrega a plazo (${it.manufacturing})`);
      if (!reasons.length) reasons.push('revisá precio, fotos y descripción frente a la competencia');
    } else if ((b.conv || 0) >= medConv * 1.5 && b.v >= 30) {
      kind = 'star';
      reasons.push(b.v < medVis * 0.5 ? 'convierte muy bien pero tiene pocas visitas: es la mejor candidata para publicidad' : 'convierte muy bien: más visitas = más ventas (publicidad, Full, asegurar stock)');
    } else if (b.v < medVis * 0.3) {
      kind = 'lowvis';
      if (String(it.title || '').length < 45) reasons.push('título corto: sumá marca, modelo, contenido y variante');
      if (q != null && q < 0.7) reasons.push(`calidad ${Math.round(q * 100)}%`);
      if (it.logistic !== 'fulfillment' && it.logistic !== 'self_service') reasons.push('sin Full ni Flex (ML prioriza la entrega rápida)');
      if (!it.catalog && c && c.n) reasons.push('existe en catálogo: publicá también en catálogo');
      reasons.push('probá publicidad (Product Ads) unos días');
    }
    const dropV = b.vp >= 50 && b.v != null ? Math.round((b.v / b.vp - 1) * 100) : null;
    const dropS = b.sales_prev >= 3 ? Math.round((b.sales / b.sales_prev - 1) * 100) : null;
    const drop = (dropV != null && dropV <= -30) || (dropS != null && dropS <= -30);
    return {
      id: it.id, account_id: it.account_id, account: it.account, title: it.title, thumb: it.thumb, link: it.link, sku: it.sku, price: it.price, stock: it.stock, status: it.status, logistic: it.logistic,
      visits: b.v, visits_prev: b.vp, sales: b.sales, units: b.units, sales_prev: b.sales_prev,
      conv: b.conv != null ? Math.round(b.conv * 1000) / 10 : null, conv_prev: b.conv_prev != null ? Math.round(b.conv_prev * 1000) / 10 : null,
      visits_change: dropV, sales_change: dropS, drop, kind, reasons,
    };
  });
  const sum = (k) => out.reduce((n, r) => n + (r[k] || 0), 0);
  const tot = { visits: sum('visits'), visits_prev: sum('visits_prev'), sales: sum('sales'), sales_prev: sum('sales_prev') };
  tot.conv = tot.visits ? Math.round(tot.sales / tot.visits * 1000) / 10 : null;
  tot.conv_prev = tot.visits_prev ? Math.round(tot.sales_prev / tot.visits_prev * 1000) / 10 : null;
  return {
    items: out, totals: tot, median_conv: Math.round(medConv * 1000) / 10, median_visits: medVis,
    counts: { leak: out.filter(r => r.kind === 'leak').length, lowvis: out.filter(r => r.kind === 'lowvis').length, star: out.filter(r => r.kind === 'star').length, nostock: out.filter(r => r.kind === 'nostock').length, drop: out.filter(r => r.drop).length },
    at: F().at || null, range: F().range || null, errors: F().errors || [], job: status(), listings_at: L.updated_at || null,
  };
}

module.exports = { refresh, status, list };
