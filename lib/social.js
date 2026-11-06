// Avisos de compras reales en la web: el panel le manda a biogate.com.ar las últimas ventas de verdad
// (Mercado Libre de todas las cuentas + web), solo de productos que también están en la web (se cruzan por SKU).
// No se manda ningún nombre ni dato del comprador: producto, ciudad/provincia y cuándo fue.
const store = require('./store');
const web = require('./web');

const norm = (s) => String(s || '').trim().toUpperCase();
const ymd = (d) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10);
const PROV = { 'Capital Federal': 'CABA', 'Ciudad Autónoma de Buenos Aires': 'CABA', 'Buenos Aires': 'Buenos Aires' };

function feed(max = 40) {
  const prods = (store.getWebcat().products || []).filter(p => p.status === 'publish' && p.link);
  const bySku = new Map(); for (const p of prods) if (p.sku) bySku.set(norm(p.sku), p);
  const sales = store.getSales(ymd(new Date(Date.now() - 10 * 864e5)), ymd(new Date()))
    .filter(s => !s.cancelled && !['unpaid', 'ml_cancelled'].includes(s.order_state))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const out = [], seen = new Set();
  for (const s of sales) {
    for (const i of s.items || []) {
      const p = bySku.get(norm(i.sku)); if (!p) continue;
      const key = s.order_id + '|' + p.id; if (seen.has(key)) continue; seen.add(key);
      const city = String(s.city || '').trim(), st = PROV[String(s.state || '').trim()] || String(s.state || '').trim();
      const place = city && st && city.toLowerCase() !== st.toLowerCase() ? `${city}, ${st}` : city || st || '';
      out.push({ n: p.name, u: p.link, i: p.thumb || '', p: place, t: Math.floor(new Date(s.date).getTime() / 1000) });
      break; // una línea por venta
    }
    if (out.length >= max) break;
  }
  return out;
}

async function push() {
  const st = store.getSettings();
  if (!st.wc_key || !st.wc_secret) return { ok: false, skipped: 'sin clave' };
  if (!(store.getWebcat().products || []).length) await require('./webcat').sync();
  const items = feed();
  const url = `${web.siteUrl()}/wp-json/wc/v3/bg-social?consumer_key=${encodeURIComponent(st.wc_key)}&consumer_secret=${encodeURIComponent(st.wc_secret)}`;
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'BiogatePanel/1.0' }, body: JSON.stringify({ items }), signal: AbortSignal.timeout(30000) });
  if (r.status === 404) return { ok: false, skipped: 'el código de avisos no está activo en la web' };
  if (!r.ok) throw new Error('La web respondió ' + r.status);
  return { ok: true, sent: items.length };
}

module.exports = { feed, push };
