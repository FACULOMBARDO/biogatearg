// Publicar en varias cuentas: desde un link de Mercado Libre, desde un link de Amazon o desde cero.
// Calcula costo (Amazon: (US$ + kg × US$ por kilo) × cambio), comisión real de ML, impuestos y envío,
// y busca quién más vende el producto en Mercado Libre.
const store = require('./store');
const ml = require('./ml');
const { get, post, pick } = ml;

const TAX = () => Number(store.getSettings().tax_pct ?? 23) / 100;
const FREE_MIN = () => Number(store.getSettings().free_ship_min ?? 33000) || 0;
const anyAcc = () => { const a = store.getAccounts().find(x => !x.needs_reconnect); if (!a) throw new Error('No hay ninguna cuenta de Mercado Libre conectada.'); return a; };
const errText = (r) => {
  const d = (r && r.data) || {};
  const cause = Array.isArray(d.cause) ? d.cause.map(c => c.message || c.code || c).filter(Boolean).join(' · ') : '';
  return [d.message || d.error, cause].filter(Boolean).join(' — ') || 'error ' + (r && r.status);
};
async function retry(fn) {
  let r = null;
  for (let i = 0; i < 3; i++) {
    r = await fn().catch(e => ({ ok: false, status: 0, data: { message: e.message } }));
    if (r.ok || (r.status && r.status !== 429 && r.status < 500)) return r;
    await new Promise(ok => setTimeout(ok, 800 * 2 ** i));
  }
  return r;
}

// ---------- Desde un link de Mercado Libre ----------
const SKIP_ATTR = new Set(['SELLER_SKU', 'ITEM_CONDITION']);
// Estos se completan aparte en el formulario (código universal y paquete).
const SPECIAL = new Set(['GTIN', 'EMPTY_GTIN_REASON', 'SELLER_PACKAGE_HEIGHT', 'SELLER_PACKAGE_WIDTH', 'SELLER_PACKAGE_LENGTH', 'SELLER_PACKAGE_WEIGHT']);
const ATTR_ES = { GTIN: 'Código universal (EAN/UPC)', EMPTY_GTIN_REASON: 'Motivo de no tener código universal', SELLER_PACKAGE_HEIGHT: 'Alto del paquete', SELLER_PACKAGE_WIDTH: 'Ancho del paquete', SELLER_PACKAGE_LENGTH: 'Largo del paquete', SELLER_PACKAGE_WEIGHT: 'Peso del paquete' };
async function fromMl(link) {
  const s = String(link || '');
  const acc = anyAcc();
  let itemId = null, productId = null;
  const mp = s.match(/\/p\/(MLA\d+)/i); if (mp) productId = mp[1].toUpperCase();
  const mi = s.match(/(MLA)-?(\d{3,})/i); if (!productId && mi) itemId = 'MLA' + mi[2];
  const wid = s.match(/[?&]wid=(MLA\d+)/i); if (wid) itemId = wid[1].toUpperCase();
  if (!itemId && !productId) throw new Error('No encontré el número de publicación en ese link (tiene que tener MLA…).');
  let product = null;
  if (productId && !itemId) {
    const p = await retry(() => get(acc, `/products/${productId}`));
    if (!p.ok) throw new Error('No pude leer ese producto de catálogo: ' + errText(p));
    product = p.data;
    itemId = pick(product.buy_box_winner?.item_id);
    if (!itemId) { const its = await retry(() => get(acc, `/products/${productId}/items?limit=1`)); itemId = its && its.ok ? pick(its.data.results?.[0]?.item_id) : ''; }
  }
  let b = null;
  if (itemId) { const r = await retry(() => get(acc, `/items/${itemId}?include_attributes=all`)); if (r.ok) b = r.data; }
  if (!b && !product) throw new Error('No pude leer esa publicación.');
  const desc = itemId ? await retry(() => get(acc, `/items/${itemId}/description`)) : null;
  const pics = (b?.pictures || product?.pictures || []).map(p => p.secure_url || p.url).filter(Boolean);
  const attrs = (b?.attributes || product?.attributes || []).filter(a => !SKIP_ATTR.has(a.id) && (a.value_name || a.value_id))
    .map(a => ({ id: a.id, name: a.name || a.id, value_id: a.value_id || null, value_name: a.value_name || '' }));
  const own = b && store.getAccounts().some(a => String(a.user_id) === String(b.seller_id));
  const av = (id) => { const a = (b?.attributes || product?.attributes || []).find(x => x.id === id); return a ? (a.value_name || '') : ''; };
  const num = (v) => Number(String(v || '').replace(',', '.').match(/[\d.]+/)?.[0] || 0);
  return {
    source: 'ml', source_id: itemId || productId, own_listing: !!own,
    title: b?.title || product?.name || '', category_id: b?.category_id || '', price: b?.price || null,
    catalog_product_id: b?.catalog_product_id || productId || null,
    pictures: pics, attributes: attrs, description: desc && desc.ok ? (desc.data.plain_text || '') : '',
    listing_type: b?.listing_type_id || 'gold_special', variations: (b?.variations || []).length,
    weight_kg: null, usd: null,
    gtin: av('GTIN'), pkg: { h: num(av('SELLER_PACKAGE_HEIGHT')), w: num(av('SELLER_PACKAGE_WIDTH')), l: num(av('SELLER_PACKAGE_LENGTH')), g: num(av('SELLER_PACKAGE_WEIGHT')) * (/kg/i.test(av('SELLER_PACKAGE_WEIGHT')) ? 1000 : 1) },
  };
}

// ---------- Desde un link de Amazon ----------
// Amazon suele bloquear estas lecturas: si falla, se cargan precio, peso y fotos a mano.
const LB = 0.45359237, OZ = 0.028349523125;
function parseWeight(t) {
  const m = String(t || '').replace(/,/g, '.').match(/(\d+(?:\.\d+)?)\s*(pounds?|lbs?|ounces?|oz|kilograms?|kg|grams?|g)\b/i);
  if (!m) return null;
  const v = Number(m[1]), u = m[2].toLowerCase();
  const kg = /^(pound|lb)/.test(u) ? v * LB : /^(ounce|oz)/.test(u) ? v * OZ : /^(kilogram|kg)/.test(u) ? v : v / 1000;
  return { kg: Math.round(kg * 1000) / 1000, text: m[0] };
}
async function fromAmazon(link) {
  const u = String(link || '').trim();
  const asin = (u.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i) || [])[1];
  if (!/amazon\./i.test(u) && !asin) throw new Error('Ese no parece un link de Amazon.');
  const out = { source: 'amazon', source_id: asin || '', link: u, title: '', usd: null, weight_kg: null, weight_text: '', gtin: '', dims_cm: null, pictures: [], bullets: [], description: '', attributes: [], blocked: false };
  try {
    const r = await fetch(asin ? `https://www.amazon.com/dp/${asin}` : u, {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36', 'accept-language': 'en-US,en;q=0.9', accept: 'text/html' },
      signal: AbortSignal.timeout(15000), redirect: 'follow',
    });
    const html = await r.text();
    if (!r.ok || /captcha|Robot Check|api-services-support@amazon/i.test(html.slice(0, 20000))) throw new Error('blocked');
    const txt = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
    out.title = txt((html.match(/id="productTitle"[^>]*>([\s\S]*?)<\/span>/) || [])[1]);
    const price = (html.match(/class="a-offscreen">\s*\$([\d,]+\.\d{2})/) || html.match(/"priceAmount":([\d.]+)/) || [])[1];
    if (price) out.usd = Number(String(price).replace(/,/g, ''));
    const hi = [...html.matchAll(/"hiRes":"(https:[^"]+)"/g)].map(m => m[1]);
    const lg = [...html.matchAll(/"large":"(https:[^"]+)"/g)].map(m => m[1]);
    out.pictures = [...new Set(hi.length ? hi : lg)].slice(0, 10);
    out.bullets = [...((html.match(/id="feature-bullets"[\s\S]*?<\/ul>/) || [''])[0].matchAll(/<span class="a-list-item">([\s\S]*?)<\/span>/g))].map(m => txt(m[1])).filter(Boolean).slice(0, 10);
    const wRow = html.match(/(Item Weight|Product Weight|Package Weight)[\s\S]{0,300}?<\/t[dh]>[\s\S]{0,200}?<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/i) || html.match(/(Item Weight|Package Dimensions)[^<]*<\/span>\s*<span[^>]*>([^<]+)/i);
    const w = parseWeight(wRow ? txt(wRow[2]) : (html.match(/(\d+(?:\.\d+)?\s*(?:Pounds|Ounces))/i) || [])[1]);
    if (w) { out.weight_kg = w.kg; out.weight_text = w.text; }
    const upc = html.match(/(?:UPC|EAN)[^0-9]{0,80}?(\d{12,14})/);
    if (upc) out.gtin = upc[1];
    const dim = txt(html).match(/(?:Package|Product|Item) Dimensions[^0-9]{0,40}(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(inches|cm|centimeters)?/i);
    if (dim) { const k = /^in/i.test(dim[4] || 'inches') ? 2.54 : 1; out.dims_cm = [dim[1], dim[2], dim[3]].map(v => Math.ceil(Number(v) * k)); }
    if (!out.title) throw new Error('blocked');
  } catch { out.blocked = true; }
  return out;
}

// ---------- Categoría ----------
async function categories(q) {
  const acc = anyAcc();
  const r = await retry(() => get(acc, `/sites/MLA/domain_discovery/search?limit=6&q=${encodeURIComponent(String(q || '').slice(0, 120))}`));
  if (!r.ok) throw new Error(errText(r));
  const list = (Array.isArray(r.data) ? r.data : []).map(c => ({ category_id: c.category_id, name: c.category_name, domain: c.domain_name, attributes: (c.attributes || []).map(a => ({ id: a.id, name: a.name, value_id: a.value_id || null, value_name: a.value_name || '' })) }));
  return list;
}
async function categoryInfo(cat) {
  const acc = anyAcc();
  const [c, attrs] = await Promise.all([retry(() => get(acc, `/categories/${cat}`)), require('./listings').categoryAttrs(acc, cat)]);
  return {
    category_id: cat, name: c && c.ok ? (c.data.path_from_root || []).map(p => p.name).join(' › ') : cat,
    gtin: attrs.some(a => a.id === 'GTIN'),
    gtin_reasons: ((attrs.find(a => a.id === 'EMPTY_GTIN_REASON') || {}).values || []).map(v => ({ id: v.id, name: v.name })),
    package: attrs.some(a => /^SELLER_PACKAGE_/.test(a.id)),
    attributes: attrs.filter(a => !(a.tags && (a.tags.read_only || a.tags.hidden || a.tags.fixed || a.tags.inferred || a.tags.others)) && !SKIP_ATTR.has(a.id) && !SPECIAL.has(a.id))
      .map(a => ({ id: a.id, name: a.name, required: !!(a.tags && (a.tags.required || a.tags.catalog_required || a.tags.conditional_required)), type: a.value_type, unit: a.default_unit || '', units: (a.allowed_units || []).map(u => u.name), values: (a.values || []).slice(0, 200).map(v => ({ id: v.id, name: v.name })), hint: a.hint || a.tooltip || '' })),
  };
}

// ---------- Precio: comisión real, impuestos, envío y neto ----------
async function mlFee(acc, price, cat, type, tag) {
  const t = tag && tag !== 'no-campaign' ? '&tags=' + encodeURIComponent(tag) : '';
  const r = await retry(() => get(acc, `/sites/MLA/listing_prices?price=${Math.round(price)}&listing_type_id=${type || 'gold_special'}${cat ? '&category_id=' + cat : ''}${t}`));
  const d = r && r.ok ? (Array.isArray(r.data) ? r.data.find(x => x.listing_type_id === (type || 'gold_special')) || r.data[0] : r.data) : null;
  if (!d) return { pct: 0.15, fixed: 0, total: Math.round(price * 0.15), estimated: true };
  const det = d.sale_fee_details || {};
  return { pct: Number(det.percentage_fee || 0) / 100, fixed: Number(det.fixed_fee || 0), total: Number(d.sale_fee_amount || 0), estimated: false };
}
async function shipCost(acc, price, kg) {
  if (!(price >= FREE_MIN())) return { cost: 0, free: false };
  const grams = Math.max(100, Math.round((kg || 0.5) * 1000));
  const r = await retry(() => get(acc, `/users/${acc.user_id}/shipping_options/free?dimensions=20x15x10,${grams}&item_price=${Math.round(price)}&listing_type_id=gold_special&mode=me2&condition=new&logistic_type=drop_off&verbose=true`));
  const c = r && r.ok ? Number(r.data?.coverage?.all_country?.list_cost ?? r.data?.coverage?.all_country?.cost ?? NaN) : NaN;
  if (Number.isFinite(c)) return { cost: Math.round(c), free: true };
  const calc = store.getSettings().calc || {};
  return { cost: Math.round(Number(calc.mlShip) || 0), free: true, estimated: true };
}
// Desglose de un precio dado.
async function breakdown(b) {
  const acc = anyAcc();
  const price = Math.round(Number(b.price) || 0), cost = Math.round(Number(b.cost) || 0);
  if (!(price > 0)) throw new Error('Poné un precio.');
  const [fee, ship] = await Promise.all([mlFee(acc, price, b.category_id, b.listing_type, b.campaign), shipCost(acc, price, Number(b.weight_kg) || 0)]);
  const tax = Math.round(price * TAX());
  const net = price - fee.total - tax - ship.cost - cost;
  return { price, cost, fee: fee.total, fee_pct: Math.round(fee.pct * 1000) / 10, fee_fixed: fee.fixed, fee_estimated: !!fee.estimated, tax, tax_pct: Math.round(TAX() * 1000) / 10, ship: ship.cost, free_ship: ship.free, ship_estimated: !!ship.estimated, net, margin_pct: Math.round(net / price * 1000) / 10 };
}
// Precio que deja el margen buscado (sobre el precio de venta).
async function priceFor(b) {
  const cost = Math.round(Number(b.cost) || 0), m = Number(b.margin) / 100, rnd = Number(b.round) || 100;
  if (!(cost > 0)) throw new Error('Falta el costo para calcular el precio.');
  const acc = anyAcc();
  let P = cost / Math.max(0.05, 1 - TAX() - 0.15 - m);
  for (let i = 0; i < 4; i++) {
    const [fee, ship] = await Promise.all([mlFee(acc, P, b.category_id, b.listing_type, b.campaign), shipCost(acc, P, Number(b.weight_kg) || 0)]);
    const den = 1 - TAX() - fee.pct - m;
    if (den <= 0.05) throw new Error('Con ese margen no hay precio posible: bajá el margen.');
    P = (cost + fee.fixed + ship.cost) / den;
  }
  P = rnd === 999 ? Math.ceil((P + 1) / 1000) * 1000 - 1 : Math.ceil(P / rnd) * rnd;
  return breakdown({ ...b, price: P });
}
// Costo de un producto de Amazon en pesos.
function amazonCost(usd, kg) {
  const t = require('./tuyo'), c = t.cfg();
  const ship = (Number(kg) || 0) * c.kg_usd, total = (Number(usd) || 0) + ship;
  return { usd: Number(usd) || 0, kg: Number(kg) || 0, kg_usd: c.kg_usd, ship_usd: Math.round(ship * 100) / 100, total_usd: Math.round(total * 100) / 100, tc: c.tc, cost: Math.round(total * c.tc) };
}

// ---------- Quién más lo vende en Mercado Libre ----------
async function market(q) {
  const acc = anyAcc(), query = encodeURIComponent(String(q || '').slice(0, 120));
  const mine = new Set(store.getAccounts().map(a => String(a.user_id)));
  let items = [], total = 0, mode = 'search';
  const r = await retry(() => get(acc, `/sites/MLA/search?q=${query}&limit=20`));
  if (r.ok) {
    total = r.data.paging?.total || 0;
    items = (r.data.results || []).map(x => ({
      id: x.id, title: x.title, price: x.price, original_price: x.original_price || null, sold: x.sold_quantity ?? null,
      seller_id: String(x.seller?.id || ''), seller: x.seller?.nickname || '', official: !!x.official_store_id,
      free_ship: !!x.shipping?.free_shipping, full: x.shipping?.logistic_type === 'fulfillment', link: x.permalink, catalog: !!x.catalog_listing,
    }));
  } else {
    // ML cerró la búsqueda general para aplicaciones: se busca en el catálogo y se traen los vendedores de cada producto.
    mode = 'catalog';
    const ps = await retry(() => get(acc, `/products/search?status=active&site_id=MLA&q=${query}&limit=4`));
    if (!ps.ok) throw new Error('Mercado Libre no dejó buscar este producto (' + errText(ps) + ').');
    const prods = (ps.data.results || []).slice(0, 4);
    for (const p of prods) {
      const its = await retry(() => get(acc, `/products/${p.id}/items?limit=20`));
      for (const x of (its && its.ok ? its.data.results || [] : [])) items.push({
        id: x.item_id, product: p.name, title: p.name, price: x.price, original_price: x.original_price || null, sold: null,
        seller_id: String(x.seller_id || ''), seller: '', official: !!x.official_store_id,
        free_ship: !!x.shipping?.free_shipping, full: x.shipping?.logistic_type === 'fulfillment', link: `https://www.mercadolibre.com.ar/p/${p.id}`, catalog: true,
      });
    }
    total = items.length;
    // Título, link y vendidos de cada publicación (de a 20)
    for (let i = 0; i < items.length; i += 20) {
      const part = items.slice(i, i + 20);
      const m = await retry(() => get(acc, `/items?ids=${part.map(x => x.id).join(',')}&attributes=id,title,permalink,sold_quantity`));
      for (const y of (m && m.ok && Array.isArray(m.data) ? m.data : [])) {
        const it = items.find(z => z.id === (y.body && y.body.id)); if (!it || y.code !== 200) continue;
        it.title = y.body.title || it.title; if (y.body.permalink) it.link = y.body.permalink; if (y.body.sold_quantity != null) it.sold = y.body.sold_quantity;
      }
    }
  }
  for (const i of items) i.mine = mine.has(i.seller_id);
  // Nombres de los vendedores
  const need = [...new Set(items.filter(i => !i.seller && i.seller_id && !i.mine).map(i => i.seller_id))].slice(0, 25);
  for (const id of need) { const u = await retry(() => get(acc, `/users/${id}`)); if (u && u.ok) for (const i of items) if (i.seller_id === id) i.seller = u.data.nickname || ''; }
  for (const i of items) if (i.mine && !i.seller) i.seller = (store.getAccount(i.seller_id) || {}).nickname || 'vos';
  items.sort((a, b) => a.price - b.price);
  const prices = items.filter(i => !i.mine).map(i => i.price).sort((a, b) => a - b);
  return { mode, total, items, min: prices[0] || null, max: prices[prices.length - 1] || null, median: prices.length ? prices[Math.floor(prices.length / 2)] : null };
}

// ---------- Publicar ----------
// Tipos de publicación y planes de cuotas tal cual los ofrece Mercado Libre para esa categoría y ese precio
// (Clásica sin cuotas, Clásica con cuotas con interés bajo, Premium 3 / 6 / 9 / 12 cuotas al mismo precio, etc.),
// con lo que cobra cada uno: cargo por venta, cargo por cuotas y total.
// Campañas: GET /special_installments/campaigns?category_id=… · costos: /sites/MLA/listing_prices con listing_type_id y tags.
async function pool(list, n, fn) { const q = [...list]; await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) await fn(q.shift()); })); }
function parseCampaigns(data) {
  const out = [];
  const LT = new Set(['gold_special', 'gold_pro', 'gold_premium', 'gold', 'silver', 'bronze']);
  const walk = (node, ctx) => {
    if (Array.isArray(node)) { node.forEach(n => walk(n, ctx)); return; }
    if (!node || typeof node !== 'object') return;
    const c = { lt: node.listing_type_id || ctx.lt, ch: node.channel || ctx.ch };
    if (node.campaign_id) { out.push({ listing_type: c.lt, channel: c.ch || 'marketplace', id: String(node.campaign_id), name: String(node.description_campaign || node.description || node.campaign_id) }); return; }
    for (const [k, v] of Object.entries(node)) walk(v, { lt: LT.has(k) ? k : c.lt, ch: /^(marketplace|mshops|proximity|mp-)/i.test(k) ? k : c.ch });
  };
  walk(data, {});
  return out.filter(x => x.listing_type && /marketplace/i.test(x.channel));
}
async function listingOptions(b) {
  const acc = (b.account && store.getAccount(b.account)) || anyAcc();
  const cat = String(b.category_id || ''), price = Math.max(1, Math.round(Number(b.price) || 0)) || 10000;
  const [types, camp] = await Promise.all([
    cat ? retry(() => get(acc, `/users/${acc.user_id}/available_listing_types?category_id=${cat}`)).catch(() => null) : null,
    cat ? retry(() => get(acc, `/special_installments/campaigns?category_id=${cat}`)).catch(() => null) : null,
  ]);
  const avail = types && types.ok ? (Array.isArray(types.data) ? types.data : types.data.available || []) : null;
  const ltName = (id) => ((avail || []).find(t => t.id === id) || {}).name || { gold_special: 'Clásica', gold_pro: 'Premium' }[id] || id;
  let plans = camp && camp.ok ? parseCampaigns(camp.data) : [];
  if (avail) plans = plans.filter(p => avail.some(t => t.id === p.listing_type));
  // Si Mercado Libre no devolvió campañas, se muestran los tipos de publicación solos
  if (!plans.length) plans = (avail ? avail.map(t => t.id) : ['gold_special', 'gold_pro']).filter(id => /^gold_(special|pro)$/.test(id)).map(id => ({ listing_type: id, id: 'no-campaign', name: '' }));
  const options = [];
  await pool(plans, 4, async (p) => {
    const tag = p.id && p.id !== 'no-campaign' ? '&tags=' + encodeURIComponent(p.id) : '';
    const r = await retry(() => get(acc, `/sites/MLA/listing_prices?price=${price}&listing_type_id=${p.listing_type}${cat ? '&category_id=' + cat : ''}${tag}`)).catch(() => null);
    const x = r && r.ok ? (Array.isArray(r.data) ? r.data.find(y => y.listing_type_id === p.listing_type) || r.data[0] : r.data) : null;
    const det = (x && x.sale_fee_details) || {};
    options.push({ key: `${p.listing_type}|${p.id}`, id: p.listing_type, campaign: p.id, type_name: (x && x.listing_type_name) || ltName(p.listing_type), name: p.name,
      exposure: (x && x.listing_exposure) || '', fee_total: x ? Math.round(Number(x.sale_fee_amount) || 0) : null,
      pct: Number(det.percentage_fee || 0), meli_pct: Number(det.meli_percentage_fee || 0), financing_pct: Number(det.financing_add_on_fee || 0), fixed: Math.round(Number(det.fixed_fee || 0)),
      error: x ? '' : errText(r || { data: { message: 'sin respuesta' } }) });
  });
  const order = { gold_special: 0, gold_pro: 1 };
  options.sort((a, b) => (order[a.id] ?? 9) - (order[b.id] ?? 9) || (a.fee_total ?? 1e12) - (b.fee_total ?? 1e12));
  if (!options.some(o => o.fee_total != null)) throw new Error('Mercado Libre no devolvió los costos de publicación' + (options[0] && options[0].error ? ': ' + options[0].error : '.'));
  return { account: acc.nickname || String(acc.user_id), price, options, campaigns_ok: !!(camp && camp.ok) };
}

async function publishOne(acc, d, picIdsByAcc) {
  const body = {
    title: String(d.title).slice(0, 60), category_id: d.category_id, price: Math.round(Number(d.price)), currency_id: 'ARS',
    available_quantity: Math.max(1, Math.round(Number(d.stock) || 1)), buying_mode: 'buy_it_now', listing_type_id: d.listing_type || 'gold_special', condition: 'new',
    pictures: [...(picIdsByAcc[acc.user_id] || []).map(id => ({ id })), ...(d.pictures || []).filter(p => /^https?:/.test(p)).map(source => ({ source }))],
    attributes: [...(d.attributes || []).filter(a => a.id && !SPECIAL.has(a.id) && (a.value_id || String(a.value_name || '').trim())).map(a => (a.value_id ? { id: a.id, value_id: String(a.value_id) } : { id: a.id, value_name: String(a.value_name).trim() })),
      ...(d.sku ? [{ id: 'SELLER_SKU', value_name: String(d.sku).trim() }] : []),
      ...(String(d.gtin || '').replace(/\D/g, '') ? [{ id: 'GTIN', value_name: String(d.gtin).replace(/\D/g, '') }] : d.gtin_reason ? [{ id: 'EMPTY_GTIN_REASON', value_id: String(d.gtin_reason) }] : []),
      ...(d.pkg && d.pkg.h > 0 ? [{ id: 'SELLER_PACKAGE_HEIGHT', value_name: `${Math.ceil(d.pkg.h)} cm` }] : []),
      ...(d.pkg && d.pkg.w > 0 ? [{ id: 'SELLER_PACKAGE_WIDTH', value_name: `${Math.ceil(d.pkg.w)} cm` }] : []),
      ...(d.pkg && d.pkg.l > 0 ? [{ id: 'SELLER_PACKAGE_LENGTH', value_name: `${Math.ceil(d.pkg.l)} cm` }] : []),
      ...(d.pkg && d.pkg.g > 0 ? [{ id: 'SELLER_PACKAGE_WEIGHT', value_name: `${Math.ceil(d.pkg.g)} g` }] : [])],
    sale_terms: [...(d.days > 0 ? [{ id: 'MANUFACTURING_TIME', value_name: `${Math.round(d.days)} días` }] : [])],
    shipping: { mode: 'me2', local_pick_up: false, free_shipping: Number(d.price) >= FREE_MIN() },
  };
  if (d.campaign && d.campaign !== 'no-campaign') body.tags = [String(d.campaign)]; // plan de cuotas elegido (ej. 3x_campaign)
  if (d.catalog && d.catalog_product_id) { body.catalog_product_id = d.catalog_product_id; body.catalog_listing = true; }
  let r = await retry(() => post(acc, '/items', body));
  // Algunas categorías nuevas piden "family_name" en vez de título.
  if (!r.ok && /family_name/i.test(errText(r))) { const b2 = { ...body, family_name: body.title }; delete b2.title; r = await retry(() => post(acc, '/items', b2)); }
  if (!r.ok) {
    const t = errText(r);
    const ids = [...t.matchAll(/attributes? \[([^\]]+)\]/gi)].flatMap(m => m[1].split(/,\s*/)).map(x => x.trim().toUpperCase());
    const names = [...new Set(ids)].map(id => ATTR_ES[id] || (d.attrNames && d.attrNames[id]) || id);
    throw new Error(names.length ? `Mercado Libre pide estos datos: ${names.join(', ')}. (Detalle: ${t})` : t);
  }
  const item = r.data;
  let descErr = '';
  if (String(d.description || '').trim()) {
    const dr = await retry(() => post(acc, `/items/${item.id}/description`, { plain_text: String(d.description).slice(0, 50000) }));
    if (!dr.ok) descErr = 'la descripción no se pudo cargar: ' + errText(dr);
  }
  return { id: item.id, link: item.permalink, status: item.status, warning: descErr };
}
async function publish(d) {
  if (!d || !String(d.title || '').trim()) throw new Error('Falta el título.');
  if (!d.category_id) throw new Error('Falta elegir la categoría.');
  if (!(Number(d.price) > 0)) throw new Error('Falta el precio.');
  if (!['now', 'days'].includes(d.delivery)) throw new Error('Elegí si es entrega inmediata o a plazo.');
  if (d.delivery === 'days' && !(Number(d.days) > 0)) throw new Error('Poné cuántos días de plazo.');
  if (d.delivery === 'now') d.days = 0;
  const accIds = [...new Set((d.accounts || []).map(String))];
  if (!accIds.length) throw new Error('Elegí al menos una cuenta.');
  const uploads = (Array.isArray(d.uploads) ? d.uploads : []).slice(0, 10);
  if (!uploads.length && !(d.pictures || []).some(p => /^https?:/.test(p))) throw new Error('Agregá al menos una foto.');
  const results = [];
  for (const id of accIds) {
    const acc = store.getAccount(id);
    if (!acc) { results.push({ account_id: id, ok: false, error: 'La cuenta no está conectada.' }); continue; }
    try {
      // Fotos subidas desde la compu: se suben a cada cuenta.
      const ids = [];
      for (const u of uploads) {
        const m = String(u.data || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
        if (!m) continue;
        const up = await retry(() => ml.upload(acc, '/pictures/items/upload', Buffer.from(m[2], 'base64'), u.name || 'foto.jpg', m[1]));
        if (!up.ok || !up.data.id) throw new Error('Mercado Libre no aceptó una foto: ' + errText(up));
        ids.push(up.data.id);
      }
      const r = await publishOne(acc, d, { [acc.user_id]: ids });
      results.push({ account_id: id, account: acc.nickname, ok: true, ...r });
    } catch (e) { results.push({ account_id: id, account: acc.nickname, ok: false, error: e.message }); }
  }
  // TUYO: si es de Amazon, se guarda el costo de la publicación para el resultado del mes.
  if (d.usd > 0) {
    const t = require('./tuyo');
    for (const r of results) if (r.ok && t.isTuyo(r.account_id)) { try { t.saveItem(r.id, { usd: d.usd, weight: d.weight_kg, unit: 'kg', title: d.title }); } catch { /* nada */ } }
  }
  const log = store.getListings(); log.published = [{ at: new Date().toISOString(), title: d.title, results: results.map(r => ({ account: r.account, ok: r.ok, id: r.id || '', link: r.link || '', status: r.status || '', error: r.error || '' })) }, ...(log.published || [])].slice(0, 50);
  store.saveListings();
  if (results.some(r => r.ok)) require('./listings').sync();
  return { results, published: results.filter(r => r.ok).length };
}

function history() { return (store.getListings().published || []).slice(0, 10); }

module.exports = { listingOptions, history, fromMl, fromAmazon, categories, categoryInfo, breakdown, priceFor, amazonCost, market, publish, parseWeight };
