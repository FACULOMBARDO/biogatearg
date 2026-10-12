// Tareas del equipo: encargados, estado (sin revisar / en proceso / terminada), fecha límite opcional,
// fotos, archivos, links y comentarios.
const crypto = require('crypto');
const store = require('./store');
const files = require('./files');

const STATUS = ['new', 'doing', 'done'];
const PRIO = ['baja', 'media', 'alta'];
const COLORS = ['#0ea5e9', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#eab308', '#14b8a6', '#ec4899', '#6366f1', '#84cc16'];
const id = () => crypto.randomBytes(6).toString('hex');
const now = () => new Date().toISOString();
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const T = () => store.getTasks();

function people() { return T().people || (T().people = []); }
function savePeople(list) {
  const old = people();
  const out = [];
  for (const p of Array.isArray(list) ? list : []) {
    const name = str(p.name, 40);
    if (!name) continue;
    const prev = old.find(x => x.id === p.id);
    out.push({ id: prev ? prev.id : id(), name, color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : (prev && prev.color) || COLORS[(old.length + out.length) % COLORS.length], active: p.active !== false });
  }
  T().people = out; store.saveTasks();
  return out;
}

// Adjuntos: { id, kind: 'photo'|'file'|'link', name, type, size, ref } o { id, kind: 'link', url, name }.
function cleanAtt(a) {
  if (!a || typeof a !== 'object') return null;
  if (a.kind === 'link') {
    let u = str(a.url, 1000);
    if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
    try { new URL(u); } catch { return null; }
    return { id: a.id || id(), kind: 'link', url: u, name: str(a.name, 120) };
  }
  if (!a.ref || !(a.ref.key || a.ref.url)) return null;
  // Solo archivos de tareas: nada de rutas raras ni links de otros sitios.
  const key = String(a.ref.key || '');
  if (!files.BLOB && (!key.startsWith('tareas/') || key.includes('..'))) return null;
  if (a.ref.url) { let h = ''; try { h = new URL(a.ref.url).hostname; } catch { /* inválido */ } if (!/\.blob\.vercel-storage\.com$/.test(h) && h !== process.env.BLOB_TEST_HOST) return null; }
  if (files.BLOB && !a.ref.url) return null;
  return { id: a.id || id(), kind: a.kind === 'photo' ? 'photo' : 'file', name: str(a.name, 160) || 'archivo', type: str(a.type, 100), size: Number(a.size) || 0, ref: { key: str(a.ref.key, 300), ...(a.ref.url ? { url: str(a.ref.url, 1000) } : {}) } };
}
const cleanAtts = (list) => (Array.isArray(list) ? list : []).map(cleanAtt).filter(Boolean).slice(0, 40);

function fields(b, t = {}) {
  const out = {};
  if (b.title !== undefined) out.title = str(b.title, 200);
  if (b.detail !== undefined) out.detail = str(b.detail, 4000);
  if (b.assignee !== undefined) out.assignee = people().some(p => p.id === b.assignee) ? b.assignee : '';
  if (b.due !== undefined) out.due = /^\d{4}-\d{2}-\d{2}$/.test(b.due || '') ? b.due : '';
  if (b.due_time !== undefined) out.due_time = /^\d{2}:\d{2}$/.test(b.due_time || '') ? b.due_time : '';
  if (out.due === '') out.due_time = '';
  if (b.priority !== undefined) out.priority = PRIO.includes(b.priority) ? b.priority : 'media';
  return out;
}

function list() { return T().items; }
function get(tid) { return list().find(t => t.id === tid); }

function create(b) {
  const f = fields(b);
  if (!f.title) throw new Error('Escribí qué hay que hacer.');
  const t = { id: id(), title: '', detail: '', assignee: '', due: '', due_time: '', priority: 'media', ...f,
    status: STATUS.includes(b.status) ? b.status : 'new', attachments: cleanAtts(b.attachments), comments: [],
    history: [{ at: now(), by: str(b.by, 40), what: 'creó la tarea' }], created_at: now(), created_by: str(b.by, 40), updated_at: now() };
  if (t.status === 'done') t.done_at = now();
  list().unshift(t); store.saveTasks();
  return t;
}

const ST_NAME = { new: 'Sin revisar', doing: 'En proceso', done: 'Terminada' };
function update(tid, b) {
  const t = get(tid);
  if (!t) throw new Error('La tarea ya no existe.');
  const f = fields(b, t);
  if (f.title === '') throw new Error('Escribí qué hay que hacer.');
  const by = str(b.by, 40);
  if (f.assignee !== undefined && f.assignee !== t.assignee) t.history.push({ at: now(), by, what: 'cambió el encargado a ' + ((people().find(p => p.id === f.assignee) || {}).name || 'nadie') });
  Object.assign(t, f);
  if (b.status !== undefined && STATUS.includes(b.status) && b.status !== t.status) {
    t.history.push({ at: now(), by, what: `pasó a ${ST_NAME[b.status]}` });
    t.status = b.status;
    if (b.status === 'done') t.done_at = now(); else delete t.done_at;
  }
  if (Array.isArray(b.add_attachments)) t.attachments.push(...cleanAtts(b.add_attachments));
  t.updated_at = now();
  if (t.history.length > 60) t.history = t.history.slice(-60);
  store.saveTasks();
  return t;
}

async function removeAtt(tid, aid) {
  const t = get(tid);
  if (!t) throw new Error('La tarea ya no existe.');
  const a = t.attachments.find(x => x.id === aid);
  if (!a) return t;
  t.attachments = t.attachments.filter(x => x.id !== aid);
  t.updated_at = now(); store.saveTasks();
  if (a.ref) await files.remove(a.ref);
  return t;
}

function comment(tid, b) {
  const t = get(tid);
  if (!t) throw new Error('La tarea ya no existe.');
  const text = str(b.text, 2000), atts = cleanAtts(b.attachments);
  if (!text && !atts.length) throw new Error('Escribí algo o adjuntá una foto.');
  const c = { id: id(), at: now(), by: str(b.by, 40), text, attachments: atts };
  t.comments.push(c); t.updated_at = now(); store.saveTasks();
  return t;
}

async function remove(tid) {
  const t = get(tid);
  if (!t) return;
  T().items = list().filter(x => x.id !== tid); store.saveTasks();
  const refs = [...t.attachments, ...t.comments.flatMap(c => c.attachments || [])].filter(a => a.ref).map(a => a.ref);
  for (const r of refs) await files.remove(r);
}

// Busca un adjunto (de la tarea o de un comentario) para mostrarlo.
function findAtt(aid) {
  for (const t of list()) for (const a of [...t.attachments, ...t.comments.flatMap(c => c.attachments || [])]) if (a.id === aid) return a;
  return null;
}

// Archivo subido al servidor (en la PC, o en Vercel si es chico).
const SAFE = (n) => String(n || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(-90) || 'archivo';
async function upload({ name, type, buf }) {
  if (!buf || !buf.length) throw new Error('El archivo está vacío.');
  const ref = await files.put(`tareas/${id()}-${SAFE(name)}`, buf, type || 'application/octet-stream');
  return { id: id(), kind: /^image\//.test(type || '') ? 'photo' : 'file', name: str(name, 160) || 'archivo', type: str(type, 100), size: buf.length, ref };
}
// Archivo que el navegador subió directo a Vercel Blob.
function blobAtt({ url, name, type, size }) {
  let host = ''; try { host = new URL(url).hostname; } catch { /* inválido */ }
  if (!/\.blob\.vercel-storage\.com$/.test(host) && host !== process.env.BLOB_TEST_HOST) throw new Error('Link de archivo inválido.');
  let key = ''; try { key = decodeURIComponent(new URL(url).pathname.slice(1)); } catch { /* nada */ }
  return { id: id(), kind: /^image\//.test(type || '') ? 'photo' : 'file', name: str(name, 160) || 'archivo', type: str(type, 100), size: Number(size) || 0, ref: { key, url } };
}

module.exports = { STATUS, list, get, create, update, remove, removeAtt, comment, people, savePeople, findAtt, upload, blobAtt, SAFE };
