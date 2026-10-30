// Reclamos de Mercado Libre de todas las cuentas: abiertos (y los que te toca responder) y cerrados.
const store = require('./store');
const ml = require('./ml');

const CLOSED_DAYS = 120; // cerrados: los de los últimos 4 meses
const { get, pick } = ml;
const C = () => store.getClaims();
const items = () => C().items || (C().items = {});
const now = () => new Date().toISOString();
const str = (v, n) => String(v ?? '').trim().slice(0, n);

async function pool(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; await fn(list[k]); } }));
}
async function getRetry(acc, path) {
  let r = null;
  for (let i = 0; i < 4; i++) {
    r = await get(acc, path).catch(e => ({ ok: false, status: 0, data: { message: e.message } }));
    if (r.ok || (r.status && r.status !== 429 && r.status < 500)) return r;
    await new Promise(ok => setTimeout(ok, 800 * 2 ** i));
  }
  return r;
}
const errMsg = (r) => (r && r.data && (r.data.message || r.data.error)) || 'error ' + (r && r.status);

// Busca reclamos de una cuenta (donde la cuenta es la que responde: el vendedor).
async function search(acc, status, untilTs) {
  const out = [];
  let withPlayer = true;
  for (let offset = 0; offset < 3000; offset += 30) {
    const q = `status=${status}&limit=30&offset=${offset}&sort=date_created:desc` + (withPlayer ? `&player_role=respondent&player_user_id=${acc.user_id}` : '');
    let r = await getRetry(acc, `/post-purchase/v1/claims/search?${q}`);
    if (!r.ok && withPlayer && r.status === 400) { withPlayer = false; offset -= 30; continue; } // por si ML no acepta el filtro de rol
    if (!r.ok) throw new Error(errMsg(r));
    const list = r.data.data || r.data.results || [];
    let old = false;
    for (const c of list) {
      if (untilTs && new Date(c.date_created).getTime() < untilTs) { old = true; continue; }
      out.push(c);
    }
    const total = (r.data.paging && r.data.paging.total) || 0;
    if (old || list.length < 30 || offset + 30 >= total) break;
  }
  return out;
}

const STAGE = { claim: 'Reclamo', dispute: 'Mediación', recontact: 'Recontacto', none: '', stale: 'Vencido' };
const TYPE = { mediations: 'Reclamo', returns: 'Devolución', fulfillment: 'Full', ml_case: 'Caso ML', cancel_sale: 'Cancelación', cancel_purchase: 'Cancelación de compra', change: 'Cambio', service: 'Servicio' };

async function reasonName(acc, id) {
  if (!id) return '';
  const rs = C().reasons || (C().reasons = {});
  if (rs[id] !== undefined) return rs[id];
  const r = await getRetry(acc, `/post-purchase/v1/claims/reasons/${id}`);
  rs[id] = r && r.ok ? str(pick(r.data.detail, r.data.name, r.data.description), 200) : '';
  return rs[id];
}

// Guarda el resumen del reclamo y, si cambió, trae los detalles (venta, mensajes, motivo).
async function upsert(acc, c) {
  const id = String(c.id), cur = items()[id] || {};
  const me = (c.players || []).find(p => p.role === 'respondent' && String(p.user_id) === String(acc.user_id)) || (c.players || []).find(p => p.role === 'respondent') || {};
  const actions = (me.available_actions || []).map(a => ({ action: a.action, mandatory: !!a.mandatory, due: a.due_date || null }));
  const due = actions.map(a => a.due).filter(Boolean).sort()[0] || null;
  const base = {
    ...cur, id, account_id: String(acc.user_id), account: acc.nickname || String(acc.user_id),
    status: c.status, stage: c.stage || '', stage_label: STAGE[c.stage] ?? c.stage ?? '', type: c.type || '', type_label: TYPE[c.type] || c.type || '',
    reason_id: c.reason_id || '', resource: c.resource || '', resource_id: String(c.resource_id || ''),
    date: c.date_created, updated: c.last_updated || c.date_created, actions, due,
    resolution: c.resolution ? { reason: c.resolution.reason || '', date: c.resolution.date_created || c.resolution.date || '', benefited: [].concat(c.resolution.benefited || []).join(', ') } : null,
    has_mediator: (c.players || []).some(p => p.role === 'mediator'),
  };
  const changed = cur.updated !== base.updated || !cur.detail_at;
  items()[id] = base;
  if (!changed) return base;
  // Detalles
  base.reason = await reasonName(acc, base.reason_id).catch(() => '');
  if (base.resource_id && (base.resource === 'order' || !base.resource)) {
    const o = await getRetry(acc, `/orders/${base.resource_id}`);
    if (o && o.ok) {
      base.order_id = String(pick(o.data.pack_id) || o.data.id);
      base.buyer = pick(o.data.buyer?.nickname);
      base.title = (o.data.order_items || []).map(i => `${i.quantity || 1}x ${i.item?.title || ''}`.trim()).join(' | ');
      base.amount = o.data.total_amount || 0;
      base.thumb = '';
      const itemId = o.data.order_items?.[0]?.item?.id;
      if (itemId && !base.thumb) { const it = await getRetry(acc, `/items/${itemId}?attributes=secure_thumbnail,thumbnail`); if (it && it.ok) base.thumb = it.data.secure_thumbnail || it.data.thumbnail || ''; }
    }
  }
  if (base.status === 'opened') {
    const m = await getRetry(acc, `/post-purchase/v1/claims/${id}/messages`);
    const msgs = m && m.ok ? (Array.isArray(m.data) ? m.data : m.data.messages || m.data.data || []) : [];
    msgs.sort((a, b) => String(a.date_created).localeCompare(String(b.date_created)));
    base.messages = msgs.slice(-6).map(x => ({ from: x.sender_role || '', text: str(x.message || x.text, 600), date: x.date_created }));
    base.msg_count = msgs.length;
    const r = await getRetry(acc, `/post-purchase/v1/claims/${id}/affects-reputation`);
    base.affects_rep = r && r.ok ? (r.data.affects_reputation === true || r.data.affects_reputation === 'affected' ? true : r.data.affects_reputation === false || r.data.affects_reputation === 'not_affected' ? false : null) : null;
  }
  base.detail_at = now();
  return base;
}

// ¿Te toca responder? Abierto y: hay una acción obligatoria tuya, o el último mensaje es del comprador o del mediador.
function needsReply(c) {
  if (c.status !== 'opened') return false;
  if ((c.actions || []).some(a => a.mandatory)) return true;
  const last = (c.messages || [])[c.messages ? c.messages.length - 1 : 0];
  if (last) return last.from !== 'respondent';
  return (c.actions || []).some(a => /message/.test(a.action));
}

let syncing = null;
function sync() {
  if (syncing) return syncing;
  syncing = (async () => {
    const errors = [], seen = new Set(), since = Date.now() - CLOSED_DAYS * 86400e3;
    await pool(store.getAccounts(), 2, async (acc) => {
      if (acc.needs_reconnect) { errors.push(`${acc.nickname || acc.user_id}: hay que volver a conectar la cuenta`); return; }
      try {
        const list = [...await search(acc, 'opened'), ...await search(acc, 'closed', since)];
        await pool(list, 3, async (c) => { seen.add(String(c.id)); await upsert(acc, c).catch(e => errors.push(`${acc.nickname}: reclamo ${c.id}: ${e.message}`)); });
      } catch (e) { errors.push(`${acc.nickname || acc.user_id}: ${e.message}`); }
    });
    // Los abiertos que ya no aparecen se cerraron: se marcan como cerrados. Los cerrados viejos se borran.
    for (const c of Object.values(items())) {
      if (!seen.has(c.id) && c.status === 'opened' && !errors.length) c.status = 'closed';
      if (c.status === 'closed' && new Date(c.date).getTime() < since) delete items()[c.id];
    }
    C().last_sync = now(); C().last_error = errors.join(' · ');
    store.saveClaims();
    return { ok: !errors.length, errors };
  })().finally(() => { syncing = null; });
  return syncing;
}

function list() {
  const all = Object.values(items()).map(c => ({ ...c, needs_reply: needsReply(c) }))
    .sort((a, b) => (b.needs_reply - a.needs_reply) || (a.status === 'opened' ? 0 : 1) - (b.status === 'opened' ? 0 : 1) || String(a.due || '9').localeCompare(String(b.due || '9')) || String(b.date).localeCompare(String(a.date)));
  return { items: all, last_sync: C().last_sync || null, last_error: C().last_error || '' };
}
function count() {
  const all = Object.values(items());
  return { opened: all.filter(c => c.status === 'opened').length, to_reply: all.filter(needsReply).length };
}

module.exports = { sync, list, count, needsReply };
