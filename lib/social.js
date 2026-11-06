// Avisos de compras reales en la web: el panel le manda a biogate.com.ar las últimas ventas de verdad
// (Mercado Libre de todas las cuentas + web), solo de productos que también están en la web (se cruzan por SKU).
// No se manda ningún nombre ni dato del comprador: producto, ciudad/provincia y cuándo fue.
// Para que salgan compras de hace pocos minutos, fresh() mira cada 5 minutos las últimas ventas de cada cuenta
// (una consulta liviana por cuenta) sin esperar a la importación completa de ventas.
const store = require('./store');
const web = require('./web');

const norm = (s) => String(s || '').trim().toUpperCase();
const ymd = (d) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10);
const PROV = { 'Capital Federal': 'CABA', 'Ciudad Autónoma de Buenos Aires': 'CABA', 'Buenos Aires': 'Buenos Aires' };
const DAYS = 10;

const recentBox = () => { const w = store.getWebcat(); w.social_recent = w.social_recent || {}; return w.social_recent; };

// Últimas ventas pagas de cada cuenta de ML que todavía no entraron en la importación de ventas.
async function fresh() {
  const ml = require('./ml');
  const known = new Set(store.getSales(ymd(new Date(Date.now() - 3 * 864e5)), ymd(new Date())).map(s => String(s.order_id)));
  const box = recentBox(), cut = Date.now() - 3 * 864e5;
  for (const [k, v] of Object.entries(box)) if (new Date(v.date).getTime() < cut || known.has(k)) delete box[k];
  let added = 0;
  for (const acc of store.getAccounts().filter(a => !a.needs_reconnect)) {
    try {
      const r = await ml.get(acc, `/orders/search?seller=${acc.user_id}&sort=date_desc&limit=15`);
      if (!r.ok) continue;
      for (const o of r.data.results || []) {
        const id = String(o.id);
        if (known.has(id) || box[id]) continue;
        if (new Date(o.date_created).getTime() < cut) continue;
        const paid = (o.tags || []).includes('paid') || (o.payments || []).some(p => p.status === 'approved');
        if (!paid || ['cancelled', 'invalid'].includes(o.status)) continue;
        let city = '', state = '';
        const shipId = o.shipping && o.shipping.id;
        if (shipId) {
          const sh = await ml.get(acc, `/shipments/${shipId}`).catch(() => null);
          const ra = (sh && sh.ok && (sh.data.receiver_address || (sh.data.destination || {}).shipping_address)) || {};
          city = (ra.city && ra.city.name) || ''; state = (ra.state && ra.state.name) || '';
        }
        box[id] = { order_id: id, date: o.date_created, city, state, items: (o.order_items || []).map(i => ({ sku: ml.pick((i.item || {}).seller_sku, (i.item || {}).seller_custom_field) })) };
        added++;
      }
    } catch (e) { console.log('Avisos web (' + (acc.nickname || acc.user_id) + '):', e.message); }
  }
  store.saveWebcat();
  return added;
}

function feed(max = 40) {
  const prods = (store.getWebcat().products || []).filter(p => p.status === 'publish' && p.link);
  const bySku = new Map(), byId = new Map();
  for (const p of prods) { if (p.sku) bySku.set(norm(p.sku), p); byId.set(String(p.id), p); }
  const from = ymd(new Date(Date.now() - DAYS * 864e5)), to = ymd(new Date());
  const rows = [];
  // Mercado Libre (importadas)
  for (const s of store.getSales(from, to)) {
    if (s.cancelled || ['unpaid', 'ml_cancelled'].includes(s.order_state)) continue;
    rows.push({ key: 'ml' + s.order_id, date: s.date, city: s.city, state: s.state, prods: (s.items || []).map(i => bySku.get(norm(i.sku))) });
  }
  // Mercado Libre (recién entradas, todavía sin importar)
  const seenMl = new Set(rows.map(r => r.key));
  for (const s of Object.values(store.getWebcat().social_recent || {})) {
    if (seenMl.has('ml' + s.order_id)) continue;
    rows.push({ key: 'ml' + s.order_id, date: s.date, city: s.city, state: s.state, prods: (s.items || []).map(i => bySku.get(norm(i.sku))) });
  }
  // Web
  const woo = require('./woo'), wcut = Date.now() - DAYS * 864e5;
  for (const o of Object.values(store.getWoo().orders || {})) {
    if (new Date(o.date).getTime() < wcut || !woo.COUNTED.includes(o.status)) continue;
    rows.push({ key: 'w' + o.id, date: o.date, city: o.city, state: o.state, prods: (o.items || []).map(i => bySku.get(norm(i.sku)) || byId.get(String(i.product_id))) });
  }
  rows.sort((a, b) => new Date(b.date) - new Date(a.date));
  const out = [];
  for (const r of rows) {
    const p = r.prods.find(Boolean); if (!p) continue;
    const city = String(r.city || '').trim(), st = PROV[String(r.state || '').trim()] || String(r.state || '').trim();
    const place = city && st && city.toLowerCase() !== st.toLowerCase() ? `${city}, ${st}` : city || st || '';
    out.push({ n: p.name, u: p.link, i: p.thumb || '', p: place, t: Math.floor(new Date(r.date).getTime() / 1000) });
    if (out.length >= max) break;
  }
  return out;
}

async function push({ refresh = false } = {}) {
  const st = store.getSettings();
  if (!st.wc_key || !st.wc_secret) return { ok: false, skipped: 'sin clave' };
  if (!(store.getWebcat().products || []).length) await require('./webcat').sync();
  if (refresh) await fresh().catch(e => console.log('Avisos web:', e.message));
  const items = feed();
  const url = `${web.siteUrl()}/wp-json/wc/v3/bg-social?consumer_key=${encodeURIComponent(st.wc_key)}&consumer_secret=${encodeURIComponent(st.wc_secret)}`;
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'BiogatePanel/1.0' }, body: JSON.stringify({ items }), signal: AbortSignal.timeout(30000) });
  if (r.status === 404) return { ok: false, skipped: 'el código de avisos no está activo en la web' };
  if (!r.ok) throw new Error('La web respondió ' + r.status);
  return { ok: true, sent: items.length, newest: items[0] ? new Date(items[0].t * 1000).toISOString() : null };
}

module.exports = { feed, push, fresh };
