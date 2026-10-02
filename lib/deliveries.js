// Envíos por mensajería que no vienen de Mercado Libre: presupuestos (recibos) y pedidos de la web
// marcados "con envío". Se muestran en Envíos Flex con el mismo esquema de zonas y costos.
const store = require('./store');
const zones = require('./zones');

const dateIso = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? new Date(d + 'T12:00:00-03:00').toISOString() : new Date().toISOString());
const itemsText = (items) => (items || []).map(i => `${i.qty > 1 ? i.qty + 'x ' : ''}${i.name || i.sku}`).join(' · ');

function cleanShip(b, prev = {}) {
  const s = (v, n) => String(v ?? '').trim().slice(0, n);
  const zone = b.zone === undefined ? (prev.zone_manual || '') : (zones.ZONES[b.zone] ? b.zone : '');
  return {
    on: true, name: s(b.name ?? prev.name, 80),
    address: s(b.address ?? prev.address, 160), city: s(b.city ?? prev.city, 80), state: s(b.state ?? prev.state, 60), zip: s(b.zip ?? prev.zip, 12),
    date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : (prev.date || new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)),
    zone_manual: zone, phone: s(b.phone ?? prev.phone, 30), note: s(b.note ?? prev.note, 200), messages: prev.messages,
  };
}

// Presupuestos / recibos con envío
function setQuoteShip(id, body) {
  const q = store.getQuote(id);
  if (!q) throw new Error('No encontré ese presupuesto.');
  if (body.on === false) { store.saveQuote({ id: q.id, ship: { ...(q.ship || {}), on: false } }); return null; }
  const ship = cleanShip(body, q.ship || {});
  store.saveQuote({ id: q.id, ship });
  return ship;
}
// Pedidos web con envío por mensajería
function setWebShip(id, body) {
  const w = store.getWoo();
  const o = (w.orders || {})[String(id)];
  if (!o) throw new Error('No encontré ese pedido.');
  w.ship = w.ship || {};
  if (body.on === false) { if (w.ship[o.id]) w.ship[o.id].on = false; store.upsertWoo([]); return null; }
  const prev = w.ship[o.id] || { address: o.address, city: o.city, state: o.state, zip: o.zip, phone: o.phone, date: o.date ? new Date(new Date(o.date) - 3 * 3600e3).toISOString().slice(0, 10) : undefined };
  w.ship[o.id] = cleanShip(body, prev);
  store.upsertWoo([]);
  return w.ship[o.id];
}

// Lista en el mismo formato que los envíos escaneados.
function extra() {
  const out = [];
  for (const q of store.getQuotes()) {
    const sh = q.ship; if (!sh || !sh.on) continue;
    const t = dateIso(sh.date);
    out.push({ shipment_id: 'P-' + q.id, order_id: `Recibo Nº ${q.number}`, first_name: sh.name || q.client, ref_id: q.id, ref_kind: 'quote', label_date: sh.date, phone: sh.phone || q.whatsapp || '', address: sh.address, city: sh.city, state: sh.state, zip: sh.zip,
      comment: sh.note || '', items: itemsText(q.items), scanned_at: t, sale_date: t, first_scanned_at: t, scan_count: 0, source: 'presupuesto', origin: 'Recibo', account_nickname: 'Recibo',
      zone_manual: sh.zone_manual || undefined, sale_url: '#presupuestos', total: q.total, messages: sh.messages || [] });
  }
  const w = store.getWoo();
  for (const [id, sh] of Object.entries(w.ship || {})) {
    const o = (w.orders || {})[id]; if (!o || !sh.on) continue;
    const t = dateIso(sh.date);
    out.push({ shipment_id: 'W-' + id, order_id: `Web #${o.number}`, first_name: sh.name || o.customer, ref_id: id, ref_kind: 'web', label_date: sh.date, phone: sh.phone || o.phone || '', email: o.email || '', address: sh.address, city: sh.city, state: sh.state, zip: sh.zip,
      comment: sh.note || '', items: itemsText(o.items), scanned_at: t, sale_date: t, first_scanned_at: t, scan_count: 0, source: 'web', origin: 'Web', account_nickname: 'Web',
      zone_manual: sh.zone_manual || undefined, sale_url: '#web', total: o.total, messages: sh.messages || [] });
  }
  return out;
}
const isExtra = (id) => /^[PW]-\d+$/.test(String(id));
function ref(id) {
  const [k, n] = String(id).split('-');
  if (k === 'P') { const q = store.getQuote(n); return q && q.ship ? { ship: q.ship, save: () => store.saveQuote({ id: q.id, ship: q.ship }) } : null; }
  const w = store.getWoo(); const sh = (w.ship || {})[n];
  return sh ? { ship: sh, save: () => store.upsertWoo([]) } : null;
}
function setZone(id, zone) { const r = ref(id); if (!r) return false; r.ship.zone_manual = zones.ZONES[zone] ? zone : ''; r.save(); return true; }
function setPhone(id, phone) { const r = ref(id); if (!r) return false; r.ship.phone = phone; r.save(); return true; }
function remove(id) { const r = ref(id); if (!r) return false; r.ship.on = false; r.save(); return true; }
function walog(id, entry) { const r = ref(id); if (!r) return false; r.ship.messages = [...(r.ship.messages || []), entry].slice(-20); r.save(); return true; }
function get(id) { return extra().find(x => x.shipment_id === id) || null; }

module.exports = { extra, setQuoteShip, setWebShip, isExtra, setZone, setPhone, remove, walog, get };
