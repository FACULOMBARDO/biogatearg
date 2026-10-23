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

const DEFAULT_ML = 'Hola {nombre}! Te escribimos de Biogate. Según tu compra del {fecha}, tu {producto} se estaría terminando {cuando}. Si querés seguir con el tratamiento, lo tenés disponible en nuestra publicación. ¡Gracias por elegirnos!';
const DEFAULT_WA = 'Hola {nombre}! Te escribimos de Biogate. Según tu compra del {fecha}, tu {producto} se estaría terminando {cuando}. ¿Querés que te lo preparemos para que no cortes el tratamiento? Respondenos por acá y lo coordinamos. ¡Gracias!';

const R = () => store.getRefill();
function cfg() {
  const c = R().config || {};
  return { notice_days: c.notice_days >= 0 && c.notice_days <= 15 ? c.notice_days : 1, msg_ml: c.msg_ml || DEFAULT_ML, msg_wa: c.msg_wa || DEFAULT_WA, lookback: 730 };
}
function saveConfig(b) {
  const c = R().config || (R().config = {});
  if (b.notice_days !== undefined) { const n = Math.round(Number(b.notice_days)); if (n >= 0 && n <= 15) c.notice_days = n; }
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
  // Mercado Libre (sin TUYO, sin canceladas)
  for (const s of store.getSales(from, null)) {
    if (s.cancelled || sales.EXCLUDED.includes(s.order_state)) continue;
    if (require('./tuyo').isTuyo(s.account_id)) continue;
    const scan = s.shipment_id ? store.getScan(s.shipment_id) : null;
    const name = scan ? [scan.first_name, scan.last_name].filter(Boolean).join(' ') || scan.receiver_name : '';
    const phone = scan && scan.phone && !scan.phone_hidden && !/X{3}/i.test(scan.phone) ? scan.phone : '';
    for (const i of s.items || []) add({ src: 'ml', ref: s.order_id, account_id: s.account_id, account: s.account_nickname, order_id: s.order_id, pack_id: s.pack_id || '', date: arDay(s.date), sku: i.sku, title: i.title, qty: i.qty,
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
  const items = [];
  for (const p of all) {
    const id = `${p.src}:${p.ref}:${p.sku}`;
    const end = addDays(p.date, p.days), notify = addDays(end, -c.notice_days);
    const left = diffDays(end, today);
    if (left < -30) continue; // hace más de un mes que se terminó: ya no se muestra
    const rebought = (byWho[p.who + '|' + p.sku] || []).some(d => d > p.date && d <= end);
    const st = done[id];
    items.push({ id, ...p, end, notify, left, rebought, state: st ? st.state : (rebought ? 'rebought' : 'pending'), done_at: st ? st.at : null, done_by: st ? st.by : '', done_via: st ? st.via : '' });
  }
  items.sort((a, b) => a.end.localeCompare(b.end));
  const due = items.filter(i => i.state === 'pending' && i.notify <= today && i.left >= -15); // terminado hace más de 15 días: ya no se cuenta
  return { today, config: c, items, due_n: due.length, has_days: Object.keys(durations().days).length };
}
const dueCount = () => list().due_n;

function mark(id, state, by, via) {
  const d = R().done || (R().done = {});
  if (state === 'pending') delete d[id]; else d[id] = { state, at: new Date().toISOString(), by: String(by || '').slice(0, 40), via: via || '' };
  // Limpieza: se olvidan las marcas de hace más de 2 años.
  const lim = new Date(Date.now() - 800 * DAY).toISOString();
  for (const k of Object.keys(d)) if (d[k].at < lim) delete d[k];
  store.saveRefill();
}

// Arma el mensaje para un recordatorio.
function text(it, kind) {
  const c = cfg();
  const t = kind === 'wa' ? c.msg_wa : c.msg_ml;
  const [y, m, dd] = it.date.split('-');
  const cuando = it.left <= 0 ? 'por estos días' : it.left === 1 ? 'mañana' : `en ${it.left} días`;
  return t.replace(/\{nombre\}/gi, firstWord(it.name) || '').replace(/\{producto\}/gi, it.product).replace(/\{fecha\}/gi, `${dd}/${m}/${y}`).replace(/\{cuando\}/gi, cuando).replace(/\{dias\}/gi, String(it.days)).replace(/\s+!/g, '!').trim();
}

module.exports = { list, dueCount, mark, text, cfg, saveConfig, DEFAULT_ML, DEFAULT_WA, arDay };
