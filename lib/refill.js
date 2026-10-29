// Recompras: con la "DURACION" (días) de la lista de precios calcula cuándo se le termina el suplemento
// a cada cliente y avisa 1 día antes para mandarle un mensaje (Mercado Libre, presupuestos y web).
const store = require('./store');
const sales = require('./sales');
const woo = require('./woo');
const costs = require('./costs');

const DAY = 86400e3;
const pad = (n) => String(n).padStart(2, '0');
// Fecha local de Argentina (YYYY-MM-DD).
const arDay = (d) => { const t = new Date(new Date(d).getTime() - 3 * 3600e3); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
const addDays = (ymd, n) => { const t = new Date(ymd + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const diffDays = (a, b) => Math.round((new Date(a + 'T12:00:00Z') - new Date(b + 'T12:00:00Z')) / DAY);
const firstWord = (v) => { const w = String(v || '').trim().split(/\s+/)[0] || ''; return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ''; };

const DEFAULT_ML = 'Hola {nombre}! Te escribimos de Biogate. Tu {producto} se está por terminar. Para que no te quedes sin tu suplemento, te dejamos un cupón de 10% de descuento para reponerlo, válido por 7 días (hasta el {hasta}). Escribinos por acá y te contamos cómo aprovecharlo. ¡Gracias por elegirnos!';
const DEFAULT_WA = 'Hola {nombre}! Cómo estás? Te escribimos de Biogate. Tu {producto} se está por terminar. Para que no te quedes sin tu suplemento, te dejamos un cupón de 10% de descuento para reponerlo, válido por 7 días (hasta el {hasta}). ¿Te lo preparamos para retirar o te lo enviamos? Respondenos por acá y lo coordinamos. ¡Gracias por elegirnos!';

const R = () => store.getRefill();
function cfg() {
  const c = R().config || {};
  return { window_days: c.window_days >= 0 && c.window_days <= 30 ? c.window_days : 7, send_before: c.send_before >= 0 && c.send_before <= 15 ? c.send_before : 1, weekend_monday: c.weekend_monday !== false, msg_ml: c.msg_ml || DEFAULT_ML, msg_wa: c.msg_wa || DEFAULT_WA, lookback: 730 };
}
function saveConfig(b) {
  const c = R().config || (R().config = {});
  if (b.window_days !== undefined) { const n = Math.round(Number(b.window_days)); if (n >= 0 && n <= 30) c.window_days = n; }
  if (b.send_before !== undefined) { const n = Math.round(Number(b.send_before)); if (n >= 0 && n <= 15) c.send_before = n; }
  if (b.weekend_monday !== undefined) c.weekend_monday = !!b.weekend_monday;
  if (b.msg_ml !== undefined) c.msg_ml = String(b.msg_ml).trim().slice(0, 600) || undefined;
  if (b.msg_wa !== undefined) c.msg_wa = String(b.msg_wa).trim().slice(0, 1000) || undefined;
  store.saveRefill(); return cfg();
}

// Duración por SKU desde la lista de precios.
function durations() {
  const out = {}, names = {};
  for (const i of store.getCosts().items || []) {
    if (i.days > 0 && !(i.sku in out)) out[i.sku] = i.days;
    if (i.name && !(i.sku in names)) names[i.sku] = i.name;
  }
  return { days: out, names };
}

// Todas las compras de productos con duración (últimos ~2 años).
function purchases() {
  const { days, names } = durations();
  const from = arDay(Date.now() - cfg().lookback * DAY);
  const out = [];
  const add = (p) => { const k = costs.key(p.sku); const d = days[k]; if (!d) return; out.push({ ...p, sku: k, product: names[k] || p.title || k, unit_days: d, days: d * Math.max(1, p.qty || 1) }); };
  // Teléfonos de compradores de ML que alguna vez pasaron por Flex (escaneados), por usuario.
  const okPhone = (sc) => sc && sc.phone && !sc.phone_hidden && !/X{3}/i.test(sc.phone) ? sc.phone : '';
  const byNick = {};
  for (const sc of store.raw().scans || []) { const n = String(sc.nickname || '').toUpperCase(); if (n && okPhone(sc)) byNick[n] = { phone: okPhone(sc), name: [sc.first_name, sc.last_name].filter(Boolean).join(' ') || sc.receiver_name || '' }; }
  // Mercado Libre (sin TUYO, sin canceladas)
  for (const s of store.getSales(from, null)) {
    if (s.cancelled || sales.EXCLUDED.includes(s.order_state)) continue;
    if (require('./tuyo').isTuyo(s.account_id)) continue;
    const scan = s.shipment_id ? store.getScan(s.shipment_id) : null;
    const known = byNick[String(s.buyer || '').toUpperCase()] || {};
    const name = (scan ? [scan.first_name, scan.last_name].filter(Boolean).join(' ') || scan.receiver_name : '') || known.name || '';
    const phone = okPhone(scan) || known.phone || '';
    for (const i of s.items || []) add({ src: 'ml', ref: s.order_id, account_id: s.account_id, account: s.account_nickname, order_id: s.order_id, shipment_id: s.shipment_id || '', pack_id: s.pack_id || '', date: arDay(s.date), sku: i.sku, title: i.title, qty: i.qty,
      client: name || s.buyer || 'Cliente', name, nick: s.buyer || '', phone, who: 'ml:' + s.account_id + ':' + (s.buyer || s.order_id) });
  }
  // Presupuestos confirmados
  for (const q of store.getQuotes()) {
    if (q.confirmed === false || !q.date || q.date < from) continue;
    for (const i of q.items || []) add({ src: 'quote', ref: String(q.id), date: String(q.date).slice(0, 10), sku: i.sku, title: i.name, qty: i.qty, client: q.client, name: q.client, phone: q.whatsapp || '', number: q.number,
      who: 'p:' + (String(q.whatsapp || '').replace(/\D/g, '').slice(-8) || String(q.client).toLowerCase()) });
  }
  // Ventas web (pedidos que cuentan)
  for (const o of woo.ordersBetween(from, arDay(Date.now())).filter(o => o.counted)) {
    for (const i of o.items || []) add({ src: 'web', ref: o.id, date: arDay(o.date), sku: i.sku, title: i.name, qty: i.qty, client: o.customer || 'Cliente', name: o.customer || '', phone: o.phone || '', number: o.number,
      who: 'p:' + (String(o.phone || '').replace(/\D/g, '').slice(-8) || String(o.email || o.customer).toLowerCase()) });
  }
  return out;
}

// Lista de recordatorios con su estado.
function list() {
  const today = arDay(Date.now()), c = cfg(), done = R().done || {};
  const all = purchases();
  // Si el mismo cliente volvió a comprar el mismo producto, el recordatorio anterior ya no hace falta.
  const byWho = {};
  for (const p of all) (byWho[p.who + '|' + p.sku] = byWho[p.who + '|' + p.sku] || []).push(p.date);
  const manual = R().phones || {}, names = R().names || {};
  for (const p of all) {
    if (manual[p.who]) { p.phone = manual[p.who]; p.phone_manual = true; }
    const nm = names[p.who];
    if (nm && (nm.manual || !p.name)) { p.name = nm.name; p.client = nm.name; p.name_manual = !!nm.manual; }
  }
  const items = [];
  for (const p of all) {
    const id = `${p.src}:${p.ref}:${p.sku}`;
    const end = addDays(p.date, p.days), notify = addDays(end, -c.window_days);
    // Día de aviso: X días antes de que se termine; si cae sábado o domingo, pasa al lunes.
    let send_day = addDays(end, -c.send_before);
    if (c.weekend_monday) { const wd = new Date(send_day + 'T12:00:00Z').getUTCDay(); if (wd === 6) send_day = addDays(send_day, 2); else if (wd === 0) send_day = addDays(send_day, 1); }
    const left = diffDays(end, today);
    if (left < -30) continue; // hace más de un mes que se terminó: ya no se muestra
    const rebought = (byWho[p.who + '|' + p.sku] || []).some(d => d > p.date && d <= end);
    const st = done[id];
    items.push({ id, ...p, end, notify, send_day, left, rebought, state: st ? st.state : (rebought ? 'rebought' : 'pending'), done_at: st ? st.at : null, done_by: st ? st.by : '', done_via: st ? st.via : '' });
  }
  items.sort((a, b) => a.end.localeCompare(b.end));
  // Para avisar: se termina hoy, mañana o en los próximos días (hasta window_days). Las que ya se terminaron no.
  const due = items.filter(i => i.state === 'pending' && i.left >= 0 && i.left <= c.window_days);
  // Aviso del día (numerito, cartel y notificación): solo los que tocan hoy.
  const todayList = items.filter(i => i.state === 'pending' && i.send_day === today);
  return { today, config: c, items, due_n: due.length, today_n: todayList.length, has_days: Object.keys(durations().days).length };
}
const dueCount = () => list().today_n;

// Nombre del comprador de Mercado Libre (de los datos de facturación o del envío). Queda guardado.
async function resolveName(it) {
  if (it.name || it.src !== 'ml') return it.name || '';
  const { get, pick } = require('./ml');
  const acc = store.getAccount(it.account_id);
  if (!acc) return '';
  let name = '';
  const b = await get(acc, `/orders/${it.order_id}/billing_info`).catch(() => null);
  if (b && b.ok) {
    const bi = b.data || {}, nb = (bi.buyer || {}).billing_info || {};
    const add = {}; for (const x of (bi.billing_info || {}).additional_info || []) add[String(x.type).toUpperCase()] = x.value;
    name = pick([nb.name || nb.first_name, nb.last_name].filter(Boolean).join(' '), [add.FIRST_NAME, add.LAST_NAME].filter(Boolean).join(' '));
  }
  if (!name) { const o = await get(acc, `/orders/${it.order_id}`).catch(() => null); if (o && o.ok) name = pick([o.data.buyer?.first_name, o.data.buyer?.last_name].filter(Boolean).join(' ')); }
  if (!name && it.shipment_id) { const sh = await get(acc, `/shipments/${it.shipment_id}`).catch(() => null); if (sh && sh.ok) name = pick(sh.data.receiver_address?.receiver_name); }
  // Solo letras: si parece un usuario (con números) no sirve como nombre.
  name = String(name || '').trim();
  if (!name || /\d/.test(name)) return '';
  const n = R().names || (R().names = {});
  n[it.who] = { name: name.slice(0, 60) };
  store.saveRefill();
  return name;
}
// Busca los nombres que faltan de los que hay que avisar (de a pocos).
let resolving = null;
const tried = {};
function resolveMissing() {
  if (resolving) return resolving;
  const todo = list().items.filter(i => i.src === 'ml' && !i.name && i.state === 'pending' && i.left <= cfg().window_days + 7 && !tried[i.who]).slice(0, 15);
  if (!todo.length) return null;
  resolving = (async () => { for (const it of todo) { tried[it.who] = 1; await resolveName(it).catch(() => ''); } })().finally(() => { resolving = null; });
  return resolving;
}
// Nombre cargado a mano (gana sobre el de Mercado Libre).
function setName(who, name) {
  who = String(who || '').slice(0, 200);
  if (!who) throw new Error('Falta el cliente.');
  const n = R().names || (R().names = {});
  const v = String(name || '').trim().slice(0, 60);
  if (v) n[who] = { name: v, manual: true }; else delete n[who];
  store.saveRefill();
}

// WhatsApp cargado a mano para un cliente (queda para todas sus compras).
function setPhone(who, phone) {
  who = String(who || '').slice(0, 200);
  if (!who) throw new Error('Falta el cliente.');
  const ph = String(phone || '').replace(/[^\d+ ()-]/g, '').trim().slice(0, 30);
  if (ph && ph.replace(/\D/g, '').length < 8) throw new Error('El número parece incompleto (poné código de área, ej: 11 2345 6789).');
  const m = R().phones || (R().phones = {});
  if (ph) m[who] = ph; else delete m[who];
  store.saveRefill();
}

function mark(id, state, by, via) {
  const d = R().done || (R().done = {});
  if (state === 'pending') delete d[id]; else d[id] = { state, at: new Date().toISOString(), by: String(by || '').slice(0, 40), via: via || '' };
  // Limpieza: se olvidan las marcas de hace más de 2 años.
  const lim = new Date(Date.now() - 800 * DAY).toISOString();
  for (const k of Object.keys(d)) if (d[k].at < lim) delete d[k];
  store.saveRefill();
}

// Arma el mensaje para un recordatorio.
function text(it, kind, template) {
  const c = cfg();
  const t = String(template || (kind === 'wa' ? c.msg_wa : c.msg_ml));
  const [y, m, dd] = it.date.split('-');
  const cuando = it.left <= 0 ? 'hoy' : it.left === 1 ? 'mañana' : `en ${it.left} días`;
  const h = new Date(Date.now() - 3 * 3600e3 + 7 * DAY), hasta = `${pad(h.getUTCDate())}/${pad(h.getUTCMonth() + 1)}`;
  return t.replace(/\{nombre\}/gi, firstWord(it.name) || '').replace(/\{producto\}/gi, it.product).replace(/\{fecha\}/gi, `${dd}/${m}/${y}`).replace(/\{cuando\}/gi, cuando).replace(/\{dias\}/gi, String(it.days)).replace(/\{hasta\}/gi, hasta).replace(/\s+!/g, '!').trim();
}

module.exports = { resolveName, resolveMissing, setName, setPhone, list, dueCount, mark, text, cfg, saveConfig, DEFAULT_ML, DEFAULT_WA, arDay };
