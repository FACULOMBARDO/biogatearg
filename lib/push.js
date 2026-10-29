// Notificaciones push al escritorio (y al celular): llegan aunque el panel esté cerrado,
// mientras el navegador esté abierto o corriendo en segundo plano.
const crypto = require('crypto');
const webpush = require('web-push');
const store = require('./store');

const P = () => store.getPush();
// Claves VAPID: se crean solas la primera vez y quedan guardadas en la base.
function keys() {
  const p = P();
  if (!p.vapid || !p.vapid.publicKey) { p.vapid = webpush.generateVAPIDKeys(); store.savePush(); }
  return p.vapid;
}
const publicKey = () => keys().publicKey;

function subscribe(sub, label, topics) {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw new Error('Suscripción inválida.');
  if (!/^https:\/\//.test(sub.endpoint)) throw new Error('Suscripción inválida.');
  const p = P(), list = p.subs || (p.subs = []);
  const id = crypto.createHash('sha1').update(sub.endpoint).digest('hex').slice(0, 16);
  const cur = list.find(s => s.id === id);
  const t = { questions: true, refill: true, ...(cur ? cur.topics : {}), ...(topics || {}) };
  const rec = { id, endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) }, label: String(label || '').slice(0, 80), topics: t, created_at: cur ? cur.created_at : new Date().toISOString() };
  if (cur) Object.assign(cur, rec); else list.push(rec);
  if (list.length > 30) list.splice(0, list.length - 30);
  store.savePush();
  return rec;
}
function unsubscribe(endpoint) {
  const p = P();
  p.subs = (p.subs || []).filter(s => s.endpoint !== endpoint);
  store.savePush();
}
function find(endpoint) { return (P().subs || []).find(s => s.endpoint === endpoint) || null; }

// Manda a todos los suscriptos a ese tema. Los que ya no existen se borran solos.
async function send(topic, payload, onlyEndpoint) {
  const subs = (P().subs || []).filter(s => (onlyEndpoint ? s.endpoint === onlyEndpoint : s.topics[topic] !== false));
  if (!subs.length) return { sent: 0 };
  const k = keys();
  const base = (process.env.BASE_URL || '').replace(/\/$/, '');
  webpush.setVapidDetails(base.startsWith('https://') ? base : 'mailto:panel@biogate.local', k.publicKey, k.privateKey);
  const body = JSON.stringify(payload);
  let sent = 0, gone = [];
  await Promise.all(subs.map(s => webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, { TTL: 6 * 3600, urgency: 'high' })
    .then(() => { sent++; })
    .catch(e => { if (e.statusCode === 404 || e.statusCode === 410) gone.push(s.endpoint); else console.log('Push:', e.statusCode || '', e.body || e.message); })));
  if (gone.length) { P().subs = (P().subs || []).filter(s => !gone.includes(s.endpoint)); store.savePush(); }
  return { sent, removed: gone.length };
}

module.exports = { publicKey, subscribe, unsubscribe, find, send };
