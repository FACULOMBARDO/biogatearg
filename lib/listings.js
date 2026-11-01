// Mis publicaciones: todas las publicaciones de todas las cuentas de Mercado Libre, con cambios de precio,
// stock, estado, descuentos (propios y campañas de ML), calidad, ficha técnica y fotos.
// Todos los cambios quedan anotados para poder deshacer el último.
const store = require('./store');
const ml = require('./ml');
const { get, put, post, del, pick } = ml;

const L = () => store.getListings();
const items = () => L().items || (L().items = {});
const now = () => new Date().toISOString();
const PV = 'app_version=v2';

async function pool(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; await fn(list[k], k); } }));
}
async function retry(fn) {
  let r = null;
  for (let i = 0; i < 4; i++) {
    r = await fn().catch(e => ({ ok: false, status: 0, data: { message: e.message } }));
    if (r.ok || (r.status && r.status !== 429 && r.status < 500)) return r;
    await new Promise(ok => setTimeout(ok, 800 * 2 ** i));
  }
  return r;
}
const errText = (r) => {
  const d = (r && r.data) || {};
  const cause = Array.isArray(d.cause) ? d.cause.map(c => c.message || c.code || c).filter(Boolean).join(' · ') : '';
  return [d.message || d.error, cause].filter(Boolean).join(' — ') || 'error ' + (r && r.status);
};
const accOf = (id) => { const a = store.getAccount(String(id)); if (!a) throw new Error('Esa cuenta ya no está conectada.'); return a; };

// ---------- Lectura ----------
const FIELDS = 'id,title,price,original_price,base_price,currency_id,available_quantity,sold_quantity,status,sub_status,thumbnail,secure_thumbnail,permalink,listing_type_id,shipping,seller_custom_field,attributes,variations,catalog_listing,category_id,health,sale_terms,pictures,date_created,last_updated';
function slim(acc, b) {
  const attr = (id) => ((b.attributes || []).find(a => a.id === id) || {}).value_name || '';
  const mt = (b.sale_terms || []).find(t => t.id === 'MANUFACTURING_TIME');
  const vars = (b.variations || []).map(v => ({
    id: String(v.id), price: v.price, stock: v.available_quantity, sold: v.sold_quantity || 0,
    name: (v.attribute_combinations || []).map(c => c.value_name).filter(Boolean).join(' / '),
    sku: ((v.attributes || []).find(a => a.id === 'SELLER_SKU') || {}).value_name || v.seller_custom_field || '',
  }));
  return {
    id: b.id, account_id: String(acc.user_id), account: acc.nickname || String(acc.user_id),
    title: b.title || '', price: b.price || 0, original_price: b.original_price || null,
    stock: b.available_quantity ?? 0, sold: b.sold_quantity || 0, status: b.status || '', sub_status: [].concat(b.sub_status || []),
    thumb: b.secure_thumbnail || b.thumbnail || '', link: b.permalink || '', listing_type: b.listing_type_id || '',
    logistic: pick(b.shipping?.logistic_type), free_ship: !!b.shipping?.free_shipping,
    sku: attr('SELLER_SKU') || b.seller_custom_field || vars.map(v => v.sku).find(Boolean) || '',
    brand: attr('BRAND'), category_id: b.category_id || '', catalog: !!b.catalog_listing,
    health: typeof b.health === 'number' ? b.health : null, pictures: (b.pictures || []).length,
    manufacturing: mt ? (mt.value_name || '') : '', variations: vars, updated: b.last_updated || '', at: now(),
  };
}
async function itemIds(acc, status) {
  const ids = [];
  let scroll = '';
  for (let i = 0; i < 300; i++) {
    const r = await retry(() => get(acc, `/users/${acc.user_id}/items/search?status=${status}&search_type=scan&limit=100${scroll ? '&scroll_id=' + encodeURIComponent(scroll) : ''}`));
    if (!r.ok) throw new Error(errText(r));
    const res = r.data.results || [];
    ids.push(...res);
    scroll = r.data.scroll_id;
    if (!res.length || !scroll) break;
  }
  return ids;
}
async function fetchItems(acc, ids) {
  const out = [];
  const chunks = [];
  for (let i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20));
  await pool(chunks, 3, async (ch) => {
    const r = await retry(() => get(acc, `/items?ids=${ch.join(',')}&attributes=${FIELDS}`));
    for (const x of (r && r.ok && Array.isArray(r.data) ? r.data : [])) if (x.code === 200 && x.body) out.push(slim(acc, x.body));
  });
  return out;
}

let job = { running: false };
function status() { return { ...job }; }
function sync() {
  if (job.running) return false;
  job = { running: true, started_at: now(), done: 0, total: store.getAccounts().length, errors: [] };
  require('./bg').bg((async () => {
    const fresh = {};
    const okAccs = new Set();
    await pool(store.getAccounts(), 2, async (acc) => {
      try {
        if (acc.needs_reconnect) throw new Error('hay que volver a conectar la cuenta');
        const ids = [...await itemIds(acc, 'active'), ...await itemIds(acc, 'paused')];
        for (const it of await fetchItems(acc, [...new Set(ids)])) fresh[it.id] = it;
        okAccs.add(String(acc.user_id));
      } catch (e) { job.errors.push(`${acc.nickname || acc.user_id}: ${e.message}`); }
      job.done++;
    });
    // Se reemplazan las de las cuentas que se pudieron leer; las de cuentas con error quedan como estaban.
    for (const [id, it] of Object.entries(items())) if (okAccs.has(it.account_id) && !fresh[id]) delete items()[id];
    Object.assign(items(), fresh);
    L().updated_at = now(); L().errors = job.errors;
    store.saveListings();
    job.running = false; job.finished_at = now();
  })().catch(e => { job.running = false; job.errors.push(e.message); }));
  return true;
}
function list() {
  const q = store.getQuality().items || {};
  return {
    items: Object.values(items()).map(it => ({ ...it, quality: q[it.id] ? { health: q[it.id].health, goals: q[it.id].goals } : null })),
    updated_at: L().updated_at || null, errors: L().errors || [], job: status(), can_undo: !!(L().log || []).length,
    last_change: (L().log || [])[0] ? { at: L().log[0].at, n: L().log[0].changes.length } : null,
  };
}
async function refreshOne(acc, id) {
  const r = await retry(() => get(acc, `/items/${id}?attributes=${FIELDS}`));
  if (r && r.ok) items()[id] = slim(acc, r.data);
  return items()[id];
}

// ---------- Cambios de precio, stock y estado ----------
// changes: [{ account_id, item_id, price?, stock?, status?, variation_id? }]
async function apply(changes, by, isUndo) {
  if (!Array.isArray(changes) || !changes.length) throw new Error('No hay cambios para guardar.');
  if (changes.length > 300) throw new Error('Máximo 300 cambios por vez.');
  const byItem = {};
  for (const c of changes) {
    const k = String(c.account_id) + '|' + String(c.item_id);
    (byItem[k] = byItem[k] || []).push(c);
  }
  const results = [], log = [];
  await pool(Object.entries(byItem), 4, async ([k, list]) => {
    const [accId, itemId] = k.split('|');
    try {
      const acc = accOf(accId);
      const cur = items()[itemId] || await refreshOne(acc, itemId);
      if (!cur) throw new Error('No encontré la publicación.');
      const body = {}, notes = [];
      for (const c of list) {
        if (c.price !== undefined && c.price !== null && c.price !== '') {
          const p = Math.round(Number(c.price));
          if (!(p > 0)) throw new Error('Precio inválido.');
          if (cur.variations.length) body.variations = (body.variations || cur.variations.map(v => ({ id: Number(v.id) }))).map(v => ({ ...v, price: p }));
          else body.price = p;
          notes.push({ field: 'price', from: cur.price, to: p });
        }
        if (c.stock !== undefined && c.stock !== null && c.stock !== '') {
          if (cur.logistic === 'fulfillment') throw new Error('Es Full: el stock lo maneja Mercado Libre.');
          const q = Math.max(0, Math.round(Number(c.stock)));
          if (cur.variations.length) {
            const vid = String(c.variation_id || '');
            if (!vid && cur.variations.length > 1) throw new Error('Tiene variantes: cambiá el stock de cada variante.');
            const target = vid || cur.variations[0].id;
            body.variations = (body.variations || cur.variations.map(v => ({ id: Number(v.id) }))).map(v => String(v.id) === String(target) ? { ...v, available_quantity: q } : v);
            notes.push({ field: 'stock', variation_id: target, from: (cur.variations.find(v => v.id === String(target)) || {}).stock, to: q });
          } else { body.available_quantity = q; notes.push({ field: 'stock', from: cur.stock, to: q }); }
        }
        if (c.status && ['active', 'paused'].includes(c.status)) { body.status = c.status; notes.push({ field: 'status', from: cur.status, to: c.status }); }
      }
      if (!Object.keys(body).length) throw new Error('Nada para cambiar.');
      const r = await retry(() => put(acc, `/items/${itemId}`, body));
      if (!r.ok) throw new Error(errText(r));
      await refreshOne(acc, itemId);
      for (const n of notes) log.push({ account_id: accId, item_id: itemId, title: cur.title, ...n });
      results.push({ item_id: itemId, account_id: accId, ok: true });
    } catch (e) { results.push({ item_id: itemId, account_id: accId, ok: false, error: e.message }); }
  });
  if (log.length && !isUndo) { L().log = [{ at: now(), by: String(by || '').slice(0, 40), changes: log }, ...(L().log || [])].slice(0, 30); }
  store.saveListings();
  return { results, ok: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok) };
}
// Deshace el último lote de cambios (vuelve precio, stock y estado a como estaban).
async function undo(by) {
  const last = (L().log || [])[0];
  if (!last) throw new Error('No hay cambios para deshacer.');
  const back = last.changes.map(c => ({ account_id: c.account_id, item_id: c.item_id, variation_id: c.variation_id, [c.field]: c.from }))
;
  const r = await apply(back, by, true);
  if (r.ok) L().log.shift();
  store.saveListings();
  return r;
}

// ---------- Descuentos y campañas (API de promociones de ML) ----------
const PROMO = { PRICE_DISCOUNT: 'Descuento tuyo', DEAL: 'Campaña de ML', MARKETPLACE_CAMPAIGN: 'Campaña de ML', SELLER_CAMPAIGN: 'Campaña tuya', SMART: 'Campaña automatizada (co-fondeada)', PRICE_MATCHING: 'Precio competitivo', PRICE_MATCHING_MELI_ALL: 'Precio competitivo', UNHEALTHY_STOCK: 'Liquidación de stock', LIGHTNING: 'Oferta relámpago', DOD: 'Oferta del día', VOLUME: 'Descuento por cantidad', PRE_NEGOTIATED: 'Campaña negociada' };
async function itemPromos(accountId, itemId) {
  const acc = accOf(accountId);
  const r = await retry(() => get(acc, `/seller-promotions/items/${itemId}?${PV}`));
  if (!r.ok && r.status !== 404) throw new Error(errText(r));
  const list = r.ok && Array.isArray(r.data) ? r.data : [];
  return list.map(p => ({
    id: p.id || '', type: p.type, type_label: PROMO[p.type] || p.type, name: p.name || '', status: p.status,
    start: p.start_date || '', finish: p.finish_date || '', price: p.price || null, original_price: p.original_price || null,
    min_price: p.min_discounted_price || null, max_price: p.max_discounted_price || null, suggested: p.suggested_discounted_price || null,
    meli_pct: p.meli_percentage ?? null, seller_pct: p.seller_percentage ?? null,
    offers: (p.offers || []).map(o => ({ id: o.id, price: o.new_price || o.price, status: o.status, meli_pct: o.meli_percent ?? o.meli_percentage ?? null })),
  }));
}
const day = (d, end) => `${String(d).slice(0, 10)}T${end ? '23:59:59' : '00:00:00'}`;
// Crea tu propio descuento (deal_price = precio con descuento).
async function ownDiscount(list, pct, from, to) {
  pct = Number(pct);
  if (!(pct >= 5 && pct <= 80)) throw new Error('El descuento tiene que ser entre 5% y 80%.');
  if (!from || !to || to < from) throw new Error('Elegí desde y hasta cuándo.');
  const results = [];
  await pool(list, 4, async (x) => {
    try {
      const acc = accOf(x.account_id), cur = items()[x.item_id] || await refreshOne(acc, x.item_id);
      const base = cur.original_price || cur.price;
      const deal = Math.round(base * (1 - pct / 100));
      const r = await retry(() => post(acc, `/seller-promotions/items/${x.item_id}?${PV}`, { promotion_type: 'PRICE_DISCOUNT', deal_price: deal, start_date: day(from), finish_date: day(to, true) }));
      if (!r.ok) throw new Error(errText(r));
      await refreshOne(acc, x.item_id);
      results.push({ item_id: x.item_id, ok: true, deal });
    } catch (e) { results.push({ item_id: x.item_id, ok: false, error: e.message }); }
  });
  store.saveListings();
  return { results, ok: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok) };
}
// Sumar una publicación a una campaña de ML (con precio o con la oferta que propone ML).
async function joinPromo(accountId, itemId, b) {
  const acc = accOf(accountId);
  const body = { promotion_id: b.promotion_id, promotion_type: b.promotion_type };
  if (b.offer_id) body.offer_id = b.offer_id;
  if (b.deal_price) body.deal_price = Math.round(Number(b.deal_price));
  const r = await retry(() => post(acc, `/seller-promotions/items/${itemId}?${PV}`, body));
  if (!r.ok) throw new Error(errText(r));
  await refreshOne(acc, itemId); store.saveListings();
  return true;
}
async function leavePromo(accountId, itemId, type, promoId) {
  const acc = accOf(accountId);
  const r = await retry(() => del(acc, `/seller-promotions/items/${itemId}?promotion_type=${encodeURIComponent(type)}${promoId ? '&promotion_id=' + encodeURIComponent(promoId) : ''}&${PV}`));
  if (!r.ok) throw new Error(errText(r));
  await refreshOne(acc, itemId); store.saveListings();
  return true;
}
// Campañas disponibles de cada cuenta.
async function campaigns(accountIds) {
  const out = [], errors = [];
  const accs = store.getAccounts().filter(a => !accountIds || !accountIds.length || accountIds.includes(String(a.user_id)));
  await pool(accs, 3, async (acc) => {
    const r = await retry(() => get(acc, `/seller-promotions/users/${acc.user_id}?${PV}`));
    if (!r.ok) { errors.push(`${acc.nickname}: ${errText(r)}`); return; }
    for (const p of (r.data.results || [])) out.push({ account_id: String(acc.user_id), account: acc.nickname, id: p.id, type: p.type, type_label: PROMO[p.type] || p.type, name: p.name || PROMO[p.type] || p.type, status: p.status, start: p.start_date || '', finish: p.finish_date || '', deadline: p.deadline_date || '', benefits: p.benefits || null });
  });
  out.sort((a, b) => String(a.finish).localeCompare(String(b.finish)));
  return { items: out, errors };
}
// Publicaciones candidatas de una campaña (que podés sumar).
async function campaignItems(accountId, promoId, type) {
  const acc = accOf(accountId), out = [];
  let searchAfter = '';
  for (let i = 0; i < 20; i++) {
    const r = await retry(() => get(acc, `/seller-promotions/promotions/${encodeURIComponent(promoId)}/items?promotion_type=${encodeURIComponent(type)}&${PV}&limit=50${searchAfter ? '&search_after=' + encodeURIComponent(searchAfter) : ''}`));
    if (!r.ok) throw new Error(errText(r));
    for (const x of r.data.results || []) {
      const it = items()[x.id] || {};
      out.push({ id: x.id, title: it.title || x.id, thumb: it.thumb || '', status: x.status, price: x.price || null, original_price: x.original_price || it.price || null, min_price: x.min_discounted_price || null, max_price: x.max_discounted_price || null, suggested: x.suggested_discounted_price || null, offer_id: x.offer_id || (x.offers && x.offers[0] && x.offers[0].id) || null, meli_pct: x.meli_percentage ?? null });
    }
    searchAfter = r.data.paging && r.data.paging.searchAfter;
    if (!searchAfter || !(r.data.results || []).length) break;
  }
  return out;
}

// ---------- Calidad, ficha técnica y fotos ----------
const attrCache = new Map();
async function categoryAttrs(acc, cat) {
  const hit = attrCache.get(cat);
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.list;
  const r = await retry(() => get(acc, `/categories/${cat}/attributes`));
  const list = r && r.ok && Array.isArray(r.data) ? r.data : [];
  attrCache.set(cat, { at: Date.now(), list });
  return list;
}
async function detail(accountId, itemId) {
  const acc = accOf(accountId);
  const [it, h, d] = await Promise.all([
    retry(() => get(acc, `/items/${itemId}?include_attributes=all`)),
    retry(() => get(acc, `/items/${itemId}/health`)),
    retry(() => get(acc, `/items/${itemId}/description`)),
  ]);
  if (!it || !it.ok) throw new Error(errText(it));
  const b = it.data;
  items()[itemId] = slim(acc, b);
  const have = new Map((b.attributes || []).filter(a => a.value_name || a.value_id).map(a => [a.id, a.value_name]));
  const cat = await categoryAttrs(acc, b.category_id);
  const SKIP = new Set(['SELLER_SKU', 'ITEM_CONDITION']);
  const missing = cat.filter(a => !SKIP.has(a.id) && !have.has(a.id) && !(a.tags && (a.tags.read_only || a.tags.hidden || a.tags.fixed || a.tags.inferred || a.tags.others)))
    .map(a => ({ id: a.id, name: a.name, required: !!(a.tags && (a.tags.required || a.tags.catalog_required || a.tags.conditional_required)), type: a.value_type, unit: a.default_unit || '', units: (a.allowed_units || []).map(u => u.name), values: (a.values || []).slice(0, 200).map(v => ({ id: v.id, name: v.name })), hint: a.hint || a.tooltip || '' }))
    .sort((x, y) => (y.required - x.required) || x.name.localeCompare(y.name));
  const goals = h && h.ok ? (h.data.goals || []).filter(g => g.apply !== false && Number(g.progress ?? 0) < Number(g.progress_max ?? 1)).map(g => g.id) : [];
  const pics = (b.pictures || []).map(p => {
    const [w, hh] = String(p.max_size || p.size || '').split('x').map(Number);
    return { id: p.id, url: p.secure_url || p.url, size: p.max_size || p.size || '', small: !!(w && hh && Math.max(w, hh) < 1200) };
  });
  return {
    item: items()[itemId], health: h && h.ok ? Number(h.data.health) : null, level: h && h.ok ? h.data.level || '' : '', goals,
    missing, filled: [...have.entries()].map(([id, v]) => ({ id, name: ((cat.find(a => a.id === id) || {}).name) || id, value: v })),
    pictures: pics, description: d && d.ok ? (d.data.plain_text || '') : '', title: b.title, can_edit_title: !(b.sold_quantity > 0),
  };
}
// Mismo producto en otras cuentas (por SKU o, si no tiene, por título igual).
function twins(itemId) {
  const it = items()[itemId];
  if (!it) return [];
  const norm = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');
  return Object.values(items()).filter(x => x.id !== itemId && x.account_id !== it.account_id && (it.sku ? norm(x.sku) === norm(it.sku) : norm(x.title) === norm(it.title)));
}
// Completa la ficha técnica (y opcionalmente en las mismas publicaciones de otras cuentas).
async function saveAttrs(accountId, itemId, attrs, alsoTwins) {
  const clean = (Array.isArray(attrs) ? attrs : []).filter(a => a && a.id && (a.value_id || String(a.value_name || '').trim()))
    .map(a => (a.value_id ? { id: a.id, value_id: String(a.value_id) } : { id: a.id, value_name: String(a.value_name).trim().slice(0, 255) }));
  if (!clean.length) throw new Error('No completaste ningún dato.');
  const targets = [{ account_id: accountId, item_id: itemId }, ...(alsoTwins ? twins(itemId).map(t => ({ account_id: t.account_id, item_id: t.id })) : [])];
  const results = [];
  await pool(targets, 3, async (t) => {
    try {
      const acc = accOf(t.account_id);
      const r = await retry(() => put(acc, `/items/${t.item_id}`, { attributes: clean }));
      if (!r.ok) throw new Error(errText(r));
      await refreshOne(acc, t.item_id);
      results.push({ item_id: t.item_id, account: acc.nickname, ok: true });
    } catch (e) { results.push({ item_id: t.item_id, ok: false, error: e.message }); }
  });
  store.saveListings();
  return { results, ok: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok) };
}
async function saveDescription(accountId, itemId, text, alsoTwins) {
  text = String(text || '').trim();
  if (text.length < 20) throw new Error('La descripción es muy corta.');
  const targets = [{ account_id: accountId, item_id: itemId }, ...(alsoTwins ? twins(itemId).map(t => ({ account_id: t.account_id, item_id: t.id })) : [])];
  const results = [];
  for (const t of targets) {
    try {
      const acc = accOf(t.account_id);
      const r = await retry(() => put(acc, `/items/${t.item_id}/description?api_version=2`, { plain_text: text.slice(0, 50000) }));
      if (!r.ok) throw new Error(errText(r));
      results.push({ item_id: t.item_id, ok: true });
    } catch (e) { results.push({ item_id: t.item_id, ok: false, error: e.message }); }
  }
  return { results, ok: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok) };
}
// Fotos: orden nuevo (ids de fotos que ya están) + fotos nuevas subidas (base64).
async function savePictures(accountId, itemId, keepIds, uploads, alsoTwins) {
  const acc = accOf(accountId);
  const newIds = [];
  for (const u of (Array.isArray(uploads) ? uploads : []).slice(0, 10)) {
    const m = String(u.data || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) throw new Error('Formato de foto no válido (usá JPG o PNG).');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 10e6) throw new Error('Cada foto puede pesar hasta 10 MB.');
    const r = await retry(() => ml.upload(acc, '/pictures/items/upload', buf, u.name || 'foto.jpg', m[1]));
    if (!r.ok || !r.data.id) throw new Error('Mercado Libre no aceptó la foto: ' + errText(r));
    newIds.push({ ref: u.ref, id: r.data.id });
  }
  // keepIds puede tener "new:<ref>" para ubicar las nuevas en el orden elegido
  const order = (Array.isArray(keepIds) ? keepIds : []).map(k => (String(k).startsWith('new:') ? (newIds.find(n => 'new:' + n.ref === k) || {}).id : k)).filter(Boolean);
  for (const n of newIds) if (!order.includes(n.id)) order.push(n.id);
  if (!order.length) throw new Error('La publicación tiene que tener al menos una foto.');
  const targets = [{ account_id: accountId, item_id: itemId }, ...(alsoTwins ? twins(itemId).map(t => ({ account_id: t.account_id, item_id: t.id })) : [])];
  const results = [];
  for (const t of targets) {
    try {
      const a = accOf(t.account_id);
      // En otras cuentas se usan las mismas fotos por su link (las fotos de ML son públicas).
      let pics = order.map(id => ({ id }));
      if (t.item_id !== itemId) {
        const d = await retry(() => get(acc, `/items/${itemId}`));
        const urls = new Map(((d && d.ok && d.data.pictures) || []).map(p => [p.id, p.secure_url || p.url]));
        pics = order.map(id => (urls.get(id) ? { source: urls.get(id) } : { id }));
      }
      const r = await retry(() => put(a, `/items/${t.item_id}`, { pictures: pics }));
      if (!r.ok) throw new Error(errText(r));
      await refreshOne(a, t.item_id);
      results.push({ item_id: t.item_id, ok: true });
    } catch (e) { results.push({ item_id: t.item_id, ok: false, error: e.message }); }
  }
  store.saveListings();
  return { results, ok: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok) };
}

// ---------- Acciones rápidas ----------
// Flex en una publicación (la cuenta tiene que tener Flex habilitado en Mercado Libre).
async function flexEnabled(acc) {
  const r = await retry(() => get(acc, `/users/${acc.user_id}/shipping_preferences`));
  if (!r || !r.ok) return null;
  const types = [].concat(...(r.data.logistics || []).map(l => l.types || []));
  const ss = types.find(t => t.type === 'self_service');
  return ss ? ss.status === 'active' : false;
}
async function setFlex(accountId, itemId, on) {
  const acc = accOf(accountId);
  const path = `/sites/MLA/shipping/selfservice/items/${itemId}`;
  const r = await retry(() => (on ? post(acc, path, {}) : del(acc, path)));
  if (!r.ok) {
    const t = errText(r), enabled = await flexEnabled(acc).catch(() => null);
    const manual = `Activalo a mano en Mercado Libre: Mis publicaciones → la publicación → Modificar → Forma de entrega → tildá "Mercado Envíos Flex" y guardá.`;
    if (enabled === false) throw new Error(`La cuenta ${acc.nickname} no tiene Flex habilitado. Primero activalo en Mercado Libre (Ventas → Preferencias de envío → Mercado Envíos Flex, cargando tus zonas y horarios); después este botón funciona.`);
    if (enabled === true && r.status === 403) throw new Error(`La cuenta ${acc.nickname} sí tiene Flex, pero Mercado Libre no deja que el panel lo active en las publicaciones (es una función reservada a aplicaciones autorizadas por ML). ${manual}`);
    throw new Error(`Mercado Libre no dejó ${on ? 'activar' : 'desactivar'} Flex (${t}). ${manual}`);
  }
  await refreshOne(acc, itemId); store.saveListings();
  return { flex: on };
}
// Pasar a Premium (cuotas sin interés). Mercado Libre no deja volver a Clásica si ya tiene ventas.
async function setPremium(accountId, itemId) {
  const acc = accOf(accountId);
  const r = await retry(() => post(acc, `/items/${itemId}/listing_type`, { id: 'gold_pro' }));
  if (!r.ok) throw new Error('Mercado Libre no dejó cambiar a Premium: ' + errText(r));
  await refreshOne(acc, itemId); store.saveListings();
  return { listing_type: 'gold_pro' };
}

module.exports = { setFlex, setPremium, categoryAttrs, sync, status, list, apply, undo, itemPromos, ownDiscount, joinPromo, leavePromo, campaigns, campaignItems, detail, twins, saveAttrs, saveDescription, savePictures };
