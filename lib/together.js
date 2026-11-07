// "Se compran juntos" en la web: el panel mira qué productos se compraron juntos DE VERDAD
// (Mercado Libre: mismo carrito o mismo comprador el mismo día · web: mismo pedido · presupuestos: mismo presupuesto)
// en el último año, los cruza con los productos de la web por SKU y le manda a biogate.com.ar, para cada producto,
// los que más se llevaron junto con él. Solo se muestran pares que se repitieron al menos 2 veces.
const store = require('./store');
const web = require('./web');

const DAYS = 365, MIN_TIMES = 2, MAX_PER = 3;
const norm = (s) => String(s || '').trim().toUpperCase();
const ymd = (d) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10);

function baskets() {
  const prods = (store.getWebcat().products || []).filter(p => p.status === 'publish' && p.type !== 'variation');
  const bySku = new Map(), ids = new Set(prods.map(p => p.id));
  for (const p of prods) if (p.sku && !bySku.has(norm(p.sku))) bySku.set(norm(p.sku), p.id);
  const pid = (sku, productId) => (productId && ids.has(Number(productId)) ? Number(productId) : bySku.get(norm(sku)));
  const out = [];
  const from = ymd(new Date(Date.now() - DAYS * 864e5)), to = ymd(new Date());
  // Mercado Libre: mismo carrito (pack) o, si no hay pack, mismo comprador en la misma cuenta y el mismo día
  const g = new Map();
  for (const s of store.getSales(from, to)) {
    if (s.cancelled || ['cancelled', 'returned', 'unpaid', 'ml_cancelled'].includes(s.order_state)) continue;
    const key = s.pack_id ? 'p' + s.pack_id : s.buyer ? `b${s.account_id}|${s.buyer}|${String(s.date).slice(0, 10)}` : 'o' + s.order_id;
    if (!g.has(key)) g.set(key, new Set());
    for (const i of s.items || []) { const id = pid(i.sku); if (id) g.get(key).add(id); }
  }
  for (const set of g.values()) out.push(set);
  // Web
  const cut = Date.now() - DAYS * 864e5;
  for (const o of Object.values(store.getWoo().orders || {})) {
    if (new Date(o.date).getTime() < cut || !['processing', 'completed'].includes(o.status)) continue;
    out.push(new Set((o.items || []).map(i => pid(i.sku, i.product_id)).filter(Boolean)));
  }
  // Presupuestos confirmados
  for (const q of store.getQuotes() || []) {
    if (q.confirmed === false || String(q.date || '') < from) continue;
    out.push(new Set((q.items || []).map(i => pid(i.sku)).filter(Boolean)));
  }
  return out.filter(s => s.size >= 2);
}

function build() {
  const pairs = new Map();
  for (const set of baskets()) {
    const a = [...set];
    for (const x of a) for (const y of a) if (x !== y) {
      if (!pairs.has(x)) pairs.set(x, new Map());
      pairs.get(x).set(y, (pairs.get(x).get(y) || 0) + 1);
    }
  }
  const map = {};
  for (const [x, m] of pairs) {
    const top = [...m].filter(([, n]) => n >= MIN_TIMES).sort((a, b) => b[1] - a[1]).slice(0, MAX_PER).map(([y]) => y);
    if (top.length) map[x] = top;
  }
  return map;
}

async function push() {
  const st = store.getSettings();
  if (!st.wc_key || !st.wc_secret) return { ok: false, skipped: 'sin clave' };
  if (!(store.getWebcat().products || []).length) await require('./webcat').sync();
  const map = build();
  const url = `${web.siteUrl()}/wp-json/wc/v3/bg-together?consumer_key=${encodeURIComponent(st.wc_key)}&consumer_secret=${encodeURIComponent(st.wc_secret)}`;
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'BiogatePanel/1.0' }, body: JSON.stringify({ map }), signal: AbortSignal.timeout(30000) });
  if (r.status === 404) return { ok: false, skipped: 'el código de "se compran juntos" no está activo en la web' };
  if (!r.ok) throw new Error('La web respondió ' + r.status);
  return { ok: true, products: Object.keys(map).length };
}

module.exports = { build, push, baskets };
