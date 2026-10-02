// Productos de la web biogate.com.ar (WooCommerce): nombre, SKU, precio y foto principal.
// Primero usa la lista pública de WooCommerce (Store API, sin claves). Si la web la tiene
// cerrada, usa la API con clave de solo lectura (Configuración → clave y secreto de WooCommerce).
const store = require('./store');

const DEFAULT_SITE = 'https://biogate.com.ar';
const siteUrl = () => String(store.getSettings().web_url || DEFAULT_SITE).trim().replace(/\/+$/, '');

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', deg: '°', reg: '®', trade: '™', copy: '©' };
const clean = (s) => String(s ?? '').replace(/<[^>]*>/g, '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m).replace(/\s+/g, ' ').trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

async function getJson(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'BiogatePanel/1.0', accept: 'application/json' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* no es JSON */ }
  return { ok: r.ok, status: r.status, data, headers: r.headers };
}

// Store API: precios en unidades menores (centavos) según currency_minor_unit.
function fromStore(p) {
  const pr = p.prices || {};
  const div = 10 ** (Number(pr.currency_minor_unit) || 0);
  const price = num(pr.price) ? pr.price / div : null;
  const regular = num(pr.regular_price) ? pr.regular_price / div : null;
  return {
    id: p.id, name: clean(p.name), sku: String(p.sku || '').trim(), permalink: p.permalink || '',
    price, regular_price: regular && price && regular > price ? regular : null,
    image: (p.images || [])[0]?.src || '', thumb: (p.images || [])[0]?.thumbnail || (p.images || [])[0]?.src || '',
    in_stock: p.is_in_stock !== false,
    desc: clean(p.short_description || p.description).slice(0, 900), cats: (p.categories || []).map(c => clean(c.name)).filter(Boolean),
  };
}
// API v3 (con clave): precios como texto en pesos.
function fromV3(p) {
  const price = num(p.price), regular = num(p.regular_price);
  return {
    id: p.id, name: clean(p.name), sku: String(p.sku || '').trim(), permalink: p.permalink || '',
    price, regular_price: regular && price && regular > price ? regular : null,
    image: (p.images || [])[0]?.src || '', thumb: (p.images || [])[0]?.src || '',
    in_stock: p.stock_status !== 'outofstock',
    desc: clean(p.short_description || p.description).slice(0, 900), cats: (p.categories || []).map(c => clean(c.name)).filter(Boolean),
  };
}

let syncing = null;
function sync() {
  if (syncing) return syncing;
  syncing = (async () => {
    const site = siteUrl();
    const st = store.getSettings();
    const items = [];
    let source = '';
    // 1) Lista pública
    let first = await getJson(`${site}/wp-json/wc/store/v1/products?per_page=100&page=1`).catch(e => ({ ok: false, status: 0, error: e.message }));
    if (first.ok && Array.isArray(first.data)) {
      source = 'lista pública de WooCommerce';
      const pages = Math.min(Number(first.headers.get('x-wp-totalpages')) || 50, 50);
      items.push(...first.data.map(fromStore));
      for (let p = 2; p <= pages; p++) {
        const r = await getJson(`${site}/wp-json/wc/store/v1/products?per_page=100&page=${p}`);
        if (!r.ok || !Array.isArray(r.data) || !r.data.length) break;
        items.push(...r.data.map(fromStore));
      }
    } else if (st.wc_key && st.wc_secret) {
      // 2) API con clave de solo lectura
      source = 'API de WooCommerce (con clave)';
      const auth = `consumer_key=${encodeURIComponent(st.wc_key)}&consumer_secret=${encodeURIComponent(st.wc_secret)}`;
      for (let p = 1; p <= 50; p++) {
        const r = await getJson(`${site}/wp-json/wc/v3/products?per_page=100&page=${p}&status=publish&${auth}`);
        if (!r.ok) throw new Error(`La web respondió ${r.status} con la clave de WooCommerce: ${r.data?.message || 'revisá la clave y el secreto'}.`);
        if (!Array.isArray(r.data) || !r.data.length) break;
        items.push(...r.data.map(fromV3));
        if (r.data.length < 100) break;
      }
    } else {
      const why = first.status ? `respondió ${first.status}` : `no respondió (${first.error || 'sin conexión'})`;
      throw new Error(`La web ${site} ${why} al pedir la lista de productos. Si la tenés cerrada, cargá una clave de solo lectura de WooCommerce en "Configurar web".`);
    }
    const list = items.filter(i => i.name && i.image);
    const data = { items: list, count: list.length, source, site, updated_at: new Date().toISOString() };
    store.saveWeb(data);
    return data;
  })().finally(() => { syncing = null; });
  return syncing;
}

// Solo se permiten fotos de la propia web (o del CDN de WordPress) para el armado de estados.
function allowedImage(u) {
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return false;
    const host = url.hostname.replace(/^www\./, '');
    const siteHost = new URL(siteUrl()).hostname.replace(/^www\./, '');
    return host === siteHost || host.endsWith('.' + siteHost) || /(^|\.)wp\.com$/.test(host);
  } catch { return false; }
}

async function image(u) {
  if (!allowedImage(u)) throw new Error('Foto no permitida.');
  const r = await fetch(u, { headers: { 'user-agent': 'BiogatePanel/1.0' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`La web respondió ${r.status} al pedir la foto.`);
  const type = r.headers.get('content-type') || '';
  if (!/^image\//.test(type)) throw new Error('El link no es una imagen.');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 15 * 1024 * 1024) throw new Error('La foto es demasiado grande.');
  return { type, buf };
}

// Prueba la clave de WooCommerce pidiendo 1 pedido (permiso de lectura).
async function testKey() {
  const st = store.getSettings();
  if (!st.wc_key || !st.wc_secret) throw new Error('Falta cargar la clave del cliente (ck_) y la clave secreta (cs_).');
  const auth = `consumer_key=${encodeURIComponent(st.wc_key)}&consumer_secret=${encodeURIComponent(st.wc_secret)}`;
  const r = await getJson(`${siteUrl()}/wp-json/wc/v3/orders?per_page=1&${auth}`).catch(e => ({ ok: false, status: 0, data: { message: e.message } }));
  if (r.ok) return { orders: Number(r.headers.get('x-wp-total')) || (Array.isArray(r.data) ? r.data.length : 0) };
  const msg = r.data?.message || r.data?.code || '';
  if (r.status === 401) throw new Error(`La web rechazó la clave (401). Revisá que la clave y el secreto estén completos y que el permiso sea "Lectura" o "Lectura/Escritura". ${msg}`);
  if (r.status === 403) throw new Error(`La web bloqueó el acceso (403). Puede ser un plugin de seguridad o el firewall del hosting. ${msg}`);
  if (r.status === 404) throw new Error('La web no tiene activa la API de WooCommerce (404). En WordPress: Ajustes → Enlaces permanentes → elegí "Nombre de la entrada" y guardá.');
  throw new Error(`La web respondió ${r.status || 'sin conexión'}. ${msg}`);
}

module.exports = { testKey, sync, image, siteUrl, DEFAULT_SITE, clean, fromStore };
