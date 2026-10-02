// Conexión con la API oficial de Mercado Libre.
const store = require('./store');

const API = process.env.ML_API_BASE || 'https://api.mercadolibre.com';
const AUTH = process.env.ML_AUTH_BASE || 'https://auth.mercadolibre.com.ar';
const CLIENT_ID = process.env.ML_CLIENT_ID;
const CLIENT_SECRET = process.env.ML_CLIENT_SECRET;

function redirectUri() {
  return `${process.env.BASE_URL.replace(/\/$/, '')}/auth/callback`;
}

function authUrl(state) {
  const p = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: redirectUri(), state });
  return `${AUTH}/authorization?${p}`;
}

async function tokenRequest(params) {
  const r = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Error de token (${r.status}): ${data.message || data.error || 'desconocido'}`);
  return data;
}

// Canjea el "code" de la autorización por tokens y guarda la cuenta.
async function connectAccount(code) {
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
  const acc = {
    user_id: String(t.user_id),
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: Date.now() + (t.expires_in || 21600) * 1000,
    connected_at: new Date().toISOString(),
  };
  try {
    const me = await rawGet('/users/me', acc.access_token);
    if (me.ok) acc.nickname = me.data.nickname;
  } catch { /* no es crítico */ }
  store.saveAccount(acc);
  return acc;
}

// Candado entre copias (solo Vercel). Devuelve 'fresh' si otra copia ya renovó, o un candado para liberar.
async function remoteLock(acc) {
  if (!store.REMOTE) return null;
  const kv = require('./kv');
  const key = 'fx:lock:refresh:' + acc.user_id, me = Math.random().toString(36).slice(2);
  const fresh = async () => { await store.sync({ force: true }); const cur = store.getAccount(acc.user_id); if (cur && cur.expires_at > (acc.expires_at || 0) && cur.expires_at - Date.now() > 10 * 60e3) { Object.assign(acc, cur); return true; } if (cur && cur !== acc) Object.assign(acc, cur); return false; };
  for (let i = 0; i < 40; i++) {
    if (await kv.cmd('SET', key, me, 'NX', 'PX', 25000) === 'OK') {
      if (await fresh()) { await kv.cmd('DEL', key); return 'fresh'; }
      return { release: async () => { if (await kv.cmd('GET', key) === me) await kv.cmd('DEL', key); } };
    }
    await new Promise(r => setTimeout(r, 700));
    if (await fresh()) return 'fresh';
  }
  throw new Error('No se pudo renovar el permiso de Mercado Libre (otra copia del panel lo está renovando). Probá de nuevo.');
}

// Renueva el permiso (dura 6 h). Una sola renovación a la vez por cuenta: el refresh token es de un solo uso.
const refreshing = new Map();
function refresh(acc) {
  if (refreshing.has(acc.user_id)) return refreshing.get(acc.user_id);
  const p = (async () => {
    const name = acc.nickname || acc.user_id;
    if (!acc.refresh_token) {
      acc.needs_reconnect = true;
      acc.reconnect_reason = 'Mercado Libre no entregó "refresh token". Activá "Refresh Token" en tu aplicación de developers y volvé a conectar la cuenta.';
      store.saveAccount(acc);
      throw new Error(`La cuenta ${name} perdió la conexión: ${acc.reconnect_reason}`);
    }
    // En Vercel puede haber varias copias del panel andando: solo una renueva por vez y las demás usan el permiso nuevo.
    const lock = await remoteLock(acc);
    if (lock === 'fresh') return acc;
    try {
      const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: acc.refresh_token });
      acc.access_token = t.access_token;
      if (t.refresh_token) acc.refresh_token = t.refresh_token; // el refresh token es de un solo uso
      acc.expires_at = Date.now() + (t.expires_in || 21600) * 1000;
      delete acc.needs_reconnect; delete acc.reconnect_reason;
      store.saveAccount(acc);
      if (lock) { await store.flush(); await lock.release(); }
      return acc;
    } catch (e) {
      acc.needs_reconnect = true;
      acc.reconnect_reason = /grant_type/i.test(e.message)
        ? 'Tu aplicación de Mercado Libre no tiene activado "Refresh Token". Activalo en developers y volvé a conectar la cuenta.'
        : 'Mercado Libre rechazó la renovación del permiso (' + e.message + '). Volvé a conectar la cuenta.';
      store.saveAccount(acc);
      if (lock) { await store.flush(); await lock.release(); }
      throw new Error(`La cuenta ${name} perdió la conexión: ${acc.reconnect_reason}`);
    }
  })().finally(() => refreshing.delete(acc.user_id));
  refreshing.set(acc.user_id, p);
  return p;
}

async function rawReq(method, path, token, headers = {}, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}
const rawGet = (path, token, headers) => rawReq('GET', path, token, headers);

// Llamada autenticada, renovando el token si hace falta.
async function req(acc, method, path, headers, body) {
  if (!acc.expires_at || acc.expires_at - Date.now() < 5 * 60 * 1000) await refresh(acc);
  let res = await rawReq(method, path, acc.access_token, headers, body);
  if (res.status === 401) {
    await refresh(acc);
    res = await rawReq(method, path, acc.access_token, headers, body);
  }
  return res;
}
const get = (acc, path, headers) => req(acc, 'GET', path, headers);
const post = (acc, path, body) => req(acc, 'POST', path, {}, body);

// El QR de la etiqueta Flex suele ser un JSON tipo
// {"id":"41234567890","sender_id":123456,"hash_code":"...","security_digit":"0"}
// pero aceptamos también el número de envío solo o cualquier texto que lo contenga.
function parseQR(raw) {
  const s = String(raw || '').trim();
  let id = null, senderId = null;
  try {
    const o = JSON.parse(s);
    if (o && typeof o === 'object') {
      id = o.id ?? o.shipment_id ?? o.shipmentId ?? null;
      senderId = o.sender_id ?? o.senderId ?? null;
    }
  } catch { /* no es JSON */ }
  if (!id) {
    const m = s.match(/\d{8,}/);
    if (m) id = m[0];
  }
  return { shipmentId: id ? String(id) : null, senderId: senderId ? String(senderId) : null };
}

// Mercado Libre a veces devuelve datos tapados, ej: "XXXXXXX".
const isMasked = (v) => { const t = String(v ?? '').trim(); return !t || /^[\sXx*#.\-]+$/.test(t) || /XXX/i.test(t); };

// Junta todos los teléfonos que aparezcan en cualquier parte de una respuesta de la API.
function findPhones(obj, where, out = [], depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return out;
  for (const [k, v] of Object.entries(obj)) {
    const path = `${where}.${k}`;
    if (/phone|telefono|tel$/i.test(k)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const num = [v.area_code, v.number].filter(Boolean).join('');
        if (num) out.push({ where: path, value: String(num), masked: isMasked(num) });
      } else if (v !== null && v !== undefined && String(v).trim() !== '') {
        out.push({ where: path, value: String(v), masked: isMasked(v) });
      }
    }
    if (v && typeof v === 'object') findPhones(v, path, out, depth + 1);
  }
  return out;
}

const pick = (...v) => { for (const x of v) if (x !== undefined && x !== null && String(x).trim() !== '') return String(x).trim(); return ''; };

function parseBilling(data) {
  const out = {};
  if (!data) return out;
  // Formato viejo: { billing_info: { doc_type, doc_number, additional_info: [{type, value}] } }
  const bi = data.billing_info || {};
  for (const it of bi.additional_info || []) out[String(it.type).toUpperCase()] = it.value;
  if (bi.doc_number) out.DOC_NUMBER = out.DOC_NUMBER || bi.doc_number;
  if (bi.doc_type) out.DOC_TYPE = out.DOC_TYPE || bi.doc_type;
  // Formato nuevo: { buyer: { billing_info: { name, last_name, identification: {type, number} } } }
  const nb = data.buyer?.billing_info;
  if (nb) {
    out.FIRST_NAME = out.FIRST_NAME || nb.name || nb.first_name;
    out.LAST_NAME = out.LAST_NAME || nb.last_name;
    out.DOC_NUMBER = out.DOC_NUMBER || nb.identification?.number;
    out.DOC_TYPE = out.DOC_TYPE || nb.identification?.type;
  }
  return out;
}

// Busca todos los datos de un envío escaneado.
// opts.onlyFlex: devuelve null si el envío no es Flex. opts.skipStatuses: estados a saltear (ej. entregados).
async function lookup(raw, opts = {}) {
  const { shipmentId, senderId } = parseQR(raw);
  if (!shipmentId) throw Object.assign(new Error('No encontré un número de envío en el QR.'), { code: 'BAD_QR' });

  const accounts = store.getAccounts();
  if (!accounts.length) throw Object.assign(new Error('No hay ninguna cuenta de Mercado Libre conectada.'), { code: 'NO_ACCOUNT' });

  // Primero la cuenta del vendedor que figura en el QR; si no, probamos todas.
  const ordered = [...accounts].sort((a, b) => (b.user_id === senderId) - (a.user_id === senderId));
  let acc = null, sh = null, lastStatus = null;
  for (const a of ordered) {
    const r = await get(a, `/shipments/${shipmentId}`);
    if (r.ok) { acc = a; sh = r.data; break; }
    lastStatus = r.status;
  }
  if (!sh) {
    const msg = lastStatus === 404
      ? `El envío ${shipmentId} no existe.`
      : `El envío ${shipmentId} no pertenece a ninguna cuenta conectada (o no hay permiso para verlo).`;
    throw Object.assign(new Error(msg), { code: 'NOT_FOUND', shipmentId });
  }
  if (opts.onlyFlex && pick(sh.logistic_type, sh.logistic?.type) !== 'self_service') return null;
  if (opts.skipStatuses && opts.skipStatuses.includes(sh.status)) return null;

  // Pedimos también el formato nuevo de envíos, que puede traer datos que el viejo tapa.
  const shNewRes = await get(acc, `/shipments/${shipmentId}`, { 'x-format-new': 'true' }).catch(() => null);
  const shNew = shNewRes?.ok ? shNewRes.data : {};

  const ra = sh.receiver_address || shNew.destination?.shipping_address || sh.destination?.shipping_address || {};
  const dest = shNew.destination || sh.destination || {};
  const receiverName = pick(ra.receiver_name, dest.receiver_name);

  let orderId = pick(sh.order_id, sh.orders?.[0]?.id);
  if (!orderId) {
    const it = await get(acc, `/shipments/${shipmentId}/items`).catch(() => null);
    if (it?.ok && Array.isArray(it.data)) orderId = pick(it.data[0]?.order_id);
  }

  let order = null, billing = {};
  if (orderId) {
    const o = await get(acc, `/orders/${orderId}`).catch(() => null);
    if (o?.ok) order = o.data;
    const b = await get(acc, `/orders/${orderId}/billing_info`).catch(() => null);
    if (b?.ok) billing = parseBilling(b.data);
  }
  const buyer = order?.buyer || {};

  // Nombre y apellido: facturación > comprador > quien recibe.
  const [rFirst, ...rRest] = receiverName.split(/\s+/);
  const firstName = pick(billing.FIRST_NAME, buyer.first_name, rFirst);
  const lastName = pick(billing.LAST_NAME, buyer.last_name, rRest.join(' '));
  // Teléfono: el primero que no venga tapado, buscando en todas las respuestas.
  const phones = [
    ...findPhones(shNew, 'envio_nuevo'),
    ...findPhones(sh, 'envio'),
    ...findPhones(order || {}, 'venta'),
  ];
  const goodPhone = phones.find(p => !p.masked);
  const phone = goodPhone ? goodPhone.value : (phones[0]?.value || '');

  const address = pick(ra.address_line, [ra.street_name, ra.street_number].filter(Boolean).join(' '));

  return {
    shipment_id: String(shipmentId),
    order_id: orderId || '',
    pack_id: pick(order?.pack_id),
    // Detalle de la venta en Mercado Libre (si la venta es parte de un carrito, se usa el número de paquete).
    sale_url: (pick(order?.pack_id) || orderId) ? `https://www.mercadolibre.com.ar/ventas/${pick(order?.pack_id) || orderId}/detalle` : '',
    account_id: acc.user_id,
    account_nickname: acc.nickname || '',
    first_name: firstName,
    last_name: lastName,
    receiver_name: receiverName,
    phone,
    phone_hidden: !goodPhone && phones.length > 0,
    email: pick(buyer.email),
    doc: pick(billing.DOC_NUMBER) ? `${pick(billing.DOC_TYPE)} ${billing.DOC_NUMBER}`.trim() : '',
    nickname: pick(buyer.nickname),
    buyer_id: pick(buyer.id),
    address,
    neighborhood: pick(ra.neighborhood?.name),
    city: pick(ra.city?.name),
    state: pick(ra.state?.name),
    zip: pick(ra.zip_code),
    comment: pick(ra.comment),
    items: (order?.order_items || []).map(i => `${i.quantity || 1}x ${i.item?.title || ''}`.trim()).join(' | '),
    logistic_type: pick(sh.logistic_type, sh.logistic?.type),
    status: pick(sh.status),
    // Fecha y hora de la venta en Mercado Libre (la que se muestra en el panel).
    sale_date: pick(order?.date_created, order?.date_closed, sh.date_created),
    scanned_at: new Date().toISOString(),
  };
}


// ---------- Importación ----------
// Número de venta (16 dígitos) -> número de envío.
async function shipmentFromOrder(orderId) {
  for (const a of store.getAccounts()) {
    const r = await get(a, `/orders/${orderId}`);
    if (r.ok) {
      const sid = pick(r.data.shipping?.id);
      if (!sid) throw new Error(`La venta ${orderId} no tiene envío.`);
      return JSON.stringify({ id: sid, sender_id: a.user_id });
    }
  }
  throw new Error(`La venta ${orderId} no pertenece a ninguna cuenta conectada.`);
}

// Lista los envíos de las ventas de los últimos "days" días de una cuenta.
async function recentShipments(acc, days) {
  const from = new Date(Date.now() - days * 86400000);
  from.setHours(0, 0, 0, 0);
  const fromStr = from.toISOString().replace('Z', '-00:00');
  const out = new Set();
  for (let offset = 0; offset < 2000; offset += 50) {
    const r = await get(acc, `/orders/search?seller=${acc.user_id}&order.date_created.from=${encodeURIComponent(fromStr)}&sort=date_desc&limit=50&offset=${offset}`);
    if (!r.ok) throw new Error(`No pude listar las ventas de ${acc.nickname || acc.user_id}: ${r.data?.message || r.status}`);
    for (const o of r.data.results || []) {
      if (o.status === 'cancelled') continue;
      const sid = pick(o.shipping?.id);
      if (sid) out.add(sid);
    }
    if (offset + 50 >= (r.data.paging?.total || 0)) break;
  }
  return [...out].map(id => JSON.stringify({ id, sender_id: acc.user_id }));
}

// ---------- Mensajería post venta (API oficial) ----------
// Reglas de Mercado Libre: máximo 350 caracteres; si el comprador todavía no escribió,
// el vendedor inicia la conversación con el motivo "OTHER" (mensajería guiada).
const MAX_MSG = 350;
const errText = (r) => {
  const d = r?.data || {};
  const cause = Array.isArray(d.cause) ? d.cause.map(c => c.message || c.code || c).join(', ') : (d.cause?.message || '');
  return [d.message || d.error, cause].filter(Boolean).join(' - ') || `error ${r?.status}`;
};

async function sendMessage(scan, text) {
  const acc = store.getAccount(scan.account_id) || store.getAccounts()[0];
  if (!acc) throw new Error('No hay cuenta conectada.');
  text = String(text || '').trim();
  if (!text) throw new Error('El mensaje está vacío.');
  if (text.length > MAX_MSG) throw new Error(`El mensaje tiene ${text.length} caracteres (máximo ${MAX_MSG}).`);

  let packId = scan.pack_id, buyerId = scan.buyer_id;
  if ((!packId || !buyerId) && scan.order_id) {
    const o = await get(acc, `/orders/${scan.order_id}`);
    if (o.ok) { packId = packId || pick(o.data.pack_id); buyerId = buyerId || pick(o.data.buyer?.id); }
  }
  packId = packId || scan.order_id;
  if (!packId) throw new Error('No encontré la venta de este envío.');

  // ¿El comprador ya escribió? Entonces la conversación está abierta y se puede responder libre.
  let open = false;
  const conv = await get(acc, `/messages/packs/${packId}/sellers/${acc.user_id}?tag=post_sale&mark_as_read=false`);
  if (conv.ok) {
    const msgs = conv.data.messages || [];
    open = msgs.some(m => String(m.from?.user_id) !== String(acc.user_id));
    if (conv.data.conversation_status?.status === 'blocked') {
      throw new Error('Mercado Libre bloqueó la conversación de esta venta' + (conv.data.conversation_status.substatus ? ` (${conv.data.conversation_status.substatus})` : '') + '.');
    }
  }

  const direct = () => post(acc, `/messages/packs/${packId}/sellers/${acc.user_id}?tag=post_sale`,
    { from: { user_id: Number(acc.user_id) }, to: { user_id: Number(buyerId) }, text });
  const guided = () => post(acc, `/messages/action_guide/packs/${packId}/option?tag=post_sale`, { option_id: 'OTHER', text });

  let r = open && buyerId ? await direct() : await guided();
  if (!r.ok && buyerId) {
    // Si un camino falla, probamos el otro.
    const r2 = open ? await guided() : await direct();
    if (r2.ok) r = r2; else throw new Error(errText(r) + (r2.status !== r.status ? ` / ${errText(r2)}` : ''));
  }
  if (!r.ok) throw new Error(errText(r));
  return { pack_id: packId, buyer_id: buyerId, via: open ? 'conversación' : 'inicio guiado' };
}

// Para diagnóstico: devuelve las respuestas crudas de la API.
async function debug(shipmentId) {
  const out = { TELEFONOS_ENCONTRADOS: [] };
  for (const a of store.getAccounts()) {
    const sh = await get(a, `/shipments/${shipmentId}`);
    out[a.user_id] = { shipment: sh };
    if (sh.ok) {
      out[a.user_id].shipment_formato_nuevo = await get(a, `/shipments/${shipmentId}`, { 'x-format-new': 'true' });
      const orderId = sh.data.order_id;
      if (orderId) {
        out[a.user_id].order = await get(a, `/orders/${orderId}`);
        out[a.user_id].billing_info = await get(a, `/orders/${orderId}/billing_info`);
      }
      out[a.user_id].items = await get(a, `/shipments/${shipmentId}/items`);
      const r = out[a.user_id];
      out.TELEFONOS_ENCONTRADOS = [
        ...findPhones(r.shipment_formato_nuevo?.data, 'envio_nuevo'),
        ...findPhones(r.shipment?.data, 'envio'),
        ...findPhones(r.order?.data, 'venta'),
      ];
      break;
    }
  }
  return out;
}

// Completa la fecha de venta de registros cargados antes de esta versión.
async function saleDateFor(scan) {
  const acc = store.getAccount(scan.account_id) || store.getAccounts()[0];
  if (!acc || !scan.order_id) return null;
  const r = await get(acc, `/orders/${scan.order_id}`);
  return r.ok ? pick(r.data.date_created, r.data.date_closed) : null;
}

module.exports = { authUrl, connectAccount, lookup, parseQR, debug, sendMessage, MAX_MSG, shipmentFromOrder, recentShipments, saleDateFor, get, rawReq, pick };
