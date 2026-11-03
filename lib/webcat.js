// Productos de la web (WooCommerce): ver y cambiar categorías en masa, crear categorías y deshacer.
// Usa la clave de WooCommerce de Lectura/Escritura guardada en el panel.
const store = require('./store');
const web = require('./web');

const W = () => store.getWebcat();
const now = () => new Date().toISOString();
const auth = () => {
  const st = store.getSettings();
  if (!st.wc_key || !st.wc_secret) throw new Error('Falta la clave de WooCommerce (Estados de WhatsApp → Configurar web).');
  return `consumer_key=${encodeURIComponent(st.wc_key)}&consumer_secret=${encodeURIComponent(st.wc_secret)}`;
};
async function call(method, path, body) {
  const url = `${web.siteUrl()}/wp-json/wc/v3${path}${path.includes('?') ? '&' : '?'}${auth()}`;
  const r = await fetch(url, { method, headers: { 'user-agent': 'BiogatePanel/1.0', accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
  const text = await r.text();
  let data = null; try { data = JSON.parse(text); } catch { /* no es JSON */ }
  if (!r.ok) {
    const msg = (data && (data.message || data.code)) || `error ${r.status}`;
    if (r.status === 401 || r.status === 403) throw new Error(`La web no dejó hacer el cambio (${msg}). Revisá que la clave sea de Lectura/Escritura.`);
    throw new Error(`La web respondió: ${msg}`);
  }
  return { data, total: Number(r.headers.get('x-wp-totalpages')) || 1 };
}
const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#8211;/g, '–').replace(/&#039;|&#39;/g, "'").replace(/&quot;/g, '"');

async function sync() {
  const cats = [];
  for (let p = 1; p <= 20; p++) {
    const r = await call('GET', `/products/categories?per_page=100&page=${p}&hide_empty=false`);
    for (const c of r.data || []) cats.push({ id: c.id, name: decode(c.name), slug: c.slug, parent: c.parent || 0, count: c.count || 0 });
    if (p >= r.total) break;
  }
  const products = [];
  for (let p = 1; p <= 60; p++) {
    const r = await call('GET', `/products?per_page=100&page=${p}&status=any&_fields=id,name,sku,price,regular_price,status,categories,images,permalink,type`);
    for (const x of r.data || []) if (x.status !== 'trash') products.push({ id: x.id, name: decode(x.name), sku: x.sku || '', price: Number(x.price) || 0, status: x.status, type: x.type, link: x.permalink || '', thumb: (x.images && x.images[0] && (x.images[0].thumbnail || x.images[0].src)) || '', cats: (x.categories || []).map(c => c.id) });
    if (p >= r.total) break;
  }
  Object.assign(W(), { cats, products, at: now() });
  store.saveWebcat();
  return list();
}
function list() { const w = W(); return { cats: w.cats || [], products: w.products || [], at: w.at || null, can_undo: !!(w.log || []).length, last: (w.log || [])[0] ? { at: w.log[0].at, n: w.log[0].items.length, what: w.log[0].what } : null }; }

// Nuevas categorías de cada producto según la acción.
function plan(mode, ids, catId) {
  const cat = Number(catId), set = new Set((ids || []).map(Number));
  if (!['add', 'move', 'remove'].includes(mode)) throw new Error('Acción inválida.');
  if (!(W().cats || []).some(c => c.id === cat)) throw new Error('Elegí una categoría.');
  return (W().products || []).filter(p => set.has(p.id)).map(p => {
    const now2 = mode === 'add' ? [...new Set([...p.cats, cat])] : mode === 'move' ? [cat] : p.cats.filter(c => c !== cat);
    return { id: p.id, before: p.cats, after: now2 };
  }).filter(x => x.before.slice().sort().join() !== x.after.slice().sort().join());
}
// Aplica cambios [{id, after:[catIds]}] en la web (de a 100) y guarda cómo estaban para poder deshacer.
async function applyRaw(changes, what, keepLog = true) {
  const byId = new Map((W().products || []).map(p => [p.id, p]));
  const done = [], failed = [];
  for (let i = 0; i < changes.length; i += 100) {
    const part = changes.slice(i, i + 100);
    try {
      const r = await call('POST', '/products/batch', { update: part.map(x => ({ id: x.id, categories: (x.after.length ? x.after : []).map(id => ({ id })) })) });
      for (const u of (r.data && r.data.update) || []) {
        const x = part.find(y => y.id === u.id);
        if (u.error) { failed.push({ id: u.id, error: u.error.message || u.error.code }); continue; }
        const p = byId.get(u.id); if (p) p.cats = (u.categories || []).map(c => c.id);
        if (x) done.push({ id: x.id, before: x.before });
      }
    } catch (e) { for (const x of part) failed.push({ id: x.id, error: e.message }); }
  }
  if (keepLog && done.length) W().log = [{ at: now(), what, items: done }, ...(W().log || [])].slice(0, 20);
  // Cantidades por categoría
  const cnt = {}; for (const p of W().products || []) for (const c of p.cats) cnt[c] = (cnt[c] || 0) + 1;
  for (const c of W().cats || []) c.count = cnt[c.id] || 0;
  store.saveWebcat();
  return { ok: done.length, failed };
}
async function apply(mode, ids, catId) {
  const changes = plan(mode, ids, catId);
  if (!changes.length) return { ok: 0, failed: [], nothing: true };
  const c = (W().cats || []).find(x => x.id === Number(catId));
  return applyRaw(changes, `${mode === 'add' ? 'Agregó a' : mode === 'move' ? 'Movió a' : 'Quitó de'} "${c ? c.name : catId}" ${changes.length} productos`);
}
// Asignación libre por producto (para las sugerencias de la IA): [{id, cats:[ids]}]
async function assign(list, what) {
  const byId = new Map((W().products || []).map(p => [p.id, p]));
  const changes = (Array.isArray(list) ? list : []).map(x => ({ id: Number(x.id), after: [...new Set((x.cats || []).map(Number))].filter(id => (W().cats || []).some(c => c.id === id)), before: (byId.get(Number(x.id)) || {}).cats || [] }))
    .filter(x => byId.has(x.id) && x.after.length && x.before.slice().sort().join() !== x.after.slice().sort().join());
  if (!changes.length) return { ok: 0, failed: [], nothing: true };
  return applyRaw(changes, what || `Recategorizó ${changes.length} productos`);
}
async function undo() {
  const last = (W().log || [])[0];
  if (!last) throw new Error('No hay cambios para deshacer.');
  const r = await applyRaw(last.items.map(x => ({ id: x.id, after: x.before, before: [] })), 'Deshacer', false);
  if (r.ok) W().log.shift();
  store.saveWebcat();
  return r;
}
async function createCat(name, parent) {
  name = String(name || '').trim().slice(0, 80);
  if (!name) throw new Error('Poné el nombre de la categoría.');
  const r = await call('POST', '/products/categories', { name, ...(Number(parent) ? { parent: Number(parent) } : {}) });
  const c = { id: r.data.id, name: decode(r.data.name), slug: r.data.slug, parent: r.data.parent || 0, count: 0 };
  W().cats = [...(W().cats || []), c];
  store.saveWebcat();
  return c;
}
async function renameCat(id, name) {
  name = String(name || '').trim().slice(0, 80);
  if (!name) throw new Error('Poné el nombre.');
  const r = await call('PUT', `/products/categories/${Number(id)}`, { name });
  const c = (W().cats || []).find(x => x.id === Number(id)); if (c) c.name = decode(r.data.name);
  store.saveWebcat();
  return c;
}

// Sugerencia con IA: para cada producto, la categoría (o dos) que mejor le queda entre las existentes.
async function suggest(ids) {
  const ai = require('./ai');
  const cats = W().cats || [], byId = new Map(cats.map(c => [c.id, c]));
  const path = (c) => { const out = []; let x = c; for (let i = 0; x && i < 5; i++) { out.unshift(x.name); x = byId.get(x.parent); } return out.join(' > '); };
  const set = new Set((ids || []).map(Number));
  const prods = (W().products || []).filter(p => set.has(p.id)).slice(0, 200);
  const catList = cats.filter(c => !/^(uncategorized|sin categorizar|sin categoría)$/i.test(c.name)).map(c => `${c.id}: ${path(c)}`).join('\n');
  const out = {};
  for (let i = 0; i < prods.length; i += 40) {
    const part = prods.slice(i, i + 40);
    const r = await ai.categorize(catList, part.map(p => `${p.id}: ${p.name}`).join('\n'));
    for (const x of r) if (set.has(Number(x.id))) out[x.id] = (x.cats || []).map(Number).filter(id => byId.has(id)).slice(0, 2);
  }
  return out;
}

module.exports = { sync, list, plan, apply, assign, undo, createCat, renameCat, suggest };
