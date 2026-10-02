// Manuales y fichas técnicas: se leen de la pestaña MANUALES de Google Sheets (con los links
// que están dentro de cada celda) y se guarda una copia de cada archivo en la PC.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const store = require('./store');
const files = require('./files');
const { deadline, CUT_MSG } = require('./bg');

const DEFAULT_URL = 'https://docs.google.com/spreadsheets/d/1kKs4BJd1ddUJuVZhtptbMSD6NSV7XI2J5xZW0yQppWQ/edit?usp=sharing';
const DEFAULT_TAB = 'MANUALES';
const DIR = path.join(store.DATA_DIR, 'manuales');
try { fs.mkdirSync(DIR, { recursive: true }); } catch { /* en Vercel los archivos van a Vercel Blob */ }
const docRef = (d) => (d && d.file ? { key: 'manuales/' + d.file, url: d.blob_url } : null);
const KEEP = (p) => ({ file: p.file, blob_url: p.blob_url, type: p.type, size: p.size, saved_at: p.saved_at });

const cfg = () => { const s = store.getSettings(); return { url: s.manuals_sheet_url || DEFAULT_URL, tab: s.manuals_tab || DEFAULT_TAB }; };
const sheetId = (u) => (String(u).match(/\/d\/([a-zA-Z0-9_-]+)/) || [])[1];

// ---------- Lector mínimo de .xlsx (zip + xml), sin librerías ----------
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('El archivo de Google Sheets no es un Excel válido.');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let k = 0; k < n; k++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(off + 26), lelen = buf.readUInt16LE(off + 28);
    const data = buf.slice(off + 30 + lnlen + lelen, off + 30 + lnlen + lelen + csize);
    files[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    p += 46 + nlen + elen + clen;
  }
  return files;
}
const unxml = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`)); return m ? unxml(m[1]) : null; };
const colIdx = (ref) => { const l = ref.replace(/\d+/g, ''); let n = 0; for (const c of l) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };

// Devuelve las filas de la pestaña pedida como [{ text, link }] por celda.
function readSheet(buf, tabName) {
  const f = unzip(buf);
  const txt = (n) => (f[n] ? f[n].toString('utf8') : '');
  const wb = txt('xl/workbook.xml');
  const sheets = [...wb.matchAll(/<sheet\b[^>]*\/?>/g)].map(m => ({ name: attr(m[0], 'name'), rid: attr(m[0], 'r:id') }));
  const want = sheets.find(s => s.name && s.name.trim().toUpperCase() === tabName.trim().toUpperCase()) || sheets.find(s => /manual/i.test(s.name || ''));
  if (!want) throw new Error(`No encontré la pestaña "${tabName}" en la planilla (hay: ${sheets.map(s => s.name).join(', ')}).`);
  const rels = txt('xl/_rels/workbook.xml.rels');
  const relT = [...rels.matchAll(/<Relationship\b[^>]*\/?>/g)].map(m => m[0]).find(r => attr(r, 'Id') === want.rid);
  let target = attr(relT || '', 'Target') || '';
  target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  const sx = txt(target);
  // Textos compartidos
  const shared = [...txt('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
  // Links de celda (hyperlinks + relaciones de la hoja)
  const srel = txt(target.replace(/worksheets\/(.*)$/, 'worksheets/_rels/$1.rels'));
  const relUrl = {};
  for (const m of srel.matchAll(/<Relationship\b[^>]*\/?>/g)) relUrl[attr(m[0], 'Id')] = attr(m[0], 'Target');
  const links = {};
  for (const m of sx.matchAll(/<hyperlink\b[^>]*\/?>/g)) {
    const ref = attr(m[0], 'ref'), rid = attr(m[0], 'r:id');
    if (ref && rid && relUrl[rid]) for (const r of ref.split(/[\s:]/)) links[r] = relUrl[rid];
  }
  const rows = [];
  for (const rm of sx.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr('<c ' + cm[1], 'r'); if (!ref) continue;
      const type = attr('<c ' + cm[1], 't'), inner = cm[2] || '';
      const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1], fml = (inner.match(/<f[^>]*>([\s\S]*?)<\/f>/) || [])[1];
      let text = type === 's' ? shared[+v] : type === 'inlineStr' ? unxml([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')) : v != null ? unxml(v) : '';
      let link = links[ref] || null;
      if (fml && /HYPERLINK/i.test(fml)) { const fm = unxml(fml).match(/HYPERLINK\(\s*"([^"]+)"\s*(?:[,;]\s*"([^"]*)")?/i); if (fm) { link = link || fm[1]; if (!text && fm[2]) text = fm[2]; } }
      cells[colIdx(ref)] = { text: String(text || '').trim(), link };
    }
    rows.push(cells);
  }
  return { rows, tab: want.name };
}

// ---------- Links de Drive → descarga directa ----------
function downloadUrl(u) {
  const s = String(u || '');
  let m;
  if ((m = s.match(/docs\.google\.com\/document\/d\/([\w-]+)/))) return `https://docs.google.com/document/d/${m[1]}/export?format=pdf`;
  if ((m = s.match(/docs\.google\.com\/presentation\/d\/([\w-]+)/))) return `https://docs.google.com/presentation/d/${m[1]}/export/pdf`;
  if ((m = s.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/))) return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=pdf`;
  if ((m = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([\w-]+)/))) return `https://drive.usercontent.google.com/download?id=${m[1]}&export=download&confirm=t`;
  if (/drive\.google\.com\/drive\/folders\//.test(s)) return null;
  return /^https?:\/\//.test(s) ? s : null;
}
const EXT = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };

async function fetchBuf(url) {
  const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 BiogatePanel' }, signal: AbortSignal.timeout(90000) });
  const buf = Buffer.from(await r.arrayBuffer());
  return { ok: r.ok, status: r.status, type: (r.headers.get('content-type') || '').split(';')[0].trim(), buf, disp: r.headers.get('content-disposition') || '' };
}
function sniff(buf, type) {
  if (buf.slice(0, 4).toString() === '%PDF') return 'application/pdf';
  if (buf[0] === 0x89 && buf.slice(1, 4).toString() === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return type;
}

// Convierte las filas en productos: categoría (fila sin documentos y sin números) → SKU → documentos.
function toItems(rows) {
  const items = [];
  let cat = '';
  const seen = new Map();
  rows.forEach((cells, i) => {
    const first = (cells[0] && cells[0].text) || '';
    const docs = cells.slice(1).filter(c => c && (c.text || c.link)).map(c => ({ title: c.text || 'Documento', url: c.link || '' }));
    if (cells[0] && cells[0].link && !docs.length) docs.push({ title: first, url: cells[0].link });
    if (!first) return;
    if (i === 0 && /^(sku|c[oó]digo|producto|modelo)$/i.test(first)) return; // encabezado
    if (!docs.length && !/\d/.test(first) && first === first.toUpperCase() && first.length > 3) { cat = first.replace(/\s+/g, ' ').trim(); return; }
    const sku = first.replace(/\s+/g, ' ').trim();
    const key = sku.toUpperCase().replace(/\s+/g, '');
    let it = seen.get(key);
    if (!it) { it = { id: crypto.createHash('md5').update(key).digest('hex').slice(0, 10), sku, category: cat, docs: [] }; seen.set(key, it); items.push(it); }
    if (!it.category && cat && docs.length) { it.category = cat; items.splice(items.indexOf(it), 1); items.push(it); } // queda en el orden de su categoría
    for (const d of docs) if (!it.docs.some(x => x.url === d.url && x.title === d.title)) it.docs.push({ ...d, id: crypto.createHash('md5').update(key + '|' + d.title + '|' + d.url).digest('hex').slice(0, 12) });
  });
  return items;
}

let job = { running: false }, lastRun = Promise.resolve();
const status = () => ({ ...job, errors: (job.errors || []).slice(0, 20) });

function sync({ force = false } = {}) {
  if (job.running) return false;
  job = { running: true, phase: 'Leyendo la planilla de manuales…', total: 0, done: 0, errors: [], started_at: new Date().toISOString() };
  const until = deadline();
  lastRun = require('./bg').bg((async () => {
    try {
      const { url, tab } = cfg();
      const id = sheetId(url);
      if (!id) throw new Error('El link de la planilla de manuales no parece de Google Sheets.');
      const x = await fetchBuf(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`);
      if (!x.ok || x.buf.slice(0, 2).toString() !== 'PK') throw new Error(`Google Sheets no dejó bajar la planilla (${x.status}). Compartila como "Cualquier persona con el enlace: Lector".`);
      const sheet = readSheet(x.buf, tab);
      const items = toItems(sheet.rows);
      const old = {};
      for (const it of (store.getManuals().items || [])) for (const d of it.docs) old[d.id] = d;
      const docs = items.flatMap(it => it.docs);
      job.total = docs.length; job.phase = 'Bajando los archivos…';
      let next = 0;
      const worker = async () => {
        while (next < docs.length) {
          const d = docs[next++];
          const prev = old[d.id];
          if (!force && prev && prev.file && prev.url === d.url && files.exists(docRef(prev))) { Object.assign(d, KEEP(prev)); job.done++; continue; }
          if (Date.now() > until) { job.cut = true; if (prev && prev.file) Object.assign(d, KEEP(prev), { stale: true }); else d.pending = true; continue; }
          const dl = downloadUrl(d.url);
          if (!d.url) d.error = 'La celda no tiene link.';
          else if (!dl) d.error = 'El link es una carpeta de Drive o no se puede bajar: poné el link del archivo.';
          else {
            try {
              const r = await fetchBuf(dl);
              const type = sniff(r.buf, r.type);
              if (!r.ok) d.error = `Drive respondió ${r.status}. Compartí el archivo como "Cualquier persona con el enlace".`;
              else if (/text\/html/.test(type)) d.error = 'Drive pidió iniciar sesión: compartí el archivo como "Cualquier persona con el enlace".';
              else {
                const ext = EXT[type] || 'bin';
                d.file = `${d.id}.${ext}`; d.type = type; d.size = r.buf.length; d.saved_at = new Date().toISOString();
                const saved = await files.put('manuales/' + d.file, r.buf, type); if (saved.url) d.blob_url = saved.url;
                if (prev && prev.blob_url && prev.blob_url !== d.blob_url) files.remove(docRef(prev));
                delete d.error;
              }
            } catch (e) { d.error = `No se pudo bajar: ${e.message}`; }
          }
          if (d.error) { job.errors.push(`${d.title}: ${d.error}`); if (prev && prev.file && files.exists(docRef(prev))) Object.assign(d, KEEP(prev), { stale: true }); }
          job.done++;
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      store.saveManuals({ items, tab: sheet.tab, updated_at: new Date().toISOString(), error: '', partial: !!job.cut });
      job.phase = job.cut ? 'Faltan archivos' : 'Listo';
      if (job.cut) job.errors.unshift(CUT_MSG);
    } catch (e) { job.phase = 'Error'; job.errors.push(e.message); store.saveManuals({ ...store.getManuals(), error: e.message }); }
    job.running = false; job.finished_at = new Date().toISOString();
    await store.flush();
  })());
  return true;
}

// ---------- Manuales subidos a mano ----------
const skuKey = (x) => String(x || '').toUpperCase().replace(/\s+/g, '');
async function addUpload({ sku, title, category, name, buf }) {
  sku = String(sku || '').trim(); title = String(title || '').trim();
  if (!sku) throw new Error('Poné el SKU.');
  if (!buf || !buf.length) throw new Error('El archivo está vacío.');
  const type = sniff(buf, '');
  if (!EXT[type]) throw new Error('Solo se pueden subir PDF o imágenes (JPG, PNG, WEBP).');
  const id = crypto.randomBytes(6).toString('hex');
  const file = `${id}.${EXT[type]}`;
  const saved = await files.put('manuales/' + file, buf, type);
  const u = { id, sku: sku.slice(0, 80), title: (title || String(name || 'Documento').replace(/\.[a-z0-9]+$/i, '')).slice(0, 120), category: String(category || '').trim().toUpperCase().slice(0, 60),
    file, blob_url: saved.url, type, size: buf.length, saved_at: new Date().toISOString(), uploaded: true };
  store.getManualUploads().push(u); store.saveManualUploads();
  return u;
}
function editUpload(id, f) {
  const u = store.getManualUploads().find(x => x.id === id);
  if (!u) throw new Error('No encontré ese archivo.');
  if (f.sku !== undefined) { const v = String(f.sku).trim(); if (!v) throw new Error('Poné el SKU.'); u.sku = v.slice(0, 80); }
  if (f.title !== undefined) u.title = String(f.title).trim().slice(0, 120) || u.title;
  if (f.category !== undefined) u.category = String(f.category).trim().toUpperCase().slice(0, 60);
  store.saveManualUploads(); return u;
}
function deleteUpload(id) {
  const list = store.getManualUploads(), i = list.findIndex(x => x.id === id);
  if (i < 0) throw new Error('No encontré ese archivo.');
  files.remove(docRef(list[i]));
  list.splice(i, 1); store.saveManualUploads();
}
// Lista combinada: planilla + subidos (los subidos se suman al producto con el mismo SKU).
function combined() {
  const items = (store.getManuals().items || []).map(it => ({ ...it, docs: it.docs.map(d => ({ ...d })) }));
  const byKey = new Map(items.map(it => [skuKey(it.sku), it]));
  for (const u of store.getManualUploads()) {
    let it = byKey.get(skuKey(u.sku));
    if (!it) { it = { id: 'u' + u.id, sku: u.sku, category: u.category, docs: [] }; byKey.set(skuKey(u.sku), it); items.push(it); }
    if (!it.category && u.category) it.category = u.category;
    it.docs.push({ id: u.id, title: u.title, url: '', file: u.file, blob_url: u.blob_url, type: u.type, size: u.size, saved_at: u.saved_at, uploaded: true, category: u.category });
  }
  return items;
}
function findDoc(docId) {
  for (const it of combined()) for (const d of it.docs) if (d.id === docId) return { item: it, doc: d };
  return null;
}
// Archivo subido directo del navegador a Vercel Blob (para archivos grandes).
const EXT_BY_NAME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
function addBlobUpload({ sku, title, category, name, url, size }) {
  sku = String(sku || '').trim(); title = String(title || '').trim();
  if (!sku) throw new Error('Poné el SKU.');
  let host = ''; try { host = new URL(url).hostname; } catch { /* inválido */ }
  if (!/\.blob\.vercel-storage\.com$/.test(host) && host !== process.env.BLOB_TEST_HOST) throw new Error('Link de archivo inválido.');
  const ext = (String(name || url).match(/\.([a-z0-9]+)(?:$|\?)/i) || [])[1] || '';
  const type = EXT_BY_NAME[ext.toLowerCase()];
  if (!type) throw new Error('Solo se pueden subir PDF o imágenes (JPG, PNG, WEBP).');
  const id = crypto.randomBytes(6).toString('hex');
  const u = { id, sku: sku.slice(0, 80), title: (title || String(name || 'Documento').replace(/\.[a-z0-9]+$/i, '')).slice(0, 120), category: String(category || '').trim().toUpperCase().slice(0, 60),
    file: `${id}.${EXT[type]}`, blob_url: url, type, size: Number(size) || 0, saved_at: new Date().toISOString(), uploaded: true };
  store.getManualUploads().push(u); store.saveManualUploads();
  return u;
}
const filePath = (d) => (d && d.file ? path.join(DIR, d.file) : null);

module.exports = { lastRun: () => lastRun, sync, status, findDoc, filePath, docRef, addBlobUpload, combined, addUpload, editUpload, deleteUpload, DEFAULT_URL, DEFAULT_TAB, readSheet, toItems, downloadUrl, unzip };
