// Preguntas de los compradores en todas las cuentas de Mercado Libre: llegan al instante por las
// notificaciones de Mercado Libre (tópico "questions") y se responden desde el panel.
const crypto = require('crypto');
const store = require('./store');
const ml = require('./ml');

const MAX_ANSWER = 2000;
const Q = () => store.getQuestions();
const items = () => Q().items || (Q().items = {});
const now = () => new Date().toISOString();
const str = (v, n) => String(v ?? '').trim().slice(0, n);

// Guarda/actualiza una pregunta con lo que devuelve Mercado Libre (api_version=4).
function upsert(acc, q) {
  if (!q || !q.id) return null;
  const id = String(q.id), cur = items()[id] || {};
  const out = {
    ...cur, id, account_id: String(acc.user_id), account: acc.nickname || String(acc.user_id),
    item_id: String(q.item_id || cur.item_id || ''), text: str(q.text, 2000) || cur.text || '',
    status: String(q.status || cur.status || 'UNANSWERED').toUpperCase(), date: q.date_created || cur.date || now(),
    from_id: String((q.from && q.from.id) || cur.from_id || ''), deleted: !!q.deleted_from_listing || q.status === 'DELETED',
    answer: q.answer && q.answer.text ? { text: str(q.answer.text, MAX_ANSWER), date: q.answer.date_created || (cur.answer || {}).date || now(), by: (cur.answer || {}).by || '' } : (cur.answer || null),
    seen_at: cur.seen_at || null, updated_at: now(),
  };
  if (out.answer && out.status === 'UNANSWERED') out.status = 'ANSWERED';
  items()[id] = out;
  return out;
}
// Limpieza: quedan todas las sin responder y las respondidas de los últimos 45 días (máx. 400).
function prune() {
  const all = Object.values(items());
  const lim = new Date(Date.now() - 45 * 86400e3).toISOString();
  const answered = all.filter(q => q.status !== 'UNANSWERED').sort((a, b) => String(b.date).localeCompare(String(a.date)));
  answered.forEach((q, i) => { if (i >= 400 || String(q.date) < lim) delete items()[q.id]; });
}

// Datos de la publicación (foto, título, precio, stock) y el usuario que pregunta.
async function enrich(acc, list) {
  const need = [...new Set(list.filter(q => q.item_id && (!q.item || Date.now() - new Date(q.item.at || 0) > 30 * 60e3)).map(q => q.item_id))];
  for (let i = 0; i < need.length; i += 20) {
    const r = await ml.get(acc, `/items?ids=${need.slice(i, i + 20).join(',')}&attributes=id,title,price,currency_id,available_quantity,thumbnail,secure_thumbnail,permalink,status,seller_custom_field,attributes`).catch(() => null);
    for (const x of (r && r.ok && Array.isArray(r.data) ? r.data : [])) {
      const b = x.body || {}; if (!b.id) continue;
      const skuAttr = (b.attributes || []).find(a => a.id === 'SELLER_SKU');
      const info = { title: b.title || '', price: b.price || 0, currency: b.currency_id || 'ARS', stock: b.available_quantity ?? null, thumb: b.secure_thumbnail || b.thumbnail || '', link: b.permalink || '', status: b.status || '', sku: (skuAttr && skuAttr.value_name) || b.seller_custom_field || '', at: now() };
      for (const q of list) if (q.item_id === b.id) q.item = info;
    }
  }
  const users = Q().users || (Q().users = {});
  for (const q of list) {
    if (!q.from_id) continue;
    if (!users[q.from_id]) {
      const u = await ml.get(acc, `/users/${q.from_id}`).catch(() => null);
      users[q.from_id] = { nick: (u && u.ok && u.data.nickname) || '', at: now() };
    }
    q.from_nick = users[q.from_id].nick || q.from_nick || '';
  }
}

// Llega una notificación de Mercado Libre: se trae esa pregunta.
async function onNotify(b) {
  const m = String(b.resource || '').match(/\/questions\/(\d+)/);
  if (!m) return null;
  const acc = store.getAccount(String(b.user_id)) || store.getAccounts().find(a => String(a.user_id) === String(b.user_id));
  if (!acc) return null;
  return fetchOne(acc, m[1]);
}
// Aviso push de pregunta nueva (a las compus/celulares que activaron las notificaciones).
function notifyNew(q) {
  const it = q.item || {};
  return require('./push').send('questions', { title: `Nueva pregunta · ${q.account}`, body: `${it.title ? it.title + '\n' : ''}${q.text}`, tag: 'q' + q.id, url: '/#preguntas', icon: it.thumb || '/logo-icon.png' }).catch(e => console.log('Push:', e.message));
}
async function fetchOne(acc, qid) {
  const was = items()[String(qid)];
  const r = await ml.get(acc, `/questions/${qid}?api_version=4`);
  if (!r.ok) {
    if (r.status === 404 && items()[qid]) { items()[qid].status = 'DELETED'; items()[qid].deleted = true; store.saveQuestions(); }
    return null;
  }
  const q = upsert(acc, r.data);
  if (q) {
    await enrich(acc, [q]).catch(() => {}); store.saveQuestions();
    if (!was && q.status === 'UNANSWERED') await notifyNew(q);
  }
  return q;
}

// Repaso completo (por si se perdió alguna notificación): las sin responder de cada cuenta.
let syncing = null;
function syncAll() {
  if (syncing) return syncing;
  syncing = (async () => {
    const errors = [];
    for (const acc of store.getAccounts()) {
      if (acc.needs_reconnect) continue;
      try {
        const got = [], firstTime = !Q().last_sync, known = new Set(Object.keys(items()));
        for (let offset = 0; offset < 200; offset += 50) {
          const r = await ml.get(acc, `/questions/search?seller_id=${acc.user_id}&status=UNANSWERED&api_version=4&sort_fields=date_created&sort_types=DESC&limit=50&offset=${offset}`);
          if (!r.ok) throw new Error(r.data?.message || 'error ' + r.status);
          const qs = r.data.questions || [];
          for (const q of qs) got.push(upsert(acc, q));
          if (qs.length < 50) break;
        }
        // Las que teníamos sin responder y ya no están: se respondieron por otro lado o se borraron.
        const ids = new Set(got.map(q => q.id));
        for (const q of Object.values(items())) if (q.account_id === String(acc.user_id) && q.status === 'UNANSWERED' && !ids.has(q.id)) await fetchOne(acc, q.id).catch(() => {});
        await enrich(acc, got).catch(() => {});
        // Las nuevas que no llegaron por notificación (de las últimas 2 horas): también se avisan.
        if (!firstTime) for (const q of got) if (!known.has(q.id) && Date.now() - new Date(q.date) < 2 * 3600e3) await notifyNew(q);
      } catch (e) { errors.push(`${acc.nickname || acc.user_id}: ${e.message}`); }
    }
    prune();
    Q().last_sync = now(); Q().last_error = errors.join(' · ');
    store.saveQuestions();
    return { ok: !errors.length, errors };
  })().finally(() => { syncing = null; });
  return syncing;
}

async function answer(qid, text, by) {
  const q = items()[String(qid)];
  if (!q) throw new Error('No encontré esa pregunta.');
  text = String(text || '').trim();
  if (!text) throw new Error('Escribí la respuesta.');
  if (text.length > MAX_ANSWER) throw new Error(`La respuesta tiene ${text.length} caracteres (máximo ${MAX_ANSWER}).`);
  const acc = store.getAccount(q.account_id);
  if (!acc) throw new Error('La cuenta de esa pregunta ya no está conectada.');
  const r = await ml.post(acc, '/answers', { question_id: Number(q.id), text });
  if (!r.ok) {
    const d = r.data || {};
    const msg = [d.message || d.error, Array.isArray(d.cause) ? d.cause.map(c => c.message || c.code || c).join(', ') : ''].filter(Boolean).join(' - ') || 'error ' + r.status;
    if (/answered|already/i.test(msg)) { await fetchOne(acc, q.id).catch(() => {}); throw new Error('Esa pregunta ya fue respondida (desde otro lado).'); }
    throw new Error('Mercado Libre no aceptó la respuesta: ' + msg);
  }
  q.status = 'ANSWERED'; q.answer = { text, date: now(), by: str(by, 40) }; q.updated_at = now();
  store.saveQuestions();
  return q;
}

// Otras preguntas del mismo comprador (en Mercado Libre y las que tenemos guardadas).
async function history(qid) {
  const q = items()[String(qid)];
  if (!q) throw new Error('No encontré esa pregunta.');
  const local = Object.values(items()).filter(x => x.from_id && x.from_id === q.from_id && x.id !== q.id);
  const acc = store.getAccount(q.account_id);
  if (acc && q.from_id) {
    const r = await ml.get(acc, `/questions/search?seller_id=${acc.user_id}&from=${q.from_id}&api_version=4&sort_fields=date_created&sort_types=DESC&limit=20`).catch(() => null);
    for (const x of (r && r.ok ? r.data.questions || [] : [])) {
      if (String(x.id) === q.id || local.some(l => l.id === String(x.id))) continue;
      if (x.from && String(x.from.id) !== q.from_id) continue; // por si Mercado Libre ignora el filtro
      local.push({ id: String(x.id), account: acc.nickname, item_id: x.item_id, text: x.text, date: x.date_created, status: x.status, answer: x.answer && x.answer.text ? { text: x.answer.text, date: x.answer.date_created } : null });
    }
  }
  // Títulos de las publicaciones que ya conocemos
  const titles = {}; for (const x of Object.values(items())) if (x.item && x.item.title) titles[x.item_id] = x.item.title;
  // ¿Ya nos compró? (ventas guardadas de ese comprador)
  const nick = String(q.from_nick || '').toUpperCase();
  const bought = nick ? store.getSales(new Date(Date.now() - 365 * 86400e3).toISOString().slice(0, 10), null).filter(s => String(s.buyer || '').toUpperCase() === nick && !s.cancelled).slice(-10).map(s => ({ date: s.date, title: s.title, gross: s.gross, account: s.account_nickname })) : [];
  return { questions: local.map(x => ({ ...x, item_title: titles[x.item_id] || '' })).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 30), bought };
}

function list() {
  const all = Object.values(items()).filter(q => !q.deleted && !['DELETED', 'BANNED', 'DISABLED'].includes(q.status)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { items: all, quick: Q().quick || [], last_sync: Q().last_sync || null, last_error: Q().last_error || '', webhook_at: Q().webhook_at || null };
}
function count() {
  const un = Object.values(items()).filter(q => q.status === 'UNANSWERED' && !q.deleted).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const l = un[0];
  return { unanswered: un.length, latest: l ? { id: l.id, text: l.text, account: l.account, date: l.date, title: (l.item || {}).title || '' } : null, by_account: un.reduce((o, q) => { o[q.account_id] = (o[q.account_id] || 0) + 1; return o; }, {}) };
}

// Respuestas rápidas
function saveQuick(list) {
  Q().quick = (Array.isArray(list) ? list : []).map(x => ({ id: x.id || crypto.randomBytes(4).toString('hex'), title: str(x.title, 40), text: str(x.text, MAX_ANSWER) })).filter(x => x.title && x.text).slice(0, 40);
  store.saveQuestions();
  return Q().quick;
}


// ---------- Aviso de preguntas demoradas ----------
// Si una pregunta lleva más de 5 minutos sin responder, avisa una vez a las compus/celulares con notificaciones.
const LATE_MIN = 5;
let lateBusy = false;
async function checkLate() {
  if (lateBusy) return 0;
  lateBusy = true;
  try {
    const lim = Date.now() - LATE_MIN * 60e3;
    const late = Object.values(items()).filter(q => q.status === 'UNANSWERED' && !q.deleted && !q.late_at && new Date(q.date).getTime() < lim)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!late.length) return 0;
    // Las que llevan más de un día no se avisan (son viejas, no "recién demoradas").
    const fresh = late.filter(q => Date.now() - new Date(q.date).getTime() < 24 * 3600e3);
    for (const q of late) q.late_at = now();
    store.saveQuestions();
    if (!fresh.length) return 0;
    const all = Object.values(items()).filter(q => q.status === 'UNANSWERED' && !q.deleted).length;
    const f = fresh[0], mins = Math.round((Date.now() - new Date(f.date).getTime()) / 60e3);
    await require('./push').send('questions', {
      title: `⏰ ${all === 1 ? 'Hay 1 pregunta sin responder' : `Hay ${all} preguntas sin responder`}`,
      body: `${f.account} · hace ${mins} min${f.item && f.item.title ? ' · ' + f.item.title : ''}\n${f.text}`,
      tag: 'qlate', url: '/#preguntas', icon: (f.item && f.item.thumb) || '/logo-icon.png', sticky: true,
    }).catch(e => console.log('Push demoradas:', e.message));
    return fresh.length;
  } finally { lateBusy = false; }
}

// ---------- Tiempo de respuesta ----------
// Trae de Mercado Libre las preguntas de los últimos días (todas las cuentas) con su respuesta. Se guarda 10 min.
const AR = 'America/Argentina/Buenos_Aires';
let statsCache = null;
async function statsRows(from) {
  // Hoy: datos de hace 2 minutos como mucho; períodos largos: 10 minutos.
  const maxAge = Date.now() - from < 2 * 86400e3 ? 2 * 60e3 : 10 * 60e3;
  if (statsCache && statsCache.from <= from && Date.now() - statsCache.at < maxAge) return statsCache;
  const rows = [], errors = [];
  for (const acc of store.getAccounts()) {
    if (acc.needs_reconnect) continue;
    try {
      for (let offset = 0; offset < 6000; offset += 50) {
        const r = await ml.get(acc, `/questions/search?seller_id=${acc.user_id}&api_version=4&sort_fields=date_created&sort_types=DESC&limit=50&offset=${offset}`);
        if (!r.ok) throw new Error(r.data?.message || 'error ' + r.status);
        const qs = r.data.questions || [];
        let old = false;
        for (const q of qs) {
          const d = new Date(q.date_created).getTime();
          if (d < from) { old = true; continue; }
          if (q.status === 'DELETED' || q.deleted_from_listing || q.status === 'BANNED') continue;
          rows.push({ acc: acc.nickname || String(acc.user_id), d, a: q.answer && q.answer.date_created ? new Date(q.answer.date_created).getTime() : null });
        }
        if (old || qs.length < 50) break;
      }
    } catch (e) { errors.push(`${acc.nickname || acc.user_id}: ${e.message}`); }
  }
  statsCache = { at: Date.now(), from, rows, errors };
  return statsCache;
}
// Hora y día de la semana en Argentina.
function arParts(t) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: AR, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return { dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), h: Number(p.hour) + Number(p.minute) / 60 };
}
function hoursCfg() {
  const c = Q().hours || {};
  return { from: c.from ?? 9, to: c.to ?? 18, days: Array.isArray(c.days) ? c.days : [1, 2, 3, 4, 5] };
}
function saveHours(b) {
  const n = (v, d) => (Number.isFinite(Number(v)) ? Math.min(24, Math.max(0, Number(v))) : d);
  const c = { from: n(b.from, 9), to: n(b.to, 18), days: (Array.isArray(b.days) ? b.days : [1, 2, 3, 4, 5]).map(Number).filter(d => d >= 0 && d <= 6) };
  if (c.to <= c.from) throw new Error('La hora de cierre tiene que ser después de la de apertura.');
  Q().hours = c; store.saveQuestions(); return c;
}
// Período: "today" (hoy), 7/15/30/60 (últimos días) o "AAAA-MM" (un mes). Fechas en hora de Argentina.
function periodRange(period) {
  const p = String(period || '30');
  const arMidnight = (y, m, d) => new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00-03:00`).getTime();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: AR }).split('-').map(Number);
  if (p === 'today') return { from: arMidnight(...today), to: Date.now(), label: 'hoy' };
  const m = p.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]);
    if (mo < 1 || mo > 12) throw new Error('Mes inválido.');
    const from = arMidnight(y, mo, 1), to = mo === 12 ? arMidnight(y + 1, 1, 1) : arMidnight(y, mo + 1, 1);
    if (from > Date.now()) throw new Error('Ese mes todavía no empezó.');
    const name = new Date(from + 12 * 3600e3).toLocaleDateString('es-AR', { month: 'long', year: 'numeric', timeZone: AR });
    return { from, to: Math.min(to, Date.now()), label: name };
  }
  const days = [7, 15, 30, 60].includes(Number(p)) ? Number(p) : 30;
  return { from: Date.now() - days * 86400e3, to: Date.now(), label: `últimos ${days} días` };
}
async function stats(period, account) {
  const rg = periodRange(period);
  const base = await statsRows(rg.from), cfg = hoursCfg();
  const rows = base.rows.filter(r => r.d >= rg.from && r.d < rg.to && (!account || r.acc === account));
  const blank = () => ({ n: 0, ans: 0, sum: 0, list: [] });
  const add = (g, r) => { g.n++; if (r.a) { const m = Math.max(0, (r.a - r.d) / 60e3); g.ans++; g.sum += m; g.list.push(m); } };
  const tot = blank(), work = blank(), off = blank(), byDay = Array.from({ length: 7 }, () => ({ all: blank(), work: blank(), off: blank() })), byAcc = {};
  for (const r of rows) {
    const { dow, h } = arParts(r.d), isWork = cfg.days.includes(dow) && h >= cfg.from && h < cfg.to;
    add(tot, r); add(isWork ? work : off, r);
    add(byDay[dow].all, r); add(isWork ? byDay[dow].work : byDay[dow].off, r);
    add(byAcc[r.acc] = byAcc[r.acc] || blank(), r);
  }
  const out = (g) => { const l = g.list.sort((a, b) => a - b); return { questions: g.n, answered: g.ans, avg_min: g.ans ? Math.round(g.sum / g.ans) : null, median_min: l.length ? Math.round(l[Math.floor(l.length / 2)]) : null, within_1h: l.length ? Math.round(l.filter(m => m <= 60).length / l.length * 100) : null }; };
  const pending = Object.values(items()).filter(q => q.status === 'UNANSWERED' && !q.deleted);
  const oldest = pending.reduce((m, q) => Math.min(m, new Date(q.date).getTime()), Infinity);
  return {
    period: String(period || '30'), label: rg.label, hours: cfg, updated_at: new Date(base.at).toISOString(), errors: base.errors,
    accounts: [...new Set(base.rows.map(r => r.acc))].sort(),
    total: out(tot), work: out(work), off: out(off),
    by_day: [1, 2, 3, 4, 5, 6, 0].map(d => ({ dow: d, all: out(byDay[d].all), work: out(byDay[d].work), off: out(byDay[d].off) })),
    by_account: Object.entries(byAcc).map(([acc, g]) => ({ account: acc, ...out(g) })).sort((a, b) => b.questions - a.questions),
    pending: pending.length, oldest_min: pending.length ? Math.round((Date.now() - oldest) / 60e3) : null,
  };
}

module.exports = { checkLate, stats, saveHours, hoursCfg, onNotify, fetchOne, syncAll, answer, history, list, count, saveQuick, MAX_ANSWER, markWebhook: () => { Q().webhook_at = now(); } };
