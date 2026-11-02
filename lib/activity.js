// Actividad: registra quién hizo cada cosa en el panel (cada acción que cambia algo), para que el dueño lo vea.
const store = require('./store');

const A = () => store.getActivity();
const log = () => A().log || (A().log = []);
const MAX = 4000, KEEP_DAYS = 120;
const str = (v, n) => String(v ?? '').trim().slice(0, n);

// No se registran consultas internas ni acciones automáticas (actualizar, estados, IA, cálculos).
const SKIP = /\/(sync|refresh|status|suggest|ai\/|ai$|source|price$|breakdown|market|quality|blob-token|upload$|text$|texts$|count|cron|push|me$|compare)/;

const CAT = [
  [/^\/api\/questions\/[^/]+\/answer/, 'Preguntas', (b) => 'Respondió una pregunta'],
  [/^\/api\/questions\/quick/, 'Preguntas', () => 'Editó las respuestas rápidas'],
  [/^\/api\/questions\/hours/, 'Preguntas', () => 'Cambió el horario laboral'],
  [/^\/api\/listings\/apply/, 'Publicaciones', (b) => { const c = b.changes || []; const p = c.filter(x => x.price != null).length, s = c.filter(x => x.stock != null).length, t = c.filter(x => x.status).length; return `Cambió ${[p && `${p} precios`, s && `${s} stocks`, t && `${t} estados (pausar/activar)`].filter(Boolean).join(', ') || 'publicaciones'}`; }],
  [/^\/api\/listings\/undo/, 'Publicaciones', () => 'Deshizo el último cambio de publicaciones'],
  [/^\/api\/listings\/discount/, 'Publicaciones', (b) => `Aplicó ${b.pct}% de descuento a ${(b.items || []).length} publicaciones (${b.from} al ${b.to})`],
  [/^\/api\/listings\/[^/]+\/[^/]+\/promos\/join/, 'Publicaciones', (b) => `Sumó una publicación a una campaña de ML${b.deal_price ? ` a $ ${Math.round(b.deal_price).toLocaleString('es-AR')}` : ''}`],
  [/^\/api\/listings\/[^/]+\/[^/]+\/promos\/leave/, 'Publicaciones', () => 'Quitó un descuento o campaña'],
  [/^\/api\/listings\/[^/]+\/[^/]+\/attributes/, 'Publicaciones', (b) => `Completó la ficha técnica (${(b.attributes || []).length} datos)${b.twins ? ' en todas las cuentas' : ''}`],
  [/^\/api\/listings\/[^/]+\/[^/]+\/description/, 'Publicaciones', (b) => `Cambió la descripción${b.twins ? ' en todas las cuentas' : ''}`],
  [/^\/api\/listings\/[^/]+\/[^/]+\/pictures/, 'Publicaciones', (b) => `Cambió las fotos (${(b.order || []).length} fotos)${b.twins ? ' en todas las cuentas' : ''}`],
  [/^\/api\/listings\/[^/]+\/[^/]+\/flex/, 'Publicaciones', () => 'Activó Flex en una publicación'],
  [/^\/api\/listings\/[^/]+\/[^/]+\/premium/, 'Publicaciones', () => 'Pasó una publicación a Premium'],
  [/^\/api\/publish$/, 'Publicar', (b) => `Publicó "${str(b.title, 60)}" en ${(b.accounts || []).length} ${(b.accounts || []).length === 1 ? 'cuenta' : 'cuentas'} (${b.delivery === 'days' ? `a plazo ${b.days} días` : 'entrega inmediata'})`],
  [/^\/api\/quotes\/[^/]+\/ship/, 'Presupuestos', () => 'Cargó el envío de un recibo'],
  [/^\/api\/quotes/, 'Presupuestos', (b, m) => (m === 'DELETE' ? 'Borró un recibo' : b && b.id ? 'Editó un recibo' : `Creó un recibo${b && b.client ? ` para ${str(b.client, 40)}` : ''}`)],
  [/^\/api\/expenses/, 'Gastos', (b, m) => (m === 'DELETE' ? 'Borró un gasto' : `Cargó un gasto${b && b.category ? `: ${str(b.category, 40)}${b.amount ? ` $ ${Number(String(b.amount).replace(/\D/g, '')).toLocaleString('es-AR')}` : ''}` : ''}`)],
  [/^\/api\/tasks\/[^/]+\/comments/, 'Tareas', () => 'Comentó en una tarea'],
  [/^\/api\/tasks\/people/, 'Tareas', () => 'Editó las personas de Tareas'],
  [/^\/api\/tasks/, 'Tareas', (b, m) => (m === 'DELETE' ? 'Borró una tarea' : m === 'POST' ? `Creó la tarea "${str(b && b.title, 50)}"` : b && b.status ? `Cambió una tarea a "${str(b.status, 20)}"` : 'Editó una tarea')],
  [/^\/api\/scan$/, 'Envíos', () => 'Escaneó un envío Flex'],
  [/^\/api\/(scans|zone)/, 'Envíos', (b, m) => (m === 'DELETE' ? 'Borró un envío' : 'Editó un envío (zona, datos)')],
  [/^\/api\/ship-labels\/pdf/, 'Envíos', (b) => `Descargó ${(b.items || []).length} etiquetas de Mercado Libre`],
  [/^\/api\/(label|woo\/orders\/[^/]+\/ship)/, 'Envíos', () => 'Armó una etiqueta o envío'],
  [/^\/api\/messages/, 'Mensajes', () => 'Mandó un mensaje a un comprador'],
  [/^\/api\/refill\/send-ml/, 'Recompras', () => 'Mandó avisos de recompra por Mercado Libre'],
  [/^\/api\/refill/, 'Recompras', () => 'Actualizó una recompra'],
  [/^\/api\/claims/, 'Reclamos', () => 'Acción en reclamos'],
  [/^\/api\/(costs|sku-map|plabel)/, 'Precios y costos', () => 'Cambió costos, SKU o etiquetas de producto'],
  [/^\/api\/(stock|full)/, 'Stock', () => 'Cambió datos de stock / Full'],
  [/^\/api\/manuals/, 'Manuales', (b, m) => (m === 'DELETE' ? 'Borró un manual' : 'Cargó o editó un manual')],
  [/^\/api\/settings/, 'Configuración', () => 'Cambió la configuración'],
  [/^\/api\/payroll/, 'Sueldos', () => 'Cargó sueldos'],
  [/^\/api\/users/, 'Usuarios', (b, m) => (m === 'DELETE' ? 'Borró un usuario' : `Editó el usuario ${str(b && b.name, 30)}`)],
  [/^\/api\/(accounts|invite)/, 'Cuentas', () => 'Cambió las cuentas de Mercado Libre'],
  [/^\/api\/tuyo/, 'TUYO', () => 'Cambió costos de TUYO'],
  [/^\/api\/competition/, 'Competencia', () => 'Cambió productos seguidos'],
  [/^\/api\/health/, 'Salud de cuentas', () => 'Cambió los límites de alertas'],
];

function record(req, status) {
  try {
    if (!req.user || req.method === 'GET' || status >= 400) return;
    const path = req.path;
    if (!path.startsWith('/api/') || SKIP.test(path)) return;
    const b = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : {};
    const hit = CAT.find(([re]) => re.test(path));
    const entry = { at: new Date().toISOString(), uid: req.user.id, who: req.user.owner ? 'Vos (dueño)' : req.user.name, cat: hit ? hit[1] : 'Otros', what: hit ? hit[2](b, req.method) : `${req.method} ${path}` };
    // Detalle de la pregunta respondida
    const qm = path.match(/^\/api\/questions\/([^/]+)\/answer/);
    if (qm) {
      const q = (store.getQuestions().items || {})[qm[1]];
      if (q) { entry.detail = `${q.account} · ${str((q.item || {}).title, 60)} — "${str(q.text, 80)}" → "${str(b.text, 120)}"`; entry.ref = q.id; }
    }
    log().unshift(entry);
    const lim = new Date(Date.now() - KEEP_DAYS * 86400e3).toISOString();
    if (log().length > MAX || (log().length && log()[log().length - 1].at < lim)) A().log = log().filter(e => e.at >= lim).slice(0, MAX);
    store.saveActivity();
  } catch (e) { console.log('Actividad:', e.message); }
}
// Middleware: anota la acción cuando termina bien.
function middleware(req, res, next) {
  if (req.method !== 'GET') res.on('finish', () => record(req, res.statusCode));
  next();
}

// Resumen y lista para el dueño.
function report(days, who) {
  days = [1, 7, 30, 90].includes(Number(days)) ? Number(days) : 7;
  const from = new Date(Date.now() - days * 86400e3).toISOString();
  const all = log().filter(e => e.at >= from);
  const items = who ? all.filter(e => e.who === who) : all;
  // Preguntas respondidas por persona y tiempo promedio de respuesta (incluye las respondidas desde Mercado Libre)
  const qs = Object.values(store.getQuestions().items || {}).filter(q => q.answer && q.answer.date && q.answer.date >= from);
  const people = {};
  const P = (name) => (people[name] = people[name] || { who: name, actions: 0, answered: 0, ans_min: 0, cats: {} });
  for (const e of all) { const p = P(e.who); p.actions++; p.cats[e.cat] = (p.cats[e.cat] || 0) + 1; }
  for (const q of qs) {
    const name = q.answer.by ? (q.answer.by === 'Dueño' ? 'Vos (dueño)' : q.answer.by) : 'Desde Mercado Libre (fuera del panel)';
    const p = P(name); p.answered++; p.ans_min += Math.max(0, (new Date(q.answer.date) - new Date(q.date)) / 60e3);
  }
  const summary = Object.values(people).map(p => ({ ...p, avg_min: p.answered ? Math.round(p.ans_min / p.answered) : null })).sort((a, b) => (b.actions + b.answered) - (a.actions + a.answered));
  return { days, summary, items: items.slice(0, 500), total: items.length, people: [...new Set(log().map(e => e.who))] };
}

module.exports = { middleware, report };
