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

module.exports = { onNotify, fetchOne, syncAll, answer, history, list, count, saveQuick, MAX_ANSWER, markWebhook: () => { Q().webhook_at = now(); } };
