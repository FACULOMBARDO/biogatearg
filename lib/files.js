// Archivos (manuales, PDF de recibos, logo).
// - En la PC: carpeta data/.
// - En Vercel: Vercel Blob (almacenamiento público con links imposibles de adivinar).
const fs = require('fs');
const path = require('path');
const store = require('./store');

const BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
let sdk = null;
const blob = () => sdk || (sdk = require('@vercel/blob'));

// Guarda y devuelve una referencia: { key } en la PC, { key, url } en Vercel.
async function put(key, buf, contentType) {
  if (!BLOB) {
    const f = path.join(store.DATA_DIR, key);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, buf);
    return { key };
  }
  const r = await blob().put(key, buf, { access: 'public', contentType: contentType || 'application/octet-stream', addRandomSuffix: true });
  return { key, url: r.url };
}
// Ruta local del archivo (solo en la PC).
const localPath = (ref) => (ref && ref.key && !BLOB ? path.join(store.DATA_DIR, ref.key) : null);
const exists = (ref) => !!ref && (BLOB ? !!ref.url : fs.existsSync(path.join(store.DATA_DIR, ref.key || '')));
async function remove(ref) {
  if (!ref) return;
  try {
    if (BLOB) { if (ref.url) await blob().del(ref.url); }
    else if (ref.key) fs.unlinkSync(path.join(store.DATA_DIR, ref.key));
  } catch { /* ya no estaba */ }
}
// Manda el archivo al navegador (en Vercel, redirige al link del archivo).
function send(res, ref, { type, name, download } = {}) {
  if (BLOB) {
    let u = ref.url;
    if (download) u += (u.includes('?') ? '&' : '?') + 'download=1';
    res.setHeader('Cache-Control', 'no-cache');
    return res.redirect(302, u);
  }
  if (type) res.setHeader('Content-Type', type);
  if (name) res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${name.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.sendFile(path.resolve(store.DATA_DIR, ref.key));
}
// Lee el contenido (para procesarlo en el servidor).
async function read(ref) {
  if (!BLOB) return fs.readFileSync(path.join(store.DATA_DIR, ref.key));
  const r = await fetch(ref.url);
  if (!r.ok) throw new Error('No se pudo leer el archivo (' + r.status + ')');
  return Buffer.from(await r.arrayBuffer());
}

module.exports = { BLOB, put, remove, send, read, exists, localPath };
