// Competencia: para cada producto tuyo busca quién más lo vende en el catálogo de Mercado Libre,
// anota todos los días cuántas vendió cada competidor y a qué precio, y da una recomendación de precio.
const store = require('./store');
const ml = require('./ml');
const { get, pick } = ml;

const MAX_GROUPS = 40;      // productos que se siguen (los más vendidos + los que elijas)
const MAX_COMP = 15;        // competidores por producto
const KEEP_DAYS = 75;       // días de historia que se guardan
const C = () => store.getCompetition();
const groups = () => C().groups || (C().groups = {});
const snaps = () => C().snaps || (C().snaps = {});
const now = () => new Date().toISOString();
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
const dayNum = (d) => Math.round(new Date(d + 'T12:00:00-03:00').getTime() / 86400e3);
const norm = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');
const anyAcc = () => { const a = store.getAccounts().find(x => !x.needs_reconnect); if (!a) throw new Error('No hay cuentas conectadas.'); return a; };

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

// Mis productos agrupados por SKU (o título) con sus publicaciones en cada cuenta.
function myProducts() {
  const out = {};
  for (const it of Object.values(store.getListings().items || {})) {
    if (it.status !== 'active') continue;
    const key = norm(it.sku) || 'T:' + norm(it.title).slice(0, 60);
    const g = out[key] = out[key] || { key, title: it.title, sku: it.sku || '', thumb: it.thumb, items: [], sold: 0 };
    g.items.push({ id: it.id, account_id: it.account_id, account: it.account, price: it.price, original_price: it.original_price, stock: it.stock, logistic: it.logistic, link: it.link, catalog: it.catalog });
    g.sold += it.sold || 0;
  }
  return out;
}
// Unidades que vendí en los últimos N días por publicación (de las ventas guardadas).
function mySales(days) {
  const from = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
  const out = {};
  for (const s of store.getSales(from, null)) if (!s.cancelled) for (const i of s.items || []) if (i.item_id) out[i.item_id] = (out[i.item_id] || 0) + (i.qty || 1);
  return out;
}

// Producto de catálogo para un grupo: el de mi publicación si es de catálogo; si no, el mejor resultado buscando por título.
async function findProduct(acc, g) {
  for (const it of g.items) {
    const r = await retry(() => get(acc, `/items/${it.id}?attributes=catalog_product_id`));
    const pid = r && r.ok ? r.data.catalog_product_id : null;
    if (pid) return { id: pid, auto: 'catalog' };
  }
  const q = encodeURIComponent(g.title.slice(0, 100));
  const r = await retry(() => get(acc, `/products/search?status=active&site_id=MLA&q=${q}&limit=1`));
  const p = r && r.ok ? (r.data.results || [])[0] : null;
  return p ? { id: p.id, name: p.name, auto: 'search' } : null;
}
async function searchProducts(q) {
  const acc = anyAcc();
  const r = await retry(() => get(acc, `/products/search?status=active&site_id=MLA&q=${encodeURIComponent(String(q || '').slice(0, 100))}&limit=8`));
  if (!r.ok) throw new Error('Mercado Libre no dejó buscar en el catálogo.');
  return (r.data.results || []).map(p => ({ id: p.id, name: p.name, thumb: ((p.pictures || [])[0] || {}).url || '', attrs: (p.attributes || []).slice(0, 4).map(a => `${a.name}: ${a.value_name}`).join(' · ') }));
}
// Vincular un producto mío a un producto de catálogo elegido a mano (o desvincular).
function link(key, productId, name) {
  const g = groups()[key] = groups()[key] || { key };
  if (productId) { g.product_id = productId; g.product_name = name || ''; g.manual = true; g.competitors = []; }
  else { delete g.product_id; g.manual = true; g.ignored = true; }
  store.saveCompetition();
  return g;
}
function follow(key, on) {
  const g = groups()[key] = groups()[key] || { key };
  g.pinned = !!on; if (on) delete g.ignored;
  store.saveCompetition();
  return g;
}

let job = { running: false };
function status() { return { ...job }; }
// Actualiza: elige productos a seguir, busca competidores y anota ventas y precios de hoy.
function refresh() {
  if (job.running) return false;
  job = { running: true, started_at: now(), done: 0, total: 0, errors: [] };
  require('./bg').bg((async () => {
    const acc = anyAcc();
    const mine = myProducts(), sales30 = mySales(30), myAccs = new Set(store.getAccounts().map(a => String(a.user_id)));
    // Los más vendidos (últimos 30 días) + los fijados
    const rank = Object.values(mine).map(g => ({ g, u: g.items.reduce((n, i) => n + (sales30[i.id] || 0), 0) })).sort((a, b) => b.u - a.u || b.g.sold - a.g.sold);
    const chosen = rank.filter(x => (groups()[x.g.key] || {}).pinned).concat(rank.filter(x => !(groups()[x.g.key] || {}).pinned)).filter(x => !(groups()[x.g.key] || {}).ignored).slice(0, MAX_GROUPS);
    job.total = chosen.length;
    const d = today(), dn = dayNum(d);
    const toSnap = new Set();
    await pool(chosen, 3, async ({ g }) => {
      try {
        const cg = groups()[g.key] = { ...(groups()[g.key] || {}), key: g.key, title: g.title, sku: g.sku, thumb: g.thumb };
        if (!cg.product_id && !cg.manual) {
          const p = await findProduct(acc, g);
          if (p) { cg.product_id = p.id; cg.product_name = p.name || ''; cg.match = p.auto; }
        }
        if (cg.product_id) {
          const r = await retry(() => get(acc, `/products/${cg.product_id}/items?limit=50`));
          if (r && r.ok) {
            const list = (r.data.results || []).map(x => ({ id: x.item_id, seller_id: String(x.seller_id || ''), price: x.price, original_price: x.original_price || null, free_ship: !!x.shipping?.free_shipping, full: x.shipping?.logistic_type === 'fulfillment', official: !!x.official_store_id, mine: myAccs.has(String(x.seller_id || '')) }));
            const others = list.filter(x => !x.mine).sort((a, b) => a.price - b.price).slice(0, MAX_COMP);
            cg.competitors = others.map(x => ({ ...((cg.competitors || []).find(c => c.id === x.id) || {}), ...x }));
            if (!cg.product_name) { const p = await retry(() => get(acc, `/products/${cg.product_id}`)); if (p && p.ok) { cg.product_name = p.data.name; cg.buybox_item = pick(p.data.buy_box_winner?.item_id); } }
            else { const p = await retry(() => get(acc, `/products/${cg.product_id}?attributes=buy_box_winner`)); if (p && p.ok) cg.buybox_item = pick(p.data.buy_box_winner?.item_id); }
            for (const c of cg.competitors) toSnap.add(c.id);
          }
        }
        cg.updated_at = now();
      } catch (e) { job.errors.push(`${g.title.slice(0, 40)}: ${e.message}`); }
      job.done++;
    });
    // Nombres de vendedores
    const users = C().users || (C().users = {});
    const needU = [...new Set(Object.values(groups()).flatMap(g => (g.competitors || []).map(c => c.seller_id)).filter(id => id && !users[id]))].slice(0, 200);
    await pool(needU, 4, async (id) => { const u = await retry(() => get(acc, `/users/${id}`)); users[id] = u && u.ok ? { nick: u.data.nickname || '', rep: u.data.seller_reputation?.level_id || '', power: u.data.seller_reputation?.power_seller_status || '' } : { nick: '' }; });
    // Foto del día: vendidos y precio de cada competidor
    const ids = [...toSnap], chunks = [];
    for (let i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20));
    const info = {};
    await pool(chunks, 3, async (ch) => {
      const r = await retry(() => get(acc, `/items?ids=${ch.join(',')}&attributes=id,title,permalink,sold_quantity,price,status,available_quantity`));
      for (const y of (r && r.ok && Array.isArray(r.data) ? r.data : [])) if (y.code === 200 && y.body) info[y.body.id] = y.body;
    });
    for (const id of ids) {
      const b = info[id]; if (!b) continue;
      const arr = snaps()[id] = (snaps()[id] || []).filter(s => s[0] !== dn && s[0] > dn - KEEP_DAYS);
      arr.push([dn, b.sold_quantity ?? null, b.price]);
      arr.sort((a, b2) => a[0] - b2[0]);
      for (const g of Object.values(groups())) for (const c of g.competitors || []) if (c.id === id) { c.title = b.title; c.link = b.permalink; c.stock = b.available_quantity; c.status = b.status; }
    }
    // Se borra la historia de publicaciones que ya no se siguen
    const live = new Set(Object.values(groups()).flatMap(g => (g.competitors || []).map(c => c.id)));
    for (const id of Object.keys(snaps())) if (!live.has(id)) delete snaps()[id];
    C().updated_at = now(); C().first_day = C().first_day || d; C().errors = job.errors.slice(0, 20);
    store.saveCompetition();
    job.running = false; job.finished_at = now();
  })().catch(e => { job.running = false; job.errors.push(e.message); }));
  return true;
}

// Ventas y precio de un competidor en los últimos N días (según las fotos diarias).
function trend(id, days) {
  const arr = snaps()[id] || [];
  if (!arr.length) return { sold: null, price_before: null, measured_days: 0 };
  const last = arr[arr.length - 1], target = last[0] - days;
  const base = arr.find(s => s[0] >= target) || arr[0];
  const sold = last[1] != null && base[1] != null ? Math.max(0, last[1] - base[1]) : null;
  return { sold, sold_total: last[1], price_before: base[2], measured_days: last[0] - base[0] };
}
function median(a) { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; }
const round = (v) => Math.max(999, Math.round(v / 1000) * 1000 - 1);
function recommend(myPrice, mySold, comps, days, hasBuybox) {
  const active = comps.filter(c => c.status !== 'paused' && c.status !== 'closed');
  if (!active.length) return { level: 'ok', text: 'Nadie más lo vende en el catálogo: tenés el producto para vos. Podés probar subir un poco el precio.' };
  const prices = active.map(c => c.price), min = Math.min(...prices), med = median(prices);
  const selling = active.filter(c => c.sold > 0);
  const best = selling.sort((a, b) => b.sold - a.sold)[0];
  const diff = myPrice ? Math.round((myPrice / med - 1) * 100) : 0;
  if (!myPrice) return { level: 'info', text: `Precio de la competencia: desde $ ${min.toLocaleString('es-AR')} (mediana $ ${med.toLocaleString('es-AR')}).` };
  if (best && best.price < myPrice * 0.95 && best.sold > (mySold || 0)) return { level: 'down', text: `${best.seller || 'Un competidor'} vendió ${best.sold} en ${days} días a $ ${best.price.toLocaleString('es-AR')} (vos ${mySold || 0}). Para competir probá bajar a ~$ ${round(best.price * 1.01).toLocaleString('es-AR')}${best.full ? ' o mandarlo a Full como él' : ''}.` };
  if (diff > 12) return { level: 'down', text: `Estás ${diff}% arriba de la mediana ($ ${med.toLocaleString('es-AR')}). Si no vendés, probá bajar a ~$ ${round(med).toLocaleString('es-AR')}.` };
  if (myPrice <= min && diff < -8) return { level: 'up', text: `Sos el más barato (${-diff}% debajo de la mediana). Podrías subir a ~$ ${round(Math.min(med * 0.97, min * 1.08)).toLocaleString('es-AR')} sin perder el primer lugar.` };
  if (hasBuybox === false) return { level: 'down', text: `No estás ganando el catálogo. El que gana vende a $ ${min.toLocaleString('es-AR')}: igualá o mejorá envío (Full o gratis).` };
  return { level: 'ok', text: `Tu precio está en línea con la competencia (${diff > 0 ? diff + '% arriba' : diff < 0 ? -diff + '% abajo' : 'igual'} de la mediana).` };
}
function list(days, account) {
  days = [7, 30, 60].includes(Number(days)) ? Number(days) : 30;
  const mine = myProducts(), mySold = mySales(days), users = C().users || {};
  const out = [];
  for (const g of Object.values(groups())) {
    const m = mine[g.key];
    if (!m || (account && !m.items.some(i => i.account_id === account))) continue;
    const items = account ? m.items.filter(i => i.account_id === account) : m.items;
    const comps = (g.competitors || []).map(c => ({ ...c, seller: (users[c.seller_id] || {}).nick || '', rep: (users[c.seller_id] || {}).rep || '', power: (users[c.seller_id] || {}).power || '', ...trend(c.id, days) }));
    const myUnits = items.reduce((n, i) => n + (mySold[i.id] || 0), 0);
    const myPrice = Math.min(...items.map(i => i.price));
    const hasBuybox = g.buybox_item ? items.some(i => i.id === g.buybox_item) : null;
    out.push({
      key: g.key, title: m.title, sku: m.sku, thumb: m.thumb, mine: items, my_units: myUnits, my_price: myPrice,
      product_id: g.product_id || null, product_name: g.product_name || '', match: g.match || (g.manual ? 'manual' : ''), pinned: !!g.pinned, buybox_mine: hasBuybox,
      competitors: comps, comp_units: comps.some(c => c.sold != null) ? comps.reduce((n, c) => n + (c.sold || 0), 0) : null,
      min: comps.length ? Math.min(...comps.map(c => c.price)) : null, median: median(comps.map(c => c.price)),
      rec: g.product_id ? recommend(myPrice, myUnits, comps, days, hasBuybox) : { level: 'info', text: 'No encontré este producto en el catálogo de ML: vinculalo a mano con "Cambiar producto".' },
      updated_at: g.updated_at || null,
    });
  }
  // Productos tuyos que todavía no se siguen (para poder agregarlos)
  const followed = new Set(out.map(o => o.key));
  const others = Object.values(mine).filter(m => !followed.has(m.key) && (!account || m.items.some(i => i.account_id === account))).sort((a, b) => b.sold - a.sold).slice(0, 300).map(m => ({ key: m.key, title: m.title, sku: m.sku, accounts: m.items.map(i => i.account) }));
  out.sort((a, b) => b.my_units - a.my_units || (b.comp_units || 0) - (a.comp_units || 0));
  return { days, items: out, others, updated_at: C().updated_at || null, first_day: C().first_day || null, errors: C().errors || [], job: status(), listings_at: store.getListings().updated_at || null };
}

module.exports = { refresh, status, list, searchProducts, link, follow };
