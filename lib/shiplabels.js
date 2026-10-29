// Impresión de etiquetas: junta los envíos listos para despachar de todas las cuentas de Mercado Libre
// y baja sus etiquetas oficiales (las mismas que da ML) en un solo PDF.
const store = require('./store');
const ml = require('./ml');
const files = require('./files');

const DAYS = 30; // ventas de los últimos 30 días (las listas para despachar siempre son recientes)
const { get, pick } = ml;

const TYPE = { self_service: 'Flex', cross_docking: 'Colecta', xd_drop_off: 'Places / Drop off', drop_off: 'Correo / Drop off', fulfillment: 'Full' };

// Corre "fn" sobre la lista con "n" a la vez.
async function pool(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; await fn(list[k], k); } }));
}

// Pide a Mercado Libre reintentando si está saturado (muchas consultas juntas devuelven 429).
async function getRetry(acc, path) {
  let r = null;
  for (let i = 0; i < 5; i++) {
    r = await get(acc, path).catch(e => ({ ok: false, status: 0, data: { message: e.message } }));
    if (r.ok || (r.status && r.status !== 429 && r.status < 500)) return r;
    await new Promise(ok => setTimeout(ok, 800 * 2 ** i));
  }
  return r;
}

async function forAccount(acc) {
  const from = new Date(Date.now() - DAYS * 86400e3).toISOString().replace('Z', '-00:00');
  const byShip = new Map();
  const diag = { account: acc.nickname || String(acc.user_id), orders: 0, shipments: 0, states: {}, failed: [] };
  for (let offset = 0; offset < 3000; offset += 50) {
    const r = await getRetry(acc, `/orders/search?seller=${acc.user_id}&order.date_created.from=${encodeURIComponent(from)}&sort=date_desc&limit=50&offset=${offset}`);
    if (!r.ok) throw new Error(r.data?.message || 'error ' + r.status);
    for (const o of r.data.results || []) {
      diag.orders++;
      const tags = o.tags || [];
      if (o.status === 'cancelled' || tags.includes('delivered')) continue; // canceladas o ya entregadas: no se despachan
      const sid = pick(o.shipping?.id);
      if (!sid) continue;
      const cur = byShip.get(String(sid)) || { orders: [], items: [] };
      cur.orders.push(String(o.id));
      cur.pack_id = cur.pack_id || pick(o.pack_id);
      cur.date = cur.date || o.date_created;
      cur.buyer = cur.buyer || pick(o.buyer?.nickname);
      for (const i of o.order_items || []) cur.items.push(`${i.quantity || 1}x ${i.item?.title || ''}`.trim());
      byShip.set(String(sid), cur);
    }
    if (offset + 50 >= (r.data.paging?.total || 0)) break;
  }
  const out = [];
  diag.shipments = byShip.size;
  await pool([...byShip.keys()], 3, async (sid) => {
    const r = await getRetry(acc, `/shipments/${sid}`);
    if (!r || !r.ok) { diag.failed.push(`${sid} (${r?.data?.message || 'error ' + r?.status})`); return; }
    const sh = r.data, type = pick(sh.logistic_type, sh.logistic?.type);
    const k = `${type || '?'} · ${sh.status || '?'}${sh.substatus ? ' / ' + sh.substatus : ''}`;
    diag.states[k] = (diag.states[k] || 0) + 1;
    if (sh.status !== 'ready_to_ship' || type === 'fulfillment') return;
    if (!['ready_to_print', 'printed'].includes(sh.substatus)) return; // p. ej. falta la factura: ML todavía no da la etiqueta
    const o = byShip.get(sid);
    out.push({
      account_id: String(acc.user_id), account: acc.nickname || String(acc.user_id), shipment_id: sid,
      order_id: o.pack_id || o.orders[0], date: o.date, buyer: o.buyer || '', items: o.items.join(' | '),
      type, type_label: TYPE[type] || type || '', printed: sh.substatus === 'printed',
      city: pick(sh.receiver_address?.city?.name), state: pick(sh.receiver_address?.state?.name),
      deadline: pick(sh.shipping_option?.estimated_handling_limit?.date),
    });
  });
  return { out, diag };
}

// Envíos listos para despachar de todas las cuentas.
async function list() {
  const items = [], errors = [], diag = [];
  await pool(store.getAccounts(), 3, async (acc) => {
    if (acc.needs_reconnect) { errors.push(`${acc.nickname || acc.user_id}: hay que volver a conectar la cuenta`); return; }
    try {
      const r = await forAccount(acc);
      items.push(...r.out); diag.push(r.diag);
      if (r.diag.failed.length) errors.push(`${r.diag.account}: no pude revisar ${r.diag.failed.length} ${r.diag.failed.length === 1 ? 'envío' : 'envíos'} (Mercado Libre no respondió). Tocá Actualizar.`);
    } catch (e) { errors.push(`${acc.nickname || acc.user_id}: ${e.message}`); }
  });
  items.sort((a, b) => String(a.deadline || a.date).localeCompare(String(b.deadline || b.date)));
  return { items, errors, diag };
}

// Baja las etiquetas (de a 50 por cuenta) y las une en un solo PDF. Mercado Libre las marca como impresas.
async function pdf(sel) {
  const { PDFDocument } = require('pdf-lib');
  const groups = {};
  for (const x of Array.isArray(sel) ? sel : []) {
    const a = String(x.account_id || ''), s = String(x.shipment_id || '').replace(/\D/g, '');
    if (a && s) (groups[a] = groups[a] || new Set()).add(s);
  }
  if (!Object.keys(groups).length) throw new Error('No elegiste ninguna etiqueta.');
  const out = await PDFDocument.create();
  const errors = [];
  let count = 0;
  for (const [accId, set] of Object.entries(groups)) {
    const acc = store.getAccount(accId);
    if (!acc) { errors.push(`La cuenta ${accId} ya no está conectada.`); continue; }
    const ids = [...set], parts = [];
    for (let i = 0; i < ids.length; i += 50) parts.push(ids.slice(i, i + 50));
    while (parts.length) {
      const part = parts.shift();
      const r = await ml.getRaw(acc, `/shipment_labels?shipment_ids=${part.join(',')}&response_type=pdf&savePdf=Y`).catch(e => ({ ok: false, status: 0, buf: Buffer.from(e.message) }));
      if (!r.ok || r.buf.slice(0, 4).toString() !== '%PDF') {
        // Si falla un grupo, se prueba de a una para no perder las que sí están listas.
        if (part.length > 1) { parts.unshift(...part.map(id => [id])); continue; }
        let msg = ''; try { const d = JSON.parse(r.buf.toString()); msg = [d.message || d.error, Array.isArray(d.cause) ? d.cause.map(c => c.message || c.code || c).join(', ') : ''].filter(Boolean).join(' - '); } catch { msg = 'error ' + r.status; }
        errors.push(`${acc.nickname || accId}: Mercado Libre no dio la etiqueta del envío ${part[0]} (${msg || 'error ' + r.status})`);
        continue;
      }
      const doc = await PDFDocument.load(r.buf, { ignoreEncryption: true });
      for (const pg of await out.copyPages(doc, doc.getPageIndices())) out.addPage(pg);
      count += part.length;
    }
  }
  if (!count) throw new Error(errors.join(' · ') || 'No se pudo bajar ninguna etiqueta.');
  const buf = Buffer.from(await out.save());
  // Se guarda el último PDF (el anterior se borra) y se devuelve el link para descargarlo.
  const st = store.getSettings();
  if (st.ship_labels_ref) await files.remove(st.ship_labels_ref);
  const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 16).replace(/[: ]/g, '-');
  const ref = await files.put(`etiquetas-envio/Etiquetas-${stamp}.pdf`, buf, 'application/pdf');
  store.saveSettings({ ship_labels_ref: ref });
  return { count, errors, ref, name: `Etiquetas ${stamp}.pdf` };
}

module.exports = { list, pdf };
