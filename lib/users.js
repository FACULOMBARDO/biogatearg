// Usuarios del equipo: cada persona entra con su usuario y contraseña y ve solo las secciones que le diste.
// El dueño entra con la contraseña de siempre (ADMIN_PASSWORD) y ve todo. Las contraseñas se guardan encriptadas.
const crypto = require('crypto');
const store = require('./store');

const U = () => store.getUsers();
const list = () => U().list || (U().list = []);
const now = () => new Date().toISOString();

// Secciones que se pueden dar (las mismas del menú). "sueldos" y "usuarios" nunca: son solo del dueño.
const SECTIONS = {
  ventas: 'Ventas', preguntas: 'Preguntas', reclamos: 'Reclamos', resultado: 'Resultado del mes', tareas: 'Tareas', recompras: 'Recompras',
  horarios: 'Horarios de compra', stock: 'Stock', full: 'Full', tuyo: 'TUYO', flex: 'Envíos Flex y Escanear', impresion: 'Impresión de etiquetas',
  ranking: 'Ranking', precios: 'Lista de precios', presupuestos: 'Presupuestos', calculadora: 'Calculadora', etiquetas: 'Etiquetas de producto',
  manuales: 'Manuales', gastos: 'Gastos del local', estados: 'Estados de WhatsApp', sugerencias: 'Sugerencias', web: 'Ventas web',
  webcat: 'Productos de la web', publicaciones: 'Mis publicaciones',
 publicar: 'Publicar', competencia: 'Competencia', embudo: 'Embudo de ventas', salud: 'Salud de cuentas',
};
const GROUPS = {
  'Atención': ['preguntas', 'reclamos', 'recompras', 'estados', 'sugerencias'],
  'Logística': ['flex', 'impresion', 'etiquetas', 'stock', 'full'],
  'Ventas y precios': ['ventas', 'web', 'webcat', 'presupuestos', 'publicaciones', 'publicar', 'competencia', 'embudo', 'precios', 'calculadora', 'ranking', 'tuyo'],
  'Equipo': ['tareas', 'manuales', 'horarios'],
};

const hash = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
const clean = (u) => ({ id: u.id, name: u.name, username: u.username, perms: u.perms || [], active: u.active !== false, has_password: !!u.hash, invite: !!u.invite, created_at: u.created_at, last_login: u.last_login || null, task_person: u.task_person || '' });
const userName = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9._-]/g, '').slice(0, 30);

function all() { return list().map(clean); }
function get(id) { return list().find(u => u.id === id) || null; }
function save(b) {
  const name = String(b.name || '').trim().slice(0, 50);
  const username = userName(b.username || name.split(' ')[0]);
  if (!name) throw new Error('Poné el nombre.');
  if (!username) throw new Error('Poné el usuario.');
  if (['dueno', 'dueño', 'admin', 'owner'].includes(username)) throw new Error('Ese usuario está reservado.');
  const perms = [...new Set((Array.isArray(b.perms) ? b.perms : []).filter(p => SECTIONS[p]))];
  let u = b.id ? get(b.id) : null;
  if (b.id && !u) throw new Error('No encontré ese usuario.');
  if (list().some(x => x.username === username && x.id !== (u && u.id))) throw new Error('Ya existe otro usuario con ese nombre de usuario.');
  if (!u) { u = { id: crypto.randomBytes(6).toString('hex'), created_at: now(), v: 1 }; list().push(u); }
  Object.assign(u, { name, username, perms, active: b.active !== false, task_person: String(b.task_person || '').slice(0, 40) });
  if (!u.hash && !u.invite) u.invite = crypto.randomBytes(16).toString('hex');
  if (b.active === false) u.v = (u.v || 1) + 1; // cierra sus sesiones abiertas
  store.saveUsers();
  return clean(u);
}
function remove(id) { const i = list().findIndex(u => u.id === id); if (i >= 0) list().splice(i, 1); store.saveUsers(); }
// Link para que la persona cree (o cambie) su contraseña. Cierra las sesiones que tenga abiertas.
function newInvite(id) {
  const u = get(id); if (!u) throw new Error('No encontré ese usuario.');
  u.invite = crypto.randomBytes(16).toString('hex'); u.v = (u.v || 1) + 1;
  store.saveUsers();
  return u.invite;
}
function inviteFor(id) { const u = get(id); return u && u.invite ? u.invite : null; }
function byInvite(token) { const t = String(token || ''); return t.length === 32 ? list().find(u => u.invite === t && u.active !== false) || null : null; }
function setPassword(token, pw) {
  const u = byInvite(token);
  if (!u) throw new Error('El link ya se usó o no es válido. Pedile uno nuevo al dueño.');
  if (String(pw || '').length < 6) throw new Error('La contraseña tiene que tener al menos 6 caracteres.');
  u.salt = crypto.randomBytes(12).toString('hex'); u.hash = hash(pw, u.salt); delete u.invite; u.v = (u.v || 1) + 1;
  store.saveUsers();
  return u;
}
function check(username, pw) {
  const u = list().find(x => x.username === userName(username));
  if (!u || u.active === false || !u.hash) return null;
  const a = Buffer.from(hash(pw, u.salt), 'hex'), b = Buffer.from(u.hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  u.last_login = now(); store.saveUsers();
  return u;
}
function changeOwn(id, oldPw, newPw) {
  const u = get(id); if (!u || !u.hash) throw new Error('Usuario no válido.');
  if (!check(u.username, oldPw)) throw new Error('La contraseña actual no es correcta.');
  if (String(newPw || '').length < 6) throw new Error('La nueva contraseña tiene que tener al menos 6 caracteres.');
  u.salt = crypto.randomBytes(12).toString('hex'); u.hash = hash(newPw, u.salt);
  store.saveUsers();
  return true;
}

// ---------- Contraseña del dueño ----------
// Se puede cambiar desde el panel. Si te la olvidás, cambiá ADMIN_PASSWORD en Vercel: vuelve a valer esa.
const envFp = () => crypto.createHash('sha256').update('owner:' + String(process.env.ADMIN_PASSWORD || '')).digest('hex');
function ownerRec() { const o = U().owner; return o && o.hash && o.env === envFp() ? o : null; }
function ownerVersion() { const o = ownerRec(); return o ? String(o.v || 1) : null; }
function checkOwner(pw) {
  const o = ownerRec();
  if (o) { const a = Buffer.from(hash(pw, o.salt), 'hex'), b = Buffer.from(o.hash, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); }
  const a = Buffer.from(String(pw)), b = Buffer.from(String(process.env.ADMIN_PASSWORD || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function setOwnerPassword(oldPw, newPw) {
  if (!checkOwner(oldPw)) throw new Error('La contraseña actual no es correcta.');
  if (String(newPw || '').length < 8) throw new Error('La nueva contraseña tiene que tener al menos 8 caracteres.');
  if (String(newPw) === String(process.env.ADMIN_PASSWORD || '') || checkOwner(newPw)) throw new Error('Elegí una contraseña distinta de la anterior.');
  const prev = U().owner || {};
  const salt = crypto.randomBytes(12).toString('hex');
  U().owner = { salt, hash: hash(newPw, salt), env: envFp(), v: (Number(prev.v) || 1) + 1, changed_at: now() };
  store.saveUsers();
  return ownerVersion();
}

// Qué sección protege cada ruta del servidor. Las de "owner" son solo del dueño.
const ROUTES = [
  [/^\/api\/(payroll|users|activity|invite|logo|import|debug|push\/test)/, 'owner'],
  [/^\/api\/(results|report)/, ['resultado']],
  [/^\/api\/expenses/, ['gastos']],
  [/^\/api\/health/, ['salud']],
  [/^\/api\/funnel/, ['embudo']],
  [/^\/api\/(competition|compare)/, ['competencia', 'embudo']],
  [/^\/api\/publish/, ['publicar']],
  [/^\/api\/listings/, ['publicaciones', 'embudo', 'competencia', 'publicar']],
  [/^\/api\/claims\b(?!\/count)/, ['reclamos']],
  [/^\/api\/tuyo/, ['tuyo']],
  [/^\/api\/webcat/, ['webcat']],
  [/^\/api\/ship-labels/, ['impresion']],
];
// ¿Puede este usuario usar esta ruta?
function allowed(user, method, path) {
  if (!user || user.owner) return true;
  if (method !== 'GET' && /^\/api\/settings/.test(path)) return false; // la configuración la cambia solo el dueño
  if (/^\/(connect)/.test(path)) return false;
  if (method !== 'GET' && /^\/api\/accounts/.test(path)) return false; // conectar o quitar cuentas: solo el dueño
  for (const [re, need] of ROUTES) if (re.test(path)) return need !== 'owner' && need.some(k => user.perms.includes(k));
  return true;
}

module.exports = { checkOwner, setOwnerPassword, ownerVersion, SECTIONS, GROUPS, all, get, save, remove, newInvite, inviteFor, byInvite, setPassword, check, changeOwn, allowed };
