// Aprender: centro de capacitación del equipo con los videos oficiales de Mercado Libre.
// Se guarda qué videos vio cada persona. El dueño ve el avance de todos y puede marcar cursos
// como obligatorios para cada persona.
const store = require('./store');

const L = () => { const d = store.getLearn(); d.progress = d.progress || {}; d.required = d.required || {}; return d; };

// Cursos = videos oficiales del canal de YouTube "Vendedores Mercado Libre" (@VendedoresMercadoLibre), ordenados por tema.
// Cada video se mira adentro del panel. Para sumar uno: agregar { yt: 'ID del video', title: '...' } al curso.
const CHANNEL = 'https://www.youtube.com/@VendedoresMercadoLibre';
const COURSES = [
  { id: "primeros", icon: "🚀", title: "Primeros pasos para vender", summary: "Lo básico de Mercado Libre Argentina: vender, publicar, hablar con clientes, enviar y la reputación.", lessons: [
    { yt: "Q04-tCSkjeQ", title: "Cómo vender en Mercado Libre" },
    { yt: "sIYFvTCskh0", title: "Cómo publicar mis productos" },
    { yt: "esFTtoRcIkY", title: "Cómo contactar a mis clientes" },
    { yt: "KYz2ZBwujTg", title: "Cómo realizar envíos" },
    { yt: "sAE3GY8HKMc", title: "Cómo funciona la reputación" },
  ] },
  { id: "intro", icon: "🎓", title: "Curso: Introducción a Mercado Libre", summary: "Curso oficial de Mercado Libre en 4 lecciones: cómo funciona la plataforma y el rol del vendedor.", lessons: [
    { yt: "mvsqFWbHh_w", title: "Lección 1: Actores que intervienen en Mercado Libre" },
    { yt: "fPExjLEYts0", title: "Lección 2: Mercado Libre, la plataforma de ventas" },
    { yt: "Z5liDfMtfg4", title: "Lección 3: Tu rol en la cadena de valor" },
    { yt: "e--dKvDyv4Y", title: "Lección 4: Lógica y funcionamiento de Mercado Libre" },
  ] },
  { id: "claves", icon: "📝", title: "Claves para publicar (Argentina)", summary: "Qué tener en cuenta antes de publicar, formas de publicar, precio, catálogo y estados de una publicación.", lessons: [
    { yt: "YkpUgcCNfcw", title: "Qué tener en cuenta antes de publicar" },
    { yt: "rkWyBMdGnVI", title: "Formas de publicar en Mercado Libre" },
    { yt: "rLXZdn3ZGaU", title: "Cómo definir el precio de tu producto" },
    { yt: "CWo7H_5YZSg", title: "Cómo funciona el Catálogo de Mercado Libre" },
    { yt: "O4TDzy2WB08", title: "Los 3 estados que puede tener una publicación" },
  ] },
  { id: "publicacion", icon: "📄", title: "Curso: La publicación en Mercado Libre", summary: "Curso oficial en 3 lecciones: una publicación pensada en el cliente y sus aspectos técnicos.", lessons: [
    { yt: "E0M0zjPFTeI", title: "Lección 1: Cómo crear tu publicación centrada en el cliente" },
    { yt: "c12vJhI6N2w", title: "Lección 2: Aspectos técnicos de la publicación (parte 1)" },
    { yt: "ma4D13YdmjI", title: "Lección 3: Aspectos técnicos de la publicación (parte 2)" },
  ] },
  { id: "fotos", icon: "📸", title: "Fotos y cómo mostrar el producto", summary: "Armar un estudio de fotos casero y mostrar bien el producto.", lessons: [
    { yt: "D7g_V_bu-Sg", title: "Armá tu propio estudio fotográfico" },
    { yt: "RTajBkzd4fU", title: "Cómo mostrar tu producto" },
    { yt: "KFTthA3Ebfk", title: "Hacé brillar tu producto" },
  ] },
  { id: "gestion", icon: "💬", title: "Curso: Gestión activa (preguntas y comunicación)", summary: "Curso oficial en 6 lecciones sobre tiempos de respuesta, comunicación y cómo responder preguntas.", lessons: [
    { yt: "AcKP4jpvRv8", title: "Lección 1: La importancia de la comunicación" },
    { yt: "dRpNVhApaQY", title: "Lección 2: Tiempos de respuesta" },
    { yt: "E53EEh3nkQQ", title: "Lección 3: Direccionalidad del canal de comunicación" },
    { yt: "jLXs88kQC3k", title: "Lección 4: Estadío de compra del cliente" },
    { yt: "_vq8CFm27uw", title: "Lección 5: Tiempo de compra del cliente" },
    { yt: "HDxCwQMqGZY", title: "Lección 6: Cómo responder las preguntas" },
    { yt: "xcKvbiRYzms", title: "Extra: Aprendé a gestionar la comunicación de tu cuenta" },
  ] },
  { id: "vendi", icon: "📦", title: "Vendí, ¿y ahora qué? (Argentina)", summary: "Qué hacer después de una venta, cómo enviar, cómo evitar reclamos y cuidar la reputación.", lessons: [
    { yt: "BO145T5ouQs", title: "Qué hacer después de una venta" },
    { yt: "IaaSdP0JmMI", title: "Formas de enviar mis ventas" },
    { yt: "6Oytd46Gh1I", title: "3 consejos para evitar reclamos y vender más" },
    { yt: "wEythWXSMHk", title: "Cómo funciona la reputación" },
    { yt: "uawiTS_oGd0", title: "Consejos para embalar" },
  ] },
  { id: "envios", icon: "🚚", title: "EnvíosCast: Full, Flex y Colecta", summary: "La serie de Mercado Libre sobre logística: elegir modalidad, Full, Flex, stock, pesos y medidas.", lessons: [
    { yt: "4D-xcbdov0g", title: "Ep. 1: Cómo elegir la mejor modalidad logística" },
    { yt: "APRbF3ExXfM", title: "Ep. 2: Full y Flex, cómo se complementan" },
    { yt: "BMYpOoGmI60", title: "Ep. 3: Ser más rentable con buena gestión de stock en Full" },
    { yt: "rOHVar7p5DY", title: "Ep. 4: El poder de Envíos Flex" },
    { yt: "2YKJyfBu3q4", title: "Ep. 5: Enviar productos a Full con costos más bajos" },
    { yt: "nZMY_SXEW3U", title: "Ep. 6: Optimizando la Colecta con OneBip" },
    { yt: "q48R66Nlabs", title: "Ep. 7: Productos pesados y voluminosos" },
    { yt: "XIcAeounnB4", title: "Ep. 8: Índice de Calidad de Stock de Full" },
    { yt: "r3UIoZ64uyw", title: "Ep. 9: Pesos y medidas, lo que todo vendedor debe saber" },
    { yt: "wSvnb5_egKs", title: "Ep. 10: Elegir el catálogo para vender más en Full" },
    { yt: "lRTrWBQlsug", title: "Colecta: app para agrupar tus paquetes" },
  ] },
  { id: "full", icon: "⚡", title: "Desmitificando Full", summary: "Productos estrella, recomendación de reabastecimiento y stock distribuido.", lessons: [
    { yt: "hRvTJKu3kH4", title: "Ep. 1: Qué son los productos Estrella" },
    { yt: "P6LNKTkfG8c", title: "Ep. 2: Cómo calcula Full la recomendación de reabastecimiento" },
    { yt: "vHkWctAiaaw", title: "Ep. 3: Mitos y verdades sobre el stock distribuido" },
  ] },
  { id: "vender", icon: "📈", title: "Vender más", summary: "Competencia, picos de venta, acciones comerciales y el Asistente de vendedores.", lessons: [
    { yt: "jTyHc4GbDgE", title: "Cómo analizar la competencia" },
    { yt: "bi-fIzq4xXk", title: "Conocer mis picos de ventas" },
    { yt: "tAjNnTLU3HQ", title: "Acciones comerciales en Mercado Libre" },
    { yt: "ZFUcKYu-GP4", title: "Cómo participar en las acciones comerciales" },
    { yt: "bUWprwVVXhQ", title: "Cómo prepararme para las acciones comerciales" },
    { yt: "JlwN6vmuBdM", title: "Conocé el Asistente de Vendedores" },
  ] },
  { id: "clips", icon: "🎬", title: "Clips: videos de producto", summary: "Cómo grabar con el celular y subir videos cortos a las publicaciones.", lessons: [
    { yt: "MZP08WmWzu0", title: "Aumentá tus ventas con Clips" },
    { yt: "S1VZ1ET1S4g", title: "Tips para grabar con tu celular" },
    { yt: "zy2gF1YR-Jg", title: "Cómo grabar o subir un video en Mercado Libre" },
    { yt: "5nGbAbVCnfo", title: "Cómo planificar videos que vendan más" },
    { yt: "UC7sZdNrxGA", title: "Ideas para mostrar tus productos en videos" },
    { yt: "isodeC5XoLA", title: "5 errores frecuentes en tus videos" },
    { yt: "SnrOuDO7LKM", title: "Dónde se muestran tus videos" },
    { yt: "db0CVE7g8kc", title: "Cómo sumar colaboradores para gestionar tus videos" },
  ] },
  { id: "workshop", icon: "🧑‍🏫", title: "Workshop: Cómo vender en Mercado Libre", summary: "Charla completa de los expertos de Mercado Libre Argentina.", lessons: [
    { yt: "7SssQfn1ydc", title: "Workshop Cómo vender en Mercado Libre" },
  ] },
  { id: "casos", icon: "🏆", title: "Casos de éxito con Full (Argentina)", summary: "Historias de vendedores argentinos, entre ellos una farmacia.", lessons: [
    { yt: "24dp6BxzAOE", title: "Farmacia Selma (Jorge Selma)" },
    { yt: "__YvsIW6kvs", title: "Dr. Skin (Valentín Sandobal)" },
    { yt: "HhU1m1qENtA", title: "Becca Shoes (Juan Sanz)" },
  ] },
];

const byId = (id) => COURSES.find(c => c.id === id) || null;
const key = (user) => (user && !user.owner ? String(user.id) : 'owner');
const mine = (user) => { const p = L().progress; const k = key(user); return p[k] || (p[k] = {}); };
const rec = (user, cid) => { const m = mine(user); return m[cid] || (m[cid] = { lessons: [] }); };

function status(c, r) {
  const n = r ? (r.lessons || []).filter(i => i < c.lessons.length).length : 0;
  if (n >= c.lessons.length) return 'completo';
  return n ? 'en curso' : 'nuevo';
}

// Lo que ve cada persona: cursos con sus videos y su avance
function list(user) {
  const m = mine(user), req = new Set(L().required[key(user)] || []);
  return {
    channel: CHANNEL,
    courses: COURSES.map(c => {
      const r = m[c.id] || null;
      return { id: c.id, icon: c.icon, title: c.title, summary: c.summary, lessons: c.lessons, required: req.has(c.id),
        progress: { lessons: (r && r.lessons) || [], done_at: r ? r.done_at || null : null, status: status(c, r) } };
    }),
  };
}

// Marca un video como visto (o lo desmarca)
function lesson(user, cid, idx, off) {
  const c = byId(cid); if (!c) throw new Error('No encontré ese curso.');
  const i = Number(idx); if (!(i >= 0 && i < c.lessons.length)) throw new Error('No encontré ese video.');
  const r = rec(user, cid);
  if (off) r.lessons = r.lessons.filter(x => x !== i); else if (!r.lessons.includes(i)) r.lessons.push(i);
  r.started_at = r.started_at || new Date().toISOString();
  if (status(c, r) === 'completo') r.done_at = r.done_at || new Date().toISOString(); else delete r.done_at;
  store.saveLearn();
  return { lessons: r.lessons, status: status(c, r) };
}

// Para el dueño: avance de cada persona en cada curso
function team() {
  const users = require('./users').all().filter(u => u.active);
  const d = L();
  const people = [{ id: 'owner', name: 'Vos (dueño)' }, ...users.map(u => ({ id: u.id, name: u.name }))];
  return {
    courses: COURSES.map(c => ({ id: c.id, icon: c.icon, title: c.title, lessons: c.lessons.length })),
    people: people.map(p => {
      const m = d.progress[p.id] || {}, req = d.required[p.id] || [];
      const rows = {};
      for (const c of COURSES) { const r = m[c.id]; rows[c.id] = { status: status(c, r), seen: r ? (r.lessons || []).length : 0, done_at: r ? r.done_at || null : null, required: req.includes(c.id) }; }
      const done = COURSES.filter(c => rows[c.id].status === 'completo').length;
      const reqPending = req.filter(id => rows[id] && rows[id].status !== 'completo').length;
      return { id: p.id, name: p.name, rows, done, total: COURSES.length, required_pending: reqPending };
    }),
  };
}

function setRequired(uid, cid, on) {
  if (!byId(cid)) throw new Error('No encontré ese curso.');
  const id = String(uid || '');
  if (id !== 'owner' && !require('./users').get(id)) throw new Error('No encontré ese usuario.');
  const d = L(); const cur = new Set(d.required[id] || []);
  if (on) cur.add(cid); else cur.delete(cid);
  d.required[id] = [...cur];
  store.saveLearn();
  return d.required[id];
}

// Cursos obligatorios que la persona todavía no terminó (para el aviso del menú)
function pending(user) {
  const req = L().required[key(user)] || [], m = mine(user);
  return req.filter(id => { const c = byId(id); return c && status(c, m[id]) !== 'completo'; }).length;
}

module.exports = { COURSES, CHANNEL, list, lesson, team, setRequired, pending, byId };
