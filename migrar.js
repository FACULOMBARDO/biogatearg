// Pasa los datos de la PC (carpeta data/) a la base de Vercel (Upstash Redis + Vercel Blob).
// Uso (en la carpeta del panel):  node migrar.js
// Antes, agregá al archivo .env las 3 claves que te da Vercel:
//   KV_REST_API_URL=...   KV_REST_API_TOKEN=...   BLOB_READ_WRITE_TOKEN=...
const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ask = (q) => new Promise(r => { process.stdout.write(q); process.stdin.once('data', d => r(String(d).trim())); });

(async () => {
  const kv = require('./lib/kv');
  if (!kv.enabled) throw new Error('Faltan KV_REST_API_URL y KV_REST_API_TOKEN en el archivo .env (copialas de Vercel → Storage → tu base Upstash → .env.local).');
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Falta BLOB_READ_WRITE_TOKEN en el archivo .env (Vercel → Storage → tu Blob store → .env.local).');
  const file = path.join(DATA_DIR, 'db.json');
  if (!fs.existsSync(file)) throw new Error('No encontré ' + file);
  const db = JSON.parse(fs.readFileSync(file, 'utf8'));

  const existing = await kv.cmd('HLEN', 'fx:ver');
  if (existing && !process.argv.includes('--forzar')) {
    const a = await ask('La base de Vercel ya tiene datos. ¿Reemplazarlos con los de esta PC? (escribí SI): ');
    if (a.toUpperCase() !== 'SI') { console.log('Cancelado. No se cambió nada.'); process.exit(0); }
  }

  const files = require('./lib/files');
  const up = async (rel, type) => {
    const f = path.join(DATA_DIR, rel);
    if (!fs.existsSync(f)) return null;
    return files.put(rel.replace(/\\/g, '/'), fs.readFileSync(f), type);
  };
  let n = 0;
  // Logo
  const LOGO = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };
  for (const [ext, type] of Object.entries(LOGO)) {
    const r = await up('logo.' + ext, type);
    if (r) { db.settings = db.settings || {}; db.settings.logo_ref = { ...r, type }; n++; console.log('Logo subido.'); break; }
  }
  // Recibos / presupuestos
  for (const q of db.quotes || []) {
    if (!q.token) continue;
    const r = await up(path.join('presupuestos', q.token + '.pdf'), 'application/pdf');
    if (r) { q.pdf_ref = r; n++; }
  }
  console.log(`Recibos subidos: ${(db.quotes || []).filter(q => q.pdf_ref).length}`);
  // Manuales (de la planilla y subidos a mano)
  const docs = [...(db.manuals?.items || []).flatMap(it => it.docs || []), ...(db.manual_uploads || [])].filter(d => d.file);
  let k = 0;
  for (const d of docs) {
    k++;
    process.stdout.write(`\rManuales: ${k} de ${docs.length}…`);
    try { const r = await up(path.join('manuales', d.file), d.type); if (r) { d.blob_url = r.url; n++; } } catch (e) { console.log(`\n  ${d.file}: ${e.message}`); }
  }
  if (docs.length) console.log('');

  console.log('Guardando la base de datos en Upstash…');
  const store = require('./lib/store');
  await store.importAll(db);
  const parts = await kv.cmd('HLEN', 'fx:ver');
  console.log(`Listo: ${Object.keys(db.sales || {}).length} ventas, ${(db.scans || []).length} envíos, ${Object.keys(db.accounts || {}).length} cuentas, ${n} archivos. (${parts} partes en la base)`);
  console.log('Ahora abrí el panel en Vercel: ya tiene todo.');
  console.log('IMPORTANTE: desde ahora usá solo el panel de Vercel (si seguís usando el de la PC, las cuentas de Mercado Libre se pueden desconectar).');
  process.exit(0);
})().catch(e => { console.error('\nError:', e.message); process.exit(1); });
