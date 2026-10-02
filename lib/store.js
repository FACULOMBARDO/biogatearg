// Almacenamiento de datos.
// - En la PC: un archivo JSON (data/db.json).
// - En Vercel: base Upstash Redis (gratis), comprimida y repartida por mes para ventas, pedidos web y escaneos.
//   Cada instancia guarda una copia en memoria y solo vuelve a leer lo que otra instancia cambió.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const kv = require('./kv');
const { bg } = require('./bg');

const REMOTE = kv.enabled;
const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/data' : path.join(__dirname, '..', 'data'));
const FILE = path.join(DATA_DIR, 'db.json');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* en Vercel el disco es de solo lectura salvo /tmp */ }

let db = { accounts: {}, scans: [] };
if (!REMOTE && fs.existsSync(FILE)) {
  try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { console.error('No se pudo leer db.json:', e.message); }
}
function defaults() {
  db.accounts = db.accounts || {};
  db.scans = db.scans || [];
  db.settings = db.settings || {};
  db.sales = db.sales || {};
  db.costs = db.costs || { map: {}, count: 0 };
  db.quotes = db.quotes || [];
  db.clips = db.clips || { items: [] };
  db.web = db.web || { items: [] };
  db.expenses = db.expenses || [];
  db.full = db.full || { items: [] };
  db.woo = db.woo || { orders: {} };
  db.woo.orders = db.woo.orders || {};
  db.stock = db.stock || { items: {}, moves: [], applied: {} };
  db.quality = db.quality || { items: {} };
  db.manuals = db.manuals || { items: [] };
  db.manual_uploads = db.manual_uploads || [];
  db.jobs = db.jobs || {};
  db.settings.learned = db.settings.learned || {};
}
defaults();

// ---------- Modo PC: archivo ----------
function saveFile() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

// ---------- Modo Vercel: Upstash Redis ----------
const SMALL = ['accounts', 'settings', 'costs', 'quotes', 'clips', 'web', 'expenses', 'full', 'stock', 'quality', 'manuals', 'manual_uploads', 'woo', 'jobs'];
const month = (d) => { const t = new Date(d || 0); return isNaN(t) ? 'sin-fecha' : t.toISOString().slice(0, 7); };
const SHARDED = {
  sales: { of: (s) => month(s.date), all: () => Object.values(db.sales), put: (list, m) => { for (const [k, v] of Object.entries(db.sales)) if (month(v.date) === m) delete db.sales[k]; for (const v of list) db.sales[String(v.order_id)] = v; } },
  woo_orders: { of: (o) => month(o.date), all: () => Object.values(db.woo.orders), put: (list, m) => { for (const [k, v] of Object.entries(db.woo.orders)) if (month(v.date) === m) delete db.woo.orders[k]; for (const v of list) db.woo.orders[String(v.id)] = v; } },
  scans: { of: (s) => month(s.first_scanned_at || s.scanned_at), all: () => db.scans, put: (list, m) => { db.scans = db.scans.filter(v => month(v.first_scanned_at || v.scanned_at) !== m).concat(list).sort((a, b) => String(b.scanned_at).localeCompare(String(a.scanned_at))); } },
};
const ver = {};        // versión conocida de cada parte
const lastStr = {};    // último contenido guardado de cada colección chica
const dirty = new Set(); // partes por mes con cambios
const enc = (s) => zlib.gzipSync(s).toString('base64');
const dec = (v) => JSON.parse(zlib.gunzipSync(Buffer.from(v, 'base64')).toString('utf8'));
const smallValue = (k) => (k === 'woo' ? { ...db.woo, orders: undefined } : db[k]);
const mark = (coll, item) => { if (REMOTE && item) dirty.add(coll + ':' + SHARDED[coll].of(item)); };

function replaceInPlace(k, data) {
  if (k === 'woo') { const orders = db.woo.orders; for (const x of Object.keys(db.woo)) delete db.woo[x]; Object.assign(db.woo, data || {}, { orders }); return; }
  const cur = db[k];
  if (Array.isArray(cur) && Array.isArray(data)) { cur.length = 0; cur.push(...data); return; }
  if (cur && typeof cur === 'object' && !Array.isArray(cur) && data && typeof data === 'object' && !Array.isArray(data)) { for (const x of Object.keys(cur)) delete cur[x]; Object.assign(cur, data); return; }
  db[k] = data;
}
function applyPart(key, data) {
  const i = key.indexOf(':');
  if (i < 0) { replaceInPlace(key, data); defaults(); lastStr[key] = JSON.stringify(smallValue(key)); return; }
  const coll = key.slice(0, i), m = key.slice(i + 1);
  if (SHARDED[coll]) SHARDED[coll].put(Array.isArray(data) ? data : [], m);
}
async function loadParts(keys, remoteVer) {
  for (let i = 0; i < keys.length; i += 8) {
    const chunk = keys.slice(i, i + 8);
    const vals = await kv.pipeline(chunk.map(k => ['GET', 'fx:d:' + k]));
    chunk.forEach((k, j) => {
      if (vals[j] == null) return;
      try { applyPart(k, dec(vals[j])); ver[k] = Number(remoteVer[k]) || 0; } catch (e) { console.error('No se pudo leer', k, e.message); }
    });
  }
}
let loaded = null, lastCheck = 0, syncing = null;
// Trae de la base lo que haya cambiado (al primer pedido trae todo).
function sync({ force = false } = {}) {
  if (!REMOTE) return Promise.resolve();
  if (!loaded) {
    loaded = (async () => {
      const rv = kv.hashToObj(await kv.cmd('HGETALL', 'fx:ver'));
      await loadParts(Object.keys(rv), rv);
      for (const k of SMALL) if (lastStr[k] === undefined) lastStr[k] = rv[k] ? JSON.stringify(smallValue(k)) : '';
      lastCheck = Date.now();
    })().catch(e => { loaded = null; throw e; });
    return loaded;
  }
  if (!force && Date.now() - lastCheck < 2000) return loaded;
  if (syncing) return syncing;
  syncing = (async () => {
    await loaded; await chain;
    const rv = kv.hashToObj(await kv.cmd('HGETALL', 'fx:ver'));
    lastCheck = Date.now();
    const changed = Object.keys(rv).filter(k => Number(rv[k]) !== ver[k]);
    if (changed.length) await loadParts(changed, rv);
  })().finally(() => { syncing = null; });
  return syncing;
}
// Sube lo que cambió (colecciones chicas completas; ventas/pedidos/escaneos solo los meses tocados).
async function doFlush() {
  const parts = [];
  for (const k of SMALL) { const s = JSON.stringify(smallValue(k)); if (s !== lastStr[k]) parts.push({ k, s }); }
  const ds = [...dirty]; dirty.clear();
  for (const d of ds) { const [coll, m] = [d.slice(0, d.indexOf(':')), d.slice(d.indexOf(':') + 1)]; parts.push({ k: d, s: JSON.stringify(SHARDED[coll].all().filter(x => SHARDED[coll].of(x) === m)), shard: true }); }
  if (!parts.length) return;
  let batch = [], size = 0;
  const send = async () => {
    if (!batch.length) return;
    const b = batch; batch = []; size = 0;
    try {
      const res = await kv.pipeline([...b.map(p => ['SET', 'fx:d:' + p.k, p.v]), ...b.map(p => ['HINCRBY', 'fx:ver', p.k, 1])]);
      b.forEach((p, i) => { ver[p.k] = Number(res[b.length + i]); if (!p.shard) lastStr[p.k] = p.s; });
    } catch (e) { for (const p of b) if (p.shard) dirty.add(p.k); throw e; }
  };
  for (const p of parts) {
    p.v = enc(p.s);
    if (size + p.v.length > 6e6) await send();
    batch.push(p); size += p.v.length;
  }
  await send();
}
let chain = Promise.resolve(), scheduled = false;
function save() {
  if (!REMOTE) return saveFile();
  if (scheduled) return;
  scheduled = true;
  chain = chain.then(() => new Promise(r => setImmediate(r))).then(() => { scheduled = false; return doFlush(); })
    .catch(e => console.error('No se pudo guardar en la base de datos:', e.message));
  bg(chain);
}
// Espera a que lo pendiente quede guardado.
const flush = () => (REMOTE ? chain : Promise.resolve());
// Carga completa desde un db.json (lo usa migrar.js).
async function importAll(data) {
  db = data; defaults();
  for (const k of SMALL) lastStr[k] = '';
  for (const coll of Object.keys(SHARDED)) for (const x of SHARDED[coll].all()) mark(coll, x);
  save(); await flush();
}

module.exports = {
  DATA_DIR, REMOTE, sync, flush, importAll, raw: () => db,
  // Estado de tareas automáticas (última vez que corrieron, tareas a medias)
  getJobs: () => db.jobs,
  saveJobs(partial) { Object.assign(db.jobs, partial); save(); return db.jobs; },
  // Configuración (precios por zona y localidades asignadas a mano)
  getSettings: () => db.settings,
  saveSettings(partial) { Object.assign(db.settings, partial); save(); return db.settings; },
  learnZone(key, zone) { if (zone) db.settings.learned[key] = zone; else delete db.settings.learned[key]; save(); },
  setZone(shipmentId, zone) {
    const s = db.scans.find(x => x.shipment_id === String(shipmentId));
    if (!s) return null;
    if (zone) s.zone_manual = zone; else delete s.zone_manual;
    mark('scans', s); save();
    return s;
  },

  // Cuentas de Mercado Libre conectadas
  getAccounts: () => Object.values(db.accounts),
  getAccount: (userId) => db.accounts[String(userId)],
  saveAccount(acc) { db.accounts[String(acc.user_id)] = acc; save(); },
  removeAccount(userId) { delete db.accounts[String(userId)]; save(); },

  // Gastos del local
  getExpenses: () => db.expenses,
  saveExpense(e) {
    const i = db.expenses.findIndex(x => x.id === e.id);
    if (i >= 0) db.expenses[i] = { ...db.expenses[i], ...e }; else db.expenses.push(e);
    save();
    return db.expenses.find(x => x.id === e.id);
  },
  addExpenses(list) { db.expenses.push(...list); save(); },
  deleteExpense(id) { db.expenses = db.expenses.filter(x => x.id !== id); save(); },

  // Pedidos de la web (WooCommerce)
  getWoo: () => db.woo,
  upsertWoo(list, syncedAt) { for (const o of list) { db.woo.orders[o.id] = o; mark('woo_orders', o); } if (syncedAt) db.woo.last_sync = syncedAt; save(); },

  // Manuales
  getManualUploads: () => db.manual_uploads,
  saveManualUploads() { save(); },
  getManuals: () => db.manuals,
  saveManuals(m) { db.manuals = m; save(); },

  // Calidad de publicaciones
  getQuality: () => db.quality,
  saveQuality(q) { db.quality = q; save(); },

  // Stock propio
  getStock: () => db.stock,
  saveStock() { save(); },

  // Stock en Full
  getFull: () => db.full,
  saveFull(f) { db.full = f; save(); },

  // Productos de la web (para estados de WhatsApp)
  getWeb: () => db.web,
  saveWeb(w) { db.web = w; save(); },

  // Clips de publicaciones
  getClips: () => db.clips,
  saveClips(c) { db.clips = c; save(); },

  // Presupuestos
  getQuotes: () => db.quotes,
  getQuote: (id) => db.quotes.find(q => q.id === Number(id)),
  saveQuote(q) {
    const i = db.quotes.findIndex(x => x.id === q.id);
    if (i >= 0) db.quotes[i] = { ...db.quotes[i], ...q }; else db.quotes.unshift(q);
    save();
    return db.quotes.find(x => x.id === q.id);
  },
  deleteQuote(id) { db.quotes = db.quotes.filter(q => q.id !== Number(id)); save(); },

  // Costos de productos (por SKU)
  getCosts: () => db.costs,
  saveCosts(c) { db.costs = c; save(); },
  setManualSku(itemId, titleKey, sku) {
    db.settings.sku_by_item = db.settings.sku_by_item || {};
    db.settings.sku_by_title = db.settings.sku_by_title || {};
    if (itemId) { if (sku) db.settings.sku_by_item[itemId] = sku; else delete db.settings.sku_by_item[itemId]; }
    if (titleKey) { if (sku) db.settings.sku_by_title[titleKey] = sku; else delete db.settings.sku_by_title[titleKey]; }
    save();
  },
  setStateOverride(orderId, state) {
    db.settings.state_override = db.settings.state_override || {};
    if (state) db.settings.state_override[String(orderId)] = state; else delete db.settings.state_override[String(orderId)];
    save();
  },
  setManualCost(sku, cost) {
    db.settings.cost_manual = db.settings.cost_manual || {};
    if (cost > 0) db.settings.cost_manual[sku] = cost; else delete db.settings.cost_manual[sku];
    save();
  },

  // Ventas (clave: número de venta)
  getSale: (id) => db.sales[String(id)],
  updateSale(id, fields) { const s = db.sales[String(id)]; if (s) { Object.assign(s, fields); mark('sales', s); save(); } },
  upsertSales(list) { for (const s of list) { db.sales[String(s.order_id)] = s; mark('sales', s); } save(); },
  getSales(from, to, account) {
    const a = from ? new Date(from + 'T00:00:00-03:00') : new Date(0);
    const b = to ? new Date(to + 'T23:59:59-03:00') : new Date(8.64e15);
    return Object.values(db.sales).filter(s => { const d = new Date(s.date); return d >= a && d <= b && (!account || s.account_id === String(account)); });
  },

  // Escaneos
  getScans: () => db.scans,
  // opts.imported: viene de una importación (no cuenta como escaneo y no cambia la hora).
  upsertScan(scan, opts = {}) {
    const i = db.scans.findIndex(s => s.shipment_id === scan.shipment_id);
    if (opts.imported) scan.source = 'importado';
    if (i >= 0) {
      const old = db.scans[i];
      scan.first_scanned_at = old.first_scanned_at || old.scanned_at;
      scan.scan_count = opts.imported ? (old.scan_count || 0) : (old.scan_count || 0) + 1;
      if (opts.imported) { scan.scanned_at = old.scanned_at; if (old.source !== 'importado') delete scan.source; }
      if (old.messages) scan.messages = old.messages;
      if (old.zone_manual) scan.zone_manual = old.zone_manual;
      // Si el teléfono se había cargado a mano y Mercado Libre lo sigue tapando, lo conservamos.
      if (old.phone_manual && (scan.phone_hidden || !scan.phone)) {
        scan.phone = old.phone;
        scan.phone_manual = true;
        scan.phone_hidden = false;
      }
      if (opts.imported) { db.scans[i] = scan; mark('scans', scan); save(); return { scan, repeated: true }; }
      db.scans.splice(i, 1);
    } else {
      scan.first_scanned_at = scan.scanned_at;
      scan.scan_count = opts.imported ? 0 : 1;
    }
    db.scans.unshift(scan);
    mark('scans', scan); save();
    return { scan, repeated: i >= 0 };
  },
  setPhone(shipmentId, phone) {
    const s = db.scans.find(x => x.shipment_id === String(shipmentId));
    if (!s) return null;
    s.phone = phone;
    s.phone_manual = !!phone;
    s.phone_hidden = !phone;
    mark('scans', s); save();
    return s;
  },
  setScanFields(shipmentId, fields) {
    const s = db.scans.find(x => x.shipment_id === String(shipmentId));
    if (s) { Object.assign(s, fields); mark('scans', s); save(); }
  },
  getScan: (shipmentId) => db.scans.find(x => x.shipment_id === String(shipmentId)),
  addMessage(shipmentId, entry, extra = {}) {
    const s = db.scans.find(x => x.shipment_id === String(shipmentId));
    if (!s) return;
    Object.assign(s, extra);
    s.messages = s.messages || [];
    s.messages.push(entry);
    mark('scans', s); save();
  },
  deleteScan(shipmentId) {
    mark('scans', db.scans.find(s => s.shipment_id === String(shipmentId)));
    db.scans = db.scans.filter(s => s.shipment_id !== String(shipmentId));
    save();
  },
};
