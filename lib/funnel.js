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

// Visitas de una cuenta: primero se piden de a 50 publicaciones por rango; si ML no lo acepta, se piden día por día
// (últimos 60 días) de cada publicación. Devuelve { id: [visitas 30 días, visitas 30 días anteriores] }.
const iso = (d, end) => encodeURIComponent(`${d}T${end ? '23:59:59.999' : '00:00:00.000'}-03:00`);
async function visitsFor(acc, ids, R, deadline, note) {
  const out = {};
  const chunks = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
  let multi = true;
  for (const ch of chunks) {
    if (Date.now() > deadline) break;
    if (multi) {
      const [a, b] = await Promise.all([
        retry(() => get(acc, `/items/visits?ids=${ch.join(',')}&date_from=${iso(R.d30)}&date_to=${iso(R.d1, true)}`)),
        retry(() => get(acc, `/items/visits?ids=${ch.join(',')}&date_from=${iso(R.d60)}&date_to=${iso(R.d31, true)}`)),
      ]);
      const la = a && a.ok ? [].concat(a.data || []) : null, lb = b && b.ok ? [].concat(b.data || []) : null;
      if (la && lb && la.some(x => x && x.item_id)) {
        const pv = Object.fromEntries(lb.filter(x => x && x.item_id).map(x => [x.item_id, Number(x.total_visits) || 0]));
        for (const x of la) if (x && x.item_id) out[x.item_id] = [Number(x.total_visits) || 0, pv[x.item_id] ?? null];
        continue;
      }
      multi = false; note.push(`visitas en grupo no disponibles (${(a && a.status) || '?'}), se piden de a una`);
    }
    await pool(ch, 5, async (id) => {
      if (Date.now() > deadline) return;
      const r = await retry(() => get(acc, `/items/${id}/visits/time_window?last=60&unit=day`));
      if (!r || !r.ok) return;
      let cur = 0, prev = 0;
      for (const x of r.data.results || []) {
        const d = String(x.date || '').slice(0, 10);
        if (d >= R.d30 && d <= R.d1) cur += Number(x.total) || 0;
        else if (d >= R.d60 && d <= R.d31) prev += Number(x.total) || 0;
      }
      out[id] = [cur, prev];
    });
  }
  return out;
}

let job = { running: false };
function status() { return { ...job }; }
// Trae las visitas. Si no termina a tiempo, guarda lo que tiene y la próxima vez sigue con las que faltan.
function refresh() {
  if (job.running) return false;
  const items = Object.values(store.getListings().items || {}).sort((a, b) => (b.status === 'active') - (a.status === 'active') || (b.sold || 0) - (a.sold || 0));
  job = { running: true, started_at: now(), done: 0, total: items.length, errors: [] };
  require('./bg').bg((async () => {
    const deadline = Date.now() + 220e3, day = ymd(Date.now());
    const R = { d1: ymd(Date.now() - 86400e3), d30: ymd(Date.now() - 30 * 86400e3), d31: ymd(Date.now() - 31 * 86400e3), d60: ymd(Date.now() - 60 * 86400e3) };
    const old = F().rows || {}, rows = {}, note = [];
    // Las que ya se trajeron hoy no se vuelven a pedir
    for (const it of items) if (old[it.id] && old[it.id][2] === day) rows[it.id] = old[it.id];
    job.done = Object.keys(rows).length;
    await pool(store.getAccounts(), 2, async (acc) => {
      try {
        if (acc.needs_reconnect) throw new Error('hay que volver a conectar la cuenta');
        const ids = items.filter(i => i.account_id === String(acc.user_id) && !rows[i.id]).map(i => i.id);
        if (!ids.length) return;
        const got = await visitsFor(acc, ids, R, deadline, note);
        for (const [id, v] of Object.entries(got)) { rows[id] = [v[0], v[1], day]; job.done++; }
      } catch (e) { job.errors.push(`${acc.nickname || acc.user_id}: ${e.message}`); }
    });
    // Las que no se llegaron a traer hoy quedan con el dato anterior
    for (const it of items) if (!rows[it.id] && old[it.id]) rows[it.id] = old[it.id];
    const missing = items.filter(i => !rows[i.id] || rows[i.id][2] !== day).length;
    F().rows = rows; F().at = now(); F().range = { from: R.d30, to: R.d1 }; F().missing = missing;
    F().errors = [...job.errors, ...[...new Set(note)].slice(0, 1)];
    if (!Object.keys(rows).length && items.length) F().errors.push('Mercado Libre no devolvió visitas.');
    store.saveFunnel();
    job.running = false; job.finished_at = now();
    if (missing && Date.now() > deadline) setTimeout(() => {}, 0); // la próxima actualización sigue con las que faltan
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
    // Consejos generales para cualquier publicación que no tenga un diagnóstico puntual
    if (!reasons.length && (kind === 'nodata' || kind === 'ok')) {
      if (q != null && q < 0.8) reasons.push(`calidad ${Math.round(q * 100)}%: completá ficha y fotos`);
      if (it.pictures && it.pictures < 6) reasons.push(`${it.pictures} fotos (sumá hasta 8)`);
      if (String(it.title || '').length < 45) reasons.push('título corto');
      if (it.price >= 60000 && it.listing_type !== 'gold_pro') reasons.push('probá Premium (cuotas)');
      if (it.stock > 0 && it.stock <= 2 && it.logistic !== 'fulfillment') reasons.push('stock muy bajo');
      if (it.manufacturing) reasons.push(`entrega a plazo (${it.manufacturing})`);
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
    at: F().at || null, range: F().range || null, missing: F().missing || 0, errors: F().errors || [], job: status(), listings_at: L.updated_at || null,
  };
}

module.exports = { refresh, status, list };
