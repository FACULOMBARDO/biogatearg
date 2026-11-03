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
    const err = new Error(`La web respondió: ${msg}`); err.data = data; throw err;
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
  let r;
  try { r = await call('POST', '/products/categories', { name, ...(Number(parent) ? { parent: Number(parent) } : {}) }); }
  catch (e) {
    // Ya existe en la web (por ejemplo con otra mayúscula o acento): usamos esa.
    const id = e.data && e.data.code === 'term_exists' && e.data.data && (e.data.data.resource_id || e.data.data.term_id);
    if (!id) throw e;
    r = await call('GET', `/products/categories/${Number(id)}`);
    if ((W().cats || []).some(c => c.id === r.data.id)) return (W().cats || []).find(c => c.id === r.data.id);
  }
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


// ---------- Importar categorías desde un Excel ----------
// rows: [{cat, sub, name, sku}] (cat = categoría principal, sub = subcategoría opcional).
// Cada producto queda con las categorías del Excel (la principal y la subcategoría). Los que no están en el Excel no se tocan.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const toks = (s) => new Set(norm(s).split(' ').filter(t => t.length > 1));
function sim(a, b) { const A = toks(a), B = toks(b); if (!A.size || !B.size) return 0; let n = 0; for (const t of A) if (B.has(t)) n++; return n / Math.max(A.size, B.size); }

function cleanRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(r => ({ cat: String(r.cat || '').trim().slice(0, 80), sub: String(r.sub || '').trim().slice(0, 80), name: String(r.name || '').trim().slice(0, 200), sku: String(r.sku ?? '').trim().slice(0, 60) }))
    .filter(r => r.cat && (r.name || r.sku)).slice(0, 5000);
}
// Busca la categoría en la web: principal (sin padre) o subcategoría dentro de la principal.
function findCat(name, parentId) {
  const n = norm(name), cats = W().cats || [];
  if (parentId != null) return cats.find(c => c.parent === parentId && norm(c.name) === n) || null;
  return cats.find(c => !c.parent && norm(c.name) === n) || null;
}
function matchProducts(rows) {
  const prods = (W().products || []).filter(p => p.status !== 'trash');
  const bySku = new Map(); for (const p of prods) if (p.sku) { const k = norm(p.sku); bySku.set(k, [...(bySku.get(k) || []), p]); }
  const byName = new Map(); for (const p of prods) { const k = norm(p.name); byName.set(k, [...(byName.get(k) || []), p]); }
  // SKUs que en el Excel se repiten con nombres distintos: ahí manda el nombre.
  const skuNames = new Map(); for (const r of rows) if (r.sku) { const k = norm(r.sku); skuNames.set(k, new Set([...(skuNames.get(k) || []), norm(r.name)])); }
  const cache = new Map();
  return rows.map(r => {
    const key = norm(r.sku) + '|' + norm(r.name);
    if (cache.has(key)) return { ...r, ...cache.get(key) };
    let ps = [], how = '';
    const ks = norm(r.sku), shared = ks && (skuNames.get(ks) || new Set()).size > 1;
    const bn = byName.get(norm(r.name)) || [];
    const bs = ks ? bySku.get(ks) || [] : [];
    const both = bs.filter(x => norm(x.name) === norm(r.name)); // mismo SKU y mismo nombre (ej.: el mismo producto en dos colores)
    if (!shared && bs.length === 1) { ps = bs; how = 'sku'; }
    else if (both.length) { ps = both; how = 'sku'; }
    else if (bn.length === 1) { ps = bn; how = 'nombre'; }
    else if (bs.length === 1) { ps = bs; how = 'sku'; }
    else {
      const pool = bs.length > 1 ? bs : prods;
      let best = null, b1 = 0, b2 = 0;
      for (const x of pool) { const v = sim(r.name, x.name); if (v > b1) { b2 = b1; b1 = v; best = x; } else if (v > b2) b2 = v; }
      if (best && b1 >= 0.6 && b1 - b2 >= 0.1) { ps = [best]; how = 'parecido'; }
    }
    const out = { pids: ps.map(x => x.id), how };
    cache.set(key, out);
    return { ...r, ...out };
  });
}
// Plan sin tocar la web: categorías a crear, productos que cambian y filas que no se encontraron.
function importPlan(rowsIn) {
  const rows = cleanRows(rowsIn);
  if (!rows.length) throw new Error('No encontré filas con categoría y producto en el Excel.');
  if (!(W().products || []).length) throw new Error('Primero tocá "Actualizar desde la web" para traer los productos.');
  const create = [], seen = new Set();
  for (const r of rows) {
    const parent = findCat(r.cat, null);
    if (!parent && !seen.has(norm(r.cat))) { seen.add(norm(r.cat)); create.push({ name: r.cat, parent: '' }); }
    if (r.sub) { const k = norm(r.cat) + '>' + norm(r.sub); if (!seen.has(k) && !(parent && findCat(r.sub, parent.id))) { seen.add(k); create.push({ name: r.sub, parent: r.cat }); } }
  }
  const matched = matchProducts(rows);
  const target = new Map();
  for (const r of matched) for (const pid of r.pids) { const t = target.get(pid) || { names: new Set(), how: new Set(), rows: new Set() }; t.names.add(r.cat); if (r.sub) t.names.add(r.cat + ' > ' + r.sub); t.how.add(r.how); t.rows.add(r.name); target.set(pid, t); }
  const byId = new Map((W().products || []).map(p => [p.id, p])), cById = new Map((W().cats || []).map(c => [c.id, c]));
  const cname = (id) => { const c = cById.get(id); if (!c) return String(id); const pa = c.parent && cById.get(c.parent); return pa ? `${pa.name} > ${c.name}` : c.name; };
  const products = [...target].map(([id, t]) => { const p = byId.get(id); return { id, name: p.name, sku: p.sku, before: p.cats.map(cname), after: [...t.names].sort(), how: [...t.how].includes('parecido') ? 'parecido' : [...t.how][0], excel: [...t.rows].slice(0, 3) }; })
    .map(x => ({ ...x, same: x.before.slice().sort().join('|') === x.after.join('|') }));
  const unmatched = []; const um = new Set();
  for (const r of matched) if (!r.pids.length && !um.has(norm(r.sku) + '|' + norm(r.name))) { um.add(norm(r.sku) + '|' + norm(r.name)); unmatched.push({ name: r.name, sku: r.sku, cat: r.cat + (r.sub ? ' > ' + r.sub : '') }); }
  const untouched = (W().products || []).filter(p => !target.has(p.id)).map(p => ({ id: p.id, name: p.name, sku: p.sku, status: p.status }));
  return { create, products, unmatched, untouched, rows: rows.length };
}
// Crea las categorías que faltan y aplica. Si se corta por tiempo, se vuelve a tocar y sigue.
async function importApply(rowsIn, skip) {
  const bgm = require('./bg');
  const end = bgm.deadline(bgm.onVercel ? 240e3 : undefined);
  const rows = cleanRows(rowsIn); const skipSet = new Set((skip || []).map(Number));
  const created = [];
  for (const c of importPlan(rows).create.filter(c => !c.parent)) created.push(await createCat(c.name, 0));
  for (const c of importPlan(rows).create.filter(c => c.parent)) { const pa = findCat(c.parent, null); if (pa) created.push(await createCat(c.name, pa.id)); }
  const matched = matchProducts(rows), want = new Map();
  for (const r of matched) {
    const pa = findCat(r.cat, null); if (!pa) continue;
    const sc = r.sub ? findCat(r.sub, pa.id) : null;
    for (const pid of r.pids) {
      if (skipSet.has(pid)) continue;
      const s = want.get(pid) || new Set(); s.add(pa.id); if (sc) s.add(sc.id);
      want.set(pid, s);
    }
  }
  const byId = new Map((W().products || []).map(p => [p.id, p]));
  const changes = [...want].map(([id, s]) => ({ id, before: byId.get(id).cats, after: [...s] })).filter(x => x.before.slice().sort().join() !== x.after.slice().sort().join());
  let done = 0; const failed = []; let cut = false; const logItems = [];
  for (let i = 0; i < changes.length; i += 50) {
    if (Date.now() > end) { cut = true; break; }
    const part = changes.slice(i, i + 50);
    const r = await applyRaw(part, 'Importar', false);
    done += r.ok; failed.push(...r.failed);
    const bad = new Set(r.failed.map(f => f.id)); logItems.push(...part.filter(x => !bad.has(x.id)).map(x => ({ id: x.id, before: x.before })));
  }
  if (logItems.length) { W().log = [{ at: now(), what: `Importó categorías desde Excel en ${logItems.length} productos`, items: logItems }, ...(W().log || [])].slice(0, 20); store.saveWebcat(); }
  return { ok: done, failed, created: created.length, pending: cut ? changes.length - done - failed.length : 0 };
}

module.exports = { importPlan, importApply, sync, list, plan, apply, assign, undo, createCat, renameCat, suggest };
