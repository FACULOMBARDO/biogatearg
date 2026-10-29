const fs = require('fs');
const path = require('path');

// Carga la configuración del archivo .env (lo crea configurar.bat).
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// Hora de Argentina (en Vercel el servidor corre en hora UTC).
process.env.TZ = process.env.TZ || 'America/Argentina/Buenos_Aires';
// En Vercel la dirección pública sale sola si no se cargó BASE_URL.
if (!process.env.BASE_URL && process.env.VERCEL_PROJECT_PRODUCTION_URL) process.env.BASE_URL = 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL;

const express = require('express');
const crypto = require('crypto');
const store = require('./lib/store');
const files = require('./lib/files');
const { bg, onVercel, deadline, CUT_MSG } = require('./lib/bg');
const ml = require('./lib/ml');
const zones = require('./lib/zones');
const sales = require('./lib/sales');
const costs = require('./lib/costs');
const clips = require('./lib/clips');
const web = require('./lib/web');
const full = require('./lib/full');
const stock = require('./lib/stock');
const woo = require('./lib/woo');
const insights = require('./lib/insights');
const manuals = require('./lib/manuals');
const deliveries = require('./lib/deliveries');
const tuyo = require('./lib/tuyo');
const tasks = require('./lib/tasks');
const refill = require('./lib/refill');
const questions = require('./lib/questions');
const push = require('./lib/push');

const MISSING = ['ML_CLIENT_ID', 'ML_CLIENT_SECRET', 'BASE_URL', 'ADMIN_PASSWORD'].filter(k => !process.env[k]);
if (onVercel && !store.REMOTE) MISSING.push('KV_REST_API_URL / KV_REST_API_TOKEN (conectá la base Upstash Redis al proyecto)');
if (onVercel && !files.BLOB) MISSING.push('BLOB_READ_WRITE_TOKEN (conectá un Blob store público al proyecto)');
if (MISSING.length && !onVercel) { console.error(`Falta la variable de entorno ${MISSING[0]}. Mirá el README.`); process.exit(1); }
for (const k of ['BASE_URL', 'ADMIN_PASSWORD', 'ML_CLIENT_SECRET']) process.env[k] = process.env[k] || '';

// Páginas del panel (se leen al arrancar; quedan fuera de /public para que no se vean sin entrar).
const VIEWS = {
  index: fs.readFileSync(path.join(__dirname, 'views', 'index.html'), 'utf8'),
  scan: fs.readFileSync(path.join(__dirname, 'views', 'scan.html'), 'utf8'),
  login: fs.readFileSync(path.join(__dirname, 'views', 'login.html'), 'utf8'),
};
const sendView = (res, name) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-cache'); res.send(VIEWS[name]); };

const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD + process.env.ML_CLIENT_SECRET).digest('hex');
const SESSION_DAYS = 30;

const app = express();
app.set('trust proxy', 1);
if (MISSING.length) app.use((req, res) => res.status(500).send(`<meta charset="utf-8"><div style="font-family:sans-serif;padding:30px"><h2>Falta configurar el panel</h2><p>Cargá estas variables en Vercel → Settings → Environment Variables y volvé a publicar (Redeploy):</p><ul>${MISSING.map(m => `<li><b>${m}</b></li>`).join('')}</ul></div>`));
// Base de datos: antes de cada pedido se trae lo que haya cambiado (solo en Vercel).
// Los cambios se terminan de guardar antes de responder, así otra copia del panel ya los ve.
app.use(async (req, res, next) => {
  if (!store.REMOTE) return next();
  try { await store.sync({ force: req.method !== 'GET' }); }
  catch (e) { console.error('Base de datos:', e.message); return res.status(503).send('No se pudo leer la base de datos (Upstash): ' + e.message); }
  if (req.method !== 'GET') {
    const end = res.end;
    res.end = function (...a) { store.flush().catch(() => {}).finally(() => end.apply(res, a)); return res; };
  }
  next();
});
app.use(express.json({ limit: '15mb' }));

// Agrega zona y costo de envío a cada registro (se calcula al momento, así un cambio de precios se refleja en todo).
// Mensaje de bienvenida sugerido (editable en Configuración). {nombre} = nombre del comprador.
// Versión completa para WhatsApp (sin el límite de 350 caracteres de Mercado Libre).
const DEFAULT_WA_WELCOME = "Hola {nombre}! Te hablo de Biogate\n\nTu compra realizada por Mercado Libre ya está siendo embalada para despacharse hoy.\n\nTe llega entre 15hs y 22hs de hoy.\n\nSi deseas realizar un cambio o agregar artículos, podés avisarnos!!\n\n¡Agendanos en tus contactos! Así vas a poder ver todas las promos, descuentos y novedades exclusivas que subimos todos los días a nuestros estados de WhatsApp.\n\nAdemás, en tu primera compra por este medio recibís un 10% de descuento.\n\nEstamos en Gral. Jose Gervasio Artigas 5767, Villa Pueyrredón, con más de 300 artículos disponibles.\n\nWeb: www.biogate.com.ar\n\nInstagram: @biogate.arg\n\n¡Gracias por tu compra!";
// Mensaje nuevo sin emojis (oct 2026): reemplaza una sola vez el que estaba guardado.
const WA_WELCOME_VERSION = 2;
function waWelcomeUpgrade() { const st = store.getSettings(); if ((st.wa_welcome_v || 1) < WA_WELCOME_VERSION) store.saveSettings({ wa_welcome: DEFAULT_WA_WELCOME, wa_welcome_v: WA_WELCOME_VERSION }); }
const DEFAULT_WELCOME = '¡Hola, {nombre}! Soy Facundo, de Biogate. Recibimos tu compra correctamente y ya la estamos preparando para que te llegue cuanto antes y en perfectas condiciones. Si tenés alguna duda, escribinos por acá: estamos para ayudarte. Te invitamos a conocer nuestros productos para el cuidado de tu salud. ¡Quedo a tu disposición! Saludos.';
const withZone = (s) => ({ ...s, ...zones.zoneFor(s, store.getSettings()) });
app.use(express.urlencoded({ extended: false }));

// ---------- Sesión simple con cookie firmada ----------
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
function readCookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function isLogged(req) {
  const c = readCookie(req, 'fx_sess');
  if (!c) return false;
  const [exp, sig] = c.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = sign(exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
function setCookie(res, name, value, maxAgeSec) {
  const secure = process.env.BASE_URL.startsWith('https') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`);
}

// Logo del negocio (lo sube el usuario desde el panel). Público para que aparezca también en el login.
const LOGO_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };
const logoFile = () => { if (onVercel) return null; for (const ext of Object.keys(LOGO_TYPES)) { const f = path.join(store.DATA_DIR, 'logo.' + ext); if (fs.existsSync(f)) return f; } return null; };
const hasLogo = () => !!(store.getSettings().logo_ref || logoFile());
app.get('/logo', (req, res) => {
  const ref = store.getSettings().logo_ref, f = !ref && logoFile();
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:"); // un SVG subido no puede ejecutar código
  if (ref && files.exists(ref)) return files.send(res, ref, { type: ref.type });
  if (f) return res.sendFile(f);
  res.redirect(302, '/logo-icon.png'); // logo de Biogate por defecto
});
// PDF de un presupuesto (público por link con código aleatorio, para mandarlo por WhatsApp).
app.get('/p/:token', (req, res) => {
  const tk = String(req.params.token).replace(/[^a-f0-9]/g, '');
  const q = store.getQuotes().find(x => x.token === tk);
  const ref = q && (q.pdf_ref || { key: 'presupuestos/' + tk + '.pdf' });
  if (!q || !tk || !files.exists(ref)) return res.status(404).send('Presupuesto no encontrado.');
  const fname = String(q.file_name || 'Recibo.pdf').replace(/^Presupuesto/, 'Recibo');
  files.send(res, ref, { type: 'application/pdf', name: fname });
});
// Manual compartido con un cliente (link público firmado, sin login).
const manualSig = (id) => crypto.createHmac('sha256', SECRET).update('manual:' + id).digest('hex').slice(0, 16);
function sendManual(res, id, download) {
  const f = manuals.findDoc(id), ref = f && manuals.docRef(f.doc);
  if (!ref || !files.exists(ref)) return res.status(404).send('Archivo no encontrado. Tocá "Actualizar manuales" en el panel.');
  const name = `${f.item.sku} - ${f.doc.title}`.replace(/[\\/:*?"<>|]+/g, '').slice(0, 120) + path.extname(f.doc.file);
  files.send(res, ref, { type: f.doc.type || 'application/octet-stream', name, download });
}
app.get('/m/:id/:sig', (req, res) => {
  const id = String(req.params.id).replace(/[^a-f0-9]/g, '');
  if (req.params.sig !== manualSig(id)) return res.status(404).send('Link inválido.');
  sendManual(res, id, false);
});
app.get('/login', (req, res) => sendView(res, 'login'));
app.post('/login', (req, res) => {
  const a = Buffer.from(String(req.body.password || ''));
  const b = Buffer.from(process.env.ADMIN_PASSWORD);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
    const exp = String(Date.now() + SESSION_DAYS * 86400000);
    setCookie(res, 'fx_sess', `${exp}.${sign(exp)}`, SESSION_DAYS * 86400);
    return res.redirect(req.query.next && String(req.query.next).startsWith('/') ? String(req.query.next) : '/');
  }
  res.redirect('/login?error=1');
});
app.get('/logout', (req, res) => { setCookie(res, 'fx_sess', '', 0); res.redirect('/login'); });

// Cron diario de Vercel (vercel.json): actualiza todo aunque nadie abra el panel.
app.get('/api/cron/daily', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const okAuth = secret ? req.headers.authorization === `Bearer ${secret}` : /vercel-cron/i.test(req.headers['user-agent'] || '');
  if (!okAuth) return res.status(401).json({ ok: false });
  const runs = autoTasks(true);
  runs.push(bg(refillPush(false).catch(e => console.log('Push recompras:', e.message))));
  await Promise.race([Promise.allSettled(runs), new Promise(r => setTimeout(r, 250e3))]);
  await store.flush();
  res.json({ ok: true, ran: runs.length });
});


// Service worker de las notificaciones (tiene que estar en la raíz y sin login).
app.get('/sw.js', (req, res) => { res.setHeader('Content-Type', 'application/javascript'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Service-Worker-Allowed', '/'); res.sendFile(path.join(__dirname, 'public', 'sw.js')); });

// Notificaciones de Mercado Libre (sin login: las manda Mercado Libre). Hay que contestar rápido (200)
// y después traer la pregunta. En developers de ML: URL de notificaciones = <tu panel>/api/ml/notify, tópico "Questions".
app.post('/api/ml/notify', (req, res) => {
  const b = req.body || {};
  const mine = !process.env.ML_CLIENT_ID || String(b.application_id || '') === String(process.env.ML_CLIENT_ID);
  if (mine && String(b.topic || '').startsWith('questions') && store.getAccount(String(b.user_id))) {
    questions.markWebhook();
    bg(questions.onNotify(b).then(() => store.flush()).catch(e => console.log('Pregunta:', e.message)));
  }
  res.status(200).json({ ok: true });
});

// ---------- Conectar cuentas de Mercado Libre ----------
// /connect la usás vos (logueado). /vincular/<código> es un link que le podés pasar
// a otro vendedor para que autorice su cuenta sin darle tu contraseña.
const INVITE = sign('invite').slice(0, 24);
// El "state" va firmado (sirve aunque la vuelta la atienda otra copia del panel en Vercel).
function startOAuth(res, fromInvite) {
  const body = `${Date.now()}.${fromInvite ? 1 : 0}.${crypto.randomBytes(8).toString('hex')}`;
  res.redirect(ml.authUrl(`${body}.${sign('oauth:' + body).slice(0, 32)}`));
}
function readState(state) {
  const parts = String(state || '').split('.');
  if (parts.length !== 4) return null;
  const body = parts.slice(0, 3).join('.');
  if (parts[3] !== sign('oauth:' + body).slice(0, 32)) return null;
  return { t: Number(parts[0]), fromInvite: parts[1] === '1' };
}
app.get('/connect', (req, res) => (isLogged(req) ? startOAuth(res, false) : res.redirect('/login?next=/connect')));
app.get('/vincular/:code', (req, res) => {
  if (req.params.code !== INVITE) return res.status(404).send('Link inválido.');
  startOAuth(res, true);
});
app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const p = readState(state);
  const done = (msg) => (p?.fromInvite
    ? res.send(`<meta name="viewport" content="width=device-width,initial-scale=1"><div style="font-family:sans-serif;padding:32px;text-align:center"><h2>${msg.replace(/</g, '&lt;')}</h2><p>Ya podés cerrar esta página.</p></div>`)
    : res.redirect('/?msg=' + encodeURIComponent(msg)));
  if (error) return done('Mercado Libre rechazó la conexión: ' + error);
  if (!p || Date.now() - p.t > 15 * 60 * 1000) return done('La conexión venció, probá de nuevo.');
  try {
    const acc = await ml.connectAccount(code);
    done(`Cuenta ${acc.nickname || acc.user_id} conectada.` + (acc.refresh_token ? '' : ' ATENCIÓN: Mercado Libre no entregó "refresh token", así que la conexión se va a cortar en 6 horas. Activá "Refresh Token" en tu aplicación de developers y volvé a conectarla.'));
  } catch (e) {
    done('Error al conectar: ' + e.message);
  }
});

// Todo lo de abajo requiere estar logueado.
app.use((req, res, next) => {
  if (isLogged(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sesión vencida. Volvé a entrar.' });
  res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
});

app.get(['/', '/index.html'], (req, res) => sendView(res, 'index'));
app.get('/escanear', (req, res) => sendView(res, 'scan'));
app.use(express.static(path.join(__dirname, 'public'))); // en Vercel estos archivos los sirve directamente la red de Vercel

// Tareas automáticas: en la PC corren con temporizadores; en Vercel se disparan cuando alguien usa el panel
// (como mucho cada 15 minutos) y una vez por día con el cron de Vercel.
app.use('/api', (req, res, next) => { if (onVercel) autoTasks(); next(); });

// ---------- API ----------
app.get('/api/invite', (req, res) => res.json({ url: `${process.env.BASE_URL.replace(/\/$/, '')}/vincular/${INVITE}` }));
app.get('/api/accounts', (req, res) => {
  res.json(store.getAccounts().map(a => ({ user_id: a.user_id, nickname: a.nickname || '', tuyo: tuyo.isTuyo(a.user_id), connected_at: a.connected_at, needs_reconnect: !!a.needs_reconnect || !a.refresh_token, reconnect_reason: a.reconnect_reason || (!a.refresh_token ? 'Esta cuenta se conectó sin "refresh token": activá "Refresh Token" en tu aplicación y volvé a conectarla.' : '') })));
});
app.delete('/api/accounts/:id', (req, res) => { store.removeAccount(req.params.id); res.json({ ok: true }); });

app.post('/api/scan', async (req, res) => {
  try {
    const data = await ml.lookup(req.body.raw);
    const { scan, repeated } = store.upsertScan(data);
    res.json({ ok: true, repeated, scan: withZone(scan) });
  } catch (e) {
    console.error('Error escaneo:', e.message);
    res.status(e.code === 'BAD_QR' ? 400 : e.code === 'NOT_FOUND' ? 404 : 500).json({ ok: false, error: e.message });
  }
});

// Envíos: los de Mercado Libre + recibos y pedidos web marcados "con envío".
const allScans = () => store.getScans().concat(deliveries.extra());
app.get('/api/scans', (req, res) => res.json(allScans().map(withZone)));
// Zona y costo sugeridos para una localidad (para el formulario de envío).
app.get('/api/zone/guess', (req, res) => res.json(zones.zoneFor({ city: String(req.query.city || ''), state: String(req.query.state || ''), neighborhood: String(req.query.neighborhood || ''), zone_manual: zones.ZONES[req.query.zone] ? req.query.zone : undefined }, store.getSettings())));
// Etiquetas de envío: teléfono del local que va al pie.
app.get('/api/label/settings', (req, res) => res.json({ phone: store.getSettings().label_phone ?? '11 5326-9953' }));
app.put('/api/label/settings', (req, res) => { store.saveSettings({ label_phone: String(req.body.phone ?? '').trim().slice(0, 40) }); res.json({ ok: true }); });
// Etiquetas de producto (PETGO / PESTGATE / BIOGATE / PLAYFUSION): datos del importador + últimas generadas
const PL_DEF = { origin: 'CHINA', title: 'IMPORTADOR', name: 'MAXIMILIANO STELLA / WOODHAVEN S.R.L.', address: 'Av. Albarellos 2889, C.A.B.A.', cuit: 'C.U.I.T.: 20-26198566-8 / 33-71825001-9', phone: 'Tel.: 4571-8888' };
const PL_BRANDS = ['BIOGATE', 'PESTGATE', 'PETGO', 'PLAYFUSION'];
app.get('/api/plabel', (req, res) => { const st = store.getSettings(); res.json({ cfg: { ...PL_DEF, ...(st.plabel || {}) }, def: PL_DEF, history: st.plabel_history || [] }); });
app.put('/api/plabel', (req, res) => {
  const cfg = {}; for (const k of Object.keys(PL_DEF)) cfg[k] = String(req.body[k] ?? PL_DEF[k]).trim().slice(0, 90);
  store.saveSettings({ plabel: cfg }); res.json({ ok: true, cfg });
});
app.post('/api/plabel/history', (req, res) => {
  const st = store.getSettings();
  let h = st.plabel_history || [];
  for (const it of (req.body.items || []).slice(0, 200)) {
    const brand = PL_BRANDS.includes(it.brand) ? it.brand : null; const sku = String(it.sku || '').trim().toUpperCase().slice(0, 40);
    if (!brand || !sku) continue;
    h = h.filter(x => !(x.brand === brand && x.sku === sku));
    h.unshift({ brand, sku, qty: Math.max(1, Math.min(999, Number(it.qty) || 1)), at: new Date().toISOString() });
  }
  store.saveSettings({ plabel_history: h.slice(0, 60) }); res.json({ ok: true, history: h.slice(0, 60) });
});
app.put('/api/quotes/:id/ship', (req, res) => { try { const sh = deliveries.setQuoteShip(req.params.id, req.body || {}); const q0 = store.getQuote(req.params.id); if (q0) store.saveQuote({ id: q0.id, delivery: sh ? 'envio' : (q0.delivery === 'envio' ? '' : q0.delivery) }); res.json({ ok: true, ship: sh, ...(sh ? zones.zoneFor(sh.zone_manual ? { ...sh } : sh, store.getSettings()) : {}) }); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } });
app.put('/api/woo/orders/:id/ship', (req, res) => { try { const sh = deliveries.setWebShip(req.params.id, req.body || {}); res.json({ ok: true, ship: sh, ...(sh ? zones.zoneFor(sh, store.getSettings()) : {}) }); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } });

// Zonas y precios
app.get('/api/settings', (req, res) => {
  waWelcomeUpgrade();
  const st = store.getSettings();
  res.json({ costs_sheet_url: st.costs_sheet_url || costs.DEFAULT_SHEET_URL, tax_pct: st.tax_pct ?? sales.DEFAULT_TAX_PCT, prices: { ...zones.DEFAULT_PRICES, ...(st.prices || {}) }, zones: zones.ZONES, has_logo: hasLogo(), welcome: st.welcome || DEFAULT_WELCOME, wa_welcome: st.wa_welcome || DEFAULT_WA_WELCOME, max_msg: ml.MAX_MSG, blob_uploads: files.BLOB });
});
app.put('/api/settings', (req, res) => {
  const prices = {};
  for (const z of Object.keys(zones.ZONES)) {
    const v = Number(String(req.body.prices?.[z] ?? '').replace(/\D/g, '')); // precios enteros: '5.500' = 5500
    if (v > 0) prices[z] = Math.round(v);
  }
  const upd = { prices: { ...zones.DEFAULT_PRICES, ...(store.getSettings().prices || {}), ...prices } };
  if (req.body.tax_pct !== undefined && req.body.tax_pct !== '') {
    const t = Number(String(req.body.tax_pct).replace(',', '.').replace(/[^\d.]/g, ''));
    if (t >= 0 && t <= 100) upd.tax_pct = Math.round(t * 100) / 100;
  }
  if (typeof req.body.costs_sheet_url === 'string') upd.costs_sheet_url = req.body.costs_sheet_url.trim() || costs.DEFAULT_SHEET_URL;
  if (typeof req.body.wa_welcome === 'string') upd.wa_welcome = req.body.wa_welcome.trim().slice(0, 2000) || DEFAULT_WA_WELCOME;
  if (typeof req.body.welcome === 'string') upd.welcome = req.body.welcome.trim().slice(0, 500) || DEFAULT_WELCOME;
  store.saveSettings(upd);
  res.json({ ok: true, prices: store.getSettings().prices });
});
// Asignar zona a mano. learn=true: recordar esa localidad para los próximos envíos.
app.put('/api/scans/:id/zone', (req, res) => {
  const zone = zones.ZONES[req.body.zone] ? req.body.zone : '';
  if (deliveries.isExtra(req.params.id)) {
    if (!deliveries.setZone(req.params.id, zone)) return res.status(404).json({ ok: false, error: 'No encontré ese envío.' });
    const x = deliveries.get(req.params.id);
    if (req.body.learn && x && x.city) store.learnZone(zones.cityKey(x), zone);
    return res.json({ ok: true, scan: withZone(x) });
  }
  const s = store.setZone(req.params.id, zone);
  if (!s) return res.status(404).json({ ok: false, error: 'No encontré ese envío.' });
  if (req.body.learn && s.city) store.learnZone(zones.cityKey(s), zone);
  res.json({ ok: true, scan: withZone(s) });
});
app.post('/api/logo', async (req, res) => {
  const m = String(req.body.data || '').match(/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,(.+)$/);
  if (!m) return res.status(400).json({ ok: false, error: 'Subí una imagen PNG, JPG, WEBP o SVG.' });
  const ext = { jpeg: 'jpg', jpg: 'jpg', png: 'png', webp: 'webp', 'svg+xml': 'svg' }[m[1]];
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2 * 1024 * 1024) return res.status(400).json({ ok: false, error: 'La imagen pesa más de 2 MB.' });
  if (!onVercel) for (const e of Object.keys(LOGO_TYPES)) { const f = path.join(store.DATA_DIR, 'logo.' + e); if (fs.existsSync(f)) fs.unlinkSync(f); }
  try {
    await files.remove(store.getSettings().logo_ref);
    const ref = await files.put('logo.' + ext, buf, LOGO_TYPES[ext]);
    store.saveSettings({ logo_ref: { ...ref, type: LOGO_TYPES[ext] } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: 'No se pudo guardar el logo: ' + e.message }); }
});
app.delete('/api/logo', async (req, res) => {
  if (!onVercel) for (const e of Object.keys(LOGO_TYPES)) { const f = path.join(store.DATA_DIR, 'logo.' + e); if (fs.existsSync(f)) fs.unlinkSync(f); }
  await files.remove(store.getSettings().logo_ref);
  store.saveSettings({ logo_ref: null });
  res.json({ ok: true });
});
app.put('/api/scans/:id/phone', (req, res) => {
  const phone = String(req.body.phone || '').replace(/[^\d+\s()-]/g, '').trim().slice(0, 30);
  if (deliveries.isExtra(req.params.id)) return deliveries.setPhone(req.params.id, phone) ? res.json({ ok: true, scan: withZone(deliveries.get(req.params.id)) }) : res.status(404).json({ ok: false, error: 'No encontré ese envío.' });
  const s = store.setPhone(req.params.id, phone);
  if (!s) return res.status(404).json({ ok: false, error: 'No encontré ese envío.' });
  res.json({ ok: true, scan: withZone(s) });
});
app.delete('/api/scans/:id', (req, res) => { if (deliveries.isExtra(req.params.id)) deliveries.remove(req.params.id); else store.deleteScan(req.params.id); res.json({ ok: true }); });

// ---------- Importación de envíos (en segundo plano, con progreso) ----------
let job = { running: false };
function runImport(label, getItems, opts) { return bg(runImportInner(label, getItems, opts)); }
async function runImportInner(label, getItems, opts) {
  const until = deadline();
  job = { running: true, label, phase: 'Buscando envíos…', total: 0, done: 0, added: 0, updated: 0, skipped: 0, errors: [], started_at: new Date().toISOString() };
  try {
    const items = await getItems();
    job.total = items.length;
    job.phase = 'Trayendo datos de cada envío…';
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        if (Date.now() > until) { job.cut = true; return; }
        const it = items[next++];
        try {
          const raw = typeof it === 'function' ? await it() : it;
          const data = await ml.lookup(raw, opts);
          if (!data) job.skipped++;
          else { const r = store.upsertScan(data, { imported: true }); r.repeated ? job.updated++ : job.added++; }
        } catch (e) {
          job.errors.push(e.message);
        }
        job.done++;
      }
    };
    await Promise.all([worker(), worker(), worker()]); // 3 a la vez para no saturar la API
    job.phase = job.cut ? 'Cortado' : 'Listo';
    if (job.cut) job.errors.unshift(CUT_MSG);
  } catch (e) {
    job.phase = 'Error';
    job.errors.push(e.message);
  }
  job.running = false;
  job.finished_at = new Date().toISOString();
  await store.flush();
}

// Trae todos los envíos Flex de las ventas recientes de todas las cuentas conectadas.
app.post('/api/import/flex', (req, res) => {
  if (job.running) return res.status(409).json({ ok: false, error: 'Ya hay una importación en curso.' });
  const days = Math.min(Math.max(parseInt(req.body.days, 10) || 0, 0), 30);
  const skipStatuses = req.body.include_delivered ? ['cancelled'] : ['delivered', 'cancelled', 'not_delivered'];
  runImport('Envíos Flex de todas las cuentas', async () => {
    const all = [];
    for (const acc of store.getAccounts()) {
      job.phase = `Buscando ventas de ${acc.nickname || acc.user_id}…`;
      try { all.push(...await ml.recentShipments(acc, days)); } catch (e) { job.errors.push(e.message); }
    }
    return all;
  }, { onlyFlex: true, skipStatuses });
  res.json({ ok: true });
});

// Importa una lista de números (de envío de 11 dígitos o de venta de 16) sacados de un Excel.
app.post('/api/import/ids', (req, res) => {
  if (job.running) return res.status(409).json({ ok: false, error: 'Ya hay una importación en curso.' });
  const ids = [...new Set((req.body.ids || []).map(v => String(v).trim()).filter(v => /^\d{10,20}$/.test(v)))].slice(0, 3000);
  if (!ids.length) return res.status(400).json({ ok: false, error: 'No encontré números de venta ni de envío en el archivo.' });
  const items = ids.map(id => (id.length >= 15 ? () => ml.shipmentFromOrder(id) : id));
  runImport('Archivo subido', async () => items, { onlyFlex: !!req.body.only_flex });
  res.json({ ok: true, count: ids.length });
});

app.get('/api/import/status', (req, res) => res.json({ ...job, errors: (job.errors || []).slice(0, 20), error_count: (job.errors || []).length }));

// Registro de mensajes de WhatsApp (se envían desde el WhatsApp del usuario; acá solo queda anotado).
app.post('/api/scans/:id/walog', (req, res) => {
  if (deliveries.isExtra(req.params.id)) return res.json({ ok: deliveries.walog(req.params.id, { at: new Date().toISOString(), text: String(req.body.text || '').slice(0, 2000), ok: true, channel: 'whatsapp' }) });
  const scan = store.getScan(req.params.id);
  if (!scan) return res.status(404).json({ ok: false });
  store.addMessage(req.params.id, { at: new Date().toISOString(), text: String(req.body.text || '').slice(0, 2000), ok: true, channel: 'whatsapp' });
  res.json({ ok: true });
});

// ---------- Ventas ----------
let salesJob = { running: false };
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
// Trae ventas de Mercado Libre de un rango (lo usa el botón y la actualización automática).
// En Vercel cada tanda dura como mucho ~4,5 minutos: lo hecho queda guardado y la siguiente tanda sigue sola.
function startSalesImport({ from, to, accs, refresh = false, auto = false, since = null }) {
  if (salesJob.running) return false;
  const until = deadline();
  since = since || new Date().toISOString();
  salesJob = { running: true, auto, phase: auto ? 'Actualizando ventas nuevas…' : 'Buscando ventas…', total: 0, done: 0, saved: 0, skipped: 0, errors: [], mp: null, done_accs: [], started_at: new Date().toISOString() };
  bg((async () => {
    try {
      for (const acc of accs) {
        if (salesJob.cut) break;
        salesJob.phase = `Buscando ventas de ${acc.nickname || acc.user_id}…`;
        let orders;
        try { orders = await sales.searchOrders(acc, from, to, (n) => { salesJob.phase = `Buscando ventas de ${acc.nickname || acc.user_id}… ${n}`; }); }
        catch (e) { salesJob.errors.push(e.message); continue; }
        salesJob.total += orders.length;
        salesJob.phase = `Calculando comisiones y envíos de ${acc.nickname || acc.user_id}…`;
        const seen = new Set();
        let useMp = true, mpKnown = false; // se prueba Mercado Pago por cuenta; si no responde, se deja de consultar
        const batch = [];
        let next = 0;
        const worker = async () => {
          while (next < orders.length) {
            if (Date.now() > until) { salesJob.cut = true; return; }
            const o = orders[next++];
            const old = store.getSale(o.id);
            const final = old && new Date(old.fetched_at) - new Date(old.date) > 30 * 86400000;
            if (old && ((final && !refresh) || old.fetched_at >= since)) {
              if (old.first_of_shipment && old.shipment_id) seen.add(old.shipment_id);
              salesJob.skipped++; salesJob.done++; continue;
            }
            try {
              const sale = await sales.buildSale(acc, o, seen, useMp);
              if (useMp && !mpKnown && !sale.cancelled) {
                mpKnown = true;
                if (sale.mp_received === null) useMp = false;
                salesJob.mp = salesJob.mp || sale.mp_received !== null;
              }
              batch.push(sale); salesJob.saved++;
              if (batch.length >= 25) store.upsertSales(batch.splice(0));
            } catch (e) { salesJob.errors.push(`Venta ${o.id}: ${e.message}`); }
            salesJob.done++;
          }
        };
        // Los pedidos se toman en orden de fecha: el primero de cada envío (carrito) se queda con el costo de envío.
        await Promise.all([worker(), worker(), worker()]);
        if (batch.length) store.upsertSales(batch.splice(0));
        if (!salesJob.cut) salesJob.done_accs.push(acc.user_id);
      }
      salesJob.phase = salesJob.cut ? 'Sigue en la próxima tanda…' : 'Listo';
    } catch (e) { salesJob.phase = 'Error'; salesJob.errors.push(e.message); }
    store.saveJobs({ sales_resume: salesJob.cut ? { from, to, acc_ids: accs.map(a => a.user_id).filter(id => !salesJob.done_accs.includes(id)), refresh, auto, since } : null });
    salesJob.running = false; salesJob.finished_at = new Date().toISOString();
    try { stock.applySales(); } catch (e) { console.log('Stock:', e.message); }
    await store.flush();
  })());
  return true;
}
// Sigue una importación que se cortó por tiempo (solo Vercel).
function resumeSales() {
  const r = store.getJobs().sales_resume;
  if (!r || salesJob.running) return false;
  const accs = store.getAccounts().filter(a => r.acc_ids.includes(a.user_id));
  if (!accs.length) { store.saveJobs({ sales_resume: null }); return false; }
  return startSalesImport({ ...r, accs });
}
app.post('/api/sales/import', (req, res) => {
  if (salesJob.running) return res.status(409).json({ ok: false, error: 'Ya se están trayendo ventas.' });
  store.saveJobs({ sales_resume: null });
  const { from, to } = req.body;
  if (!validDate(from) || !validDate(to) || from > to) return res.status(400).json({ ok: false, error: 'Elegí un rango de fechas válido.' });
  const want = req.body.account ? String(req.body.account).split(',').filter(Boolean) : null; // una o varias cuentas
  const accs = store.getAccounts().filter(a => !want || want.includes(a.user_id));
  if (!accs.length) return res.status(400).json({ ok: false, error: 'No hay cuentas conectadas.' });
  startSalesImport({ from, to, accs, refresh: !!req.body.refresh });
  res.json({ ok: true });
});
// Cada 15 minutos trae las ventas de hoy y ayer de todas las cuentas (así el stock baja solo).
const ymdAR = (d) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10);
function autoSales() {
  const accs = store.getAccounts().filter(a => !a.needs_reconnect);
  if (!accs.length) return;
  startSalesImport({ from: ymdAR(new Date(Date.now() - 86400e3)), to: ymdAR(new Date()), accs, auto: true });
}
if (!onVercel) setInterval(autoSales, 15 * 60e3);
app.get('/api/sales/status', (req, res) => { if (onVercel) resumeSales(); res.json({ ...salesJob, errors: (salesJob.errors || []).slice(0, 20), error_count: (salesJob.errors || []).length }); });
// Agrega la etapa de envío; en los carritos, las ventas hermanas toman el estado del envío compartido.
function withStage(list) {
  const shipSt = {};
  for (const s of list) if (s.shipment_id && s.ship_status) shipSt[s.shipment_id] = s.ship_status;
  for (const s of list) { s.ship_status_eff = s.ship_status || shipSt[s.shipment_id] || ''; s.stage = sales.stageOf(s, s.ship_status_eff); }
  return list;
}
app.get('/api/sales', (req, res) => {
  const list = withStage(store.getSales(req.query.from, req.query.to, req.query.account).map(sales.enrich)).sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(list);
});
// Corrección manual de cómo se clasifica una venta (queda guardada).
app.put('/api/sales/:id/state', (req, res) => {
  const st = String(req.body.state || '');
  if (st && !['ok', 'cancelled', 'returned', 'ml_cancelled'].includes(st)) return res.status(400).json({ ok: false, error: 'Estado inválido.' });
  store.setStateOverride(req.params.id, st);
  res.json({ ok: true });
});
app.get('/api/sales/:id/raw', async (req, res) => {
  const s = store.getSale(req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: 'No encontré esa venta.' });
  try { res.json({ ok: true, data: await sales.rawInfo(s) }); } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});
// Actualiza el estado de envío de las ventas no entregadas del período.
let statusBusy = false;
app.post('/api/sales/refresh-status', async (req, res) => {
  if (statusBusy) return res.json({ ok: true, busy: true });
  statusBusy = true;
  try { res.json({ ok: true, ...(await sales.refreshStatuses(store.getSales(req.body.from, req.body.to, req.body.account))) }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  finally { statusBusy = false; }
});
app.get('/sales.csv', (req, res) => {
  const stageName = { to_ship: 'Por enviar', in_transit: 'En camino', delivered: 'Entregada', cancelled: '' };
  let list = withStage(store.getSales(req.query.from, req.query.to, req.query.account).map(sales.enrich)).sort((a, b) => new Date(a.date) - new Date(b.date)).filter(s => !sales.EXCLUDED.includes(s.order_state));
  if (req.query.stage) list = list.filter(s => s.stage === req.query.stage);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const n = (v) => (v === null || v === undefined || v === '' ? '' : String(Math.round(v * 100) / 100).replace('.', ','));
  const taxPct = store.getSettings().tax_pct ?? sales.DEFAULT_TAX_PCT;
  const head = ['Fecha', 'Cuenta', 'SKU', 'Producto', 'Cantidad', 'Precio venta', 'Comisión ML', 'Envío ML (descontado)', `Impuestos IVA+IIBB (${taxPct}%)`, 'Tu envío Flex', 'Zona Flex', 'Costo producto', 'Recibido MP (referencia)', 'Venta', 'Estado', 'Comprador', 'Neto', 'Neto después de costos', 'Margen %'];
  const rows = [head.map(esc).join(';')];
  const t = { gross: 0, fee: 0, ship: 0, tax: 0, flex: 0, cost: 0, net: 0, nac: 0 };
  for (const s of list) {
    if (!s.cancelled) {
      t.gross += s.gross; t.fee += s.fee; t.ship += s.ship_ml_deducted; t.tax += s.tax; t.flex += s.flex_cost; t.net += s.net;
      if (s.net_after_cost !== null) { t.cost += s.cost; t.nac += s.net_after_cost; }
    }
    rows.push([
      new Date(s.date).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false }), s.account_nickname,
      s.skus.join(' | ') || 'sin SKU', s.title, s.qty, n(s.gross), n(s.fee), s.is_flex ? '' : n(s.ship_ml_deducted), n(s.tax), n(s.flex_cost),
      s.zone ? zones.ZONES[s.zone].label : '', s.cost === null ? 'sin costo' : n(s.cost), n(s.mp_received), s.order_id,
      ({ cancelled: 'Cancelada', returned: 'Devuelta', unpaid: 'No pagada' })[s.order_state] || (stageName[s.stage] + (s.is_flex ? ' (Flex)' : '')), s.buyer, n(s.net), s.net_after_cost === null ? '' : n(s.net_after_cost), s.margin_pct === null ? '' : n(s.margin_pct),
    ].map(esc).join(';'));
  }
  const cr = list.filter(s => s.order_state === 'cancelled' || s.order_state === 'returned').reduce((a, s) => a + s.gross, 0);
  rows.push(['TOTAL (sin canceladas ni devueltas)', '', '', '', '', n(t.gross), n(t.fee), n(t.ship), n(t.tax), n(t.flex), '', n(t.cost), '', '', '', '', n(t.net), n(t.nac), ''].map(esc).join(';'));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  rows.push(['Canceladas y devueltas', '', '', '', '', n(cr)].map(esc).join(';'));
  rows.push(['Ventas brutas (como Mercado Libre)', '', '', '', '', n(t.gross + cr)].map(esc).join(';'));
  res.setHeader('Content-Disposition', `attachment; filename="ventas-${req.query.from || 'todo'}-a-${req.query.to || 'hoy'}.csv"`);
  res.send('﻿' + rows.join('\r\n'));
});

// ---------- Costos de productos ----------
const costsInfo = () => {
  const c = store.getCosts();
  return { count: c.count || 0, rows_with_cost: c.rows_with_cost || 0, without_cost: c.without_cost || [], source: c.source || '', updated_at: c.updated_at || null,
    sheet_url: store.getSettings().costs_sheet_url || costs.DEFAULT_SHEET_URL, manual: store.getSettings().cost_manual || {} };
};
app.get('/api/costs', (req, res) => res.json(costsInfo()));
// Lista de precios completa (planilla + costos cargados a mano).
app.get('/api/costs/items', (req, res) => {
  const c = store.getCosts();
  const manual = store.getSettings().cost_manual || {};
  const items = (c.items || []).map(i => ({ ...i, manual: manual[i.sku] || null, used: manual[i.sku] || i.cost || null }));
  const inSheet = new Set(items.map(i => i.sku));
  for (const [sku, v] of Object.entries(manual)) if (!inSheet.has(sku)) items.push({ sku, name: '', stock: null, cost: null, manual: v, used: v, only_manual: true });
  res.json({ ...costsInfo(), items });
});
app.post('/api/costs/sync', async (req, res) => {
  try { await costs.syncFromSheet(); res.json({ ok: true, ...costsInfo() }); }
  catch (e) { res.status(502).json({ ok: false, error: e.message, ...costsInfo() }); }
});
app.post('/api/costs/rows', (req, res) => {
  try { costs.fromRows(req.body.rows || []); res.json({ ok: true, ...costsInfo() }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
// SKU cargado a mano para una publicación que no lo tiene en Mercado Libre.
app.put('/api/sku-map', (req, res) => {
  const sku = costs.key(req.body.sku);
  const itemId = String(req.body.item_id || '').trim();
  const tk = sales.titleKey(req.body.title);
  if (!itemId && !tk) return res.status(400).json({ ok: false, error: 'Falta la publicación.' });
  store.setManualSku(itemId, tk, sku);
  res.json({ ok: true, sku });
});
app.put('/api/costs/manual', (req, res) => {
  const sku = costs.key(req.body.sku);
  if (!sku) return res.status(400).json({ ok: false, error: 'Falta el SKU.' });
  const v = costs.parseMoney(req.body.cost);
  store.setManualCost(sku, v > 0 ? Math.round(v * 100) / 100 : 0);
  res.json({ ok: true });
});

// ---------- Clips ----------
app.post('/api/clips/refresh', (req, res) => {
  if (!store.getAccounts().length) return res.status(400).json({ ok: false, error: 'No hay cuentas conectadas.' });
  res.json({ ok: clips.refresh() || false, busy: true });
});
app.get('/api/clips/diag', async (req, res) => {
  try { res.json({ ok: true, diag: await clips.diagnose(req.query.item) }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.get('/api/clips/status', (req, res) => res.json(clips.status()));
app.get('/api/clips', (req, res) => {
  const c = store.getClips();
  // Unidades vendidas en los últimos 30 días por publicación (de las ventas guardadas).
  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const sold = {};
  for (const s of store.getSales(from, null)) {
    if (s.cancelled) continue;
    for (const i of s.items || []) if (i.item_id) sold[i.item_id] = (sold[i.item_id] || 0) + (i.qty || 1);
  }
  res.json({ ...c, items: (c.items || []).map(i => ({ ...i, sold_30: sold[i.id] || 0 })) });
});

// ---------- Resultado del mes ----------
app.get('/api/report', (req, res) => res.json(insights.report(req.query.month, { tuyo: req.query.tuyo === '1' })));
app.get('/api/results', (req, res) => res.json(insights.results(req.query.month, Math.min(24, Math.max(3, Number(req.query.months) || 12)), { accounts: String(req.query.accounts || ''), web: req.query.web !== '0', quotes: req.query.quotes !== '0', tuyo: req.query.tuyo === '1' })));
app.post('/api/results/fetch-month', (req, res) => {
  const m = String(req.body.month || '');
  if (!/^\d{4}-\d{2}$/.test(m)) return res.status(400).json({ ok: false, error: 'Mes inválido.' });
  const [y, mo] = m.split('-').map(Number);
  const from = `${m}-01`, last = `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}`;
  const today = ymdAR(new Date());
  const accs = store.getAccounts();
  if (!accs.length) return res.status(400).json({ ok: false, error: 'No hay cuentas conectadas.' });
  if (!startSalesImport({ from, to: last > today ? today : last, accs })) return res.status(409).json({ ok: false, error: 'Ya se están trayendo ventas; esperá a que termine.' });
  res.json({ ok: true });
});

// Trae de una vez las ventas de los últimos N meses de todas las cuentas (las ya cerradas no se vuelven a pedir).
app.post('/api/results/fetch-history', (req, res) => {
  const months = Math.min(24, Math.max(1, Number(req.body.months) || 12));
  const accs = store.getAccounts();
  if (!accs.length) return res.status(400).json({ ok: false, error: 'No hay cuentas conectadas.' });
  const now = new Date(Date.now() - 3 * 3600e3);
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1)).toISOString().slice(0, 10);
  if (!startSalesImport({ from, to: ymdAR(new Date()), accs })) return res.status(409).json({ ok: false, error: 'Ya se están trayendo ventas; esperá a que termine y probá de nuevo.' });
  const st = store.getSettings();
  if (st.wc_key && st.wc_secret) woo.sync({ months, full: true });
  res.json({ ok: true, from });
});
// Unidades vendidas por mes y por cuenta (y web).
app.get('/api/results/units', (req, res) => {
  const months = Math.min(24, Math.max(3, Number(req.query.months) || 12));
  const cur = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : ymdAR(new Date()).slice(0, 7);
  const list = [];
  for (let i = months - 1; i >= 0; i--) {
    const m = insights.shiftMonth(cur, -i);
    const [y, mo] = m.split('-').map(Number);
    const to = `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}`;
    const byAcc = {};
    let sales = 0;
    for (const s of store.getSales(`${m}-01`, to)) {
      if (s.cancelled || ['cancelled', 'returned', 'unpaid', 'ml_cancelled'].includes(s.order_state)) continue;
      byAcc[s.account_id] = (byAcc[s.account_id] || 0) + (s.qty || 0); sales++;
    }
    const web = woo.ordersBetween(`${m}-01`, to).filter(o => o.counted).reduce((t, o) => t + o.items.reduce((x, it) => x + it.qty, 0), 0);
    list.push({ month: m, by_account: byAcc, web, sales });
  }
  res.json({ accounts: store.getAccounts().map(a => ({ id: String(a.user_id), nickname: a.nickname || String(a.user_id) })), months: list, has_web: !!store.getSettings().wc_key });
});

// ---------- Horarios de compra ----------
// Devuelve cada venta con su hora (Argentina) para armar el mapa de calor en el navegador.
app.get('/api/hours', (req, res) => {
  const from = validDate(req.query.from) ? req.query.from : ymdAR(new Date(Date.now() - 90 * 86400e3));
  const to = validDate(req.query.to) ? req.query.to : ymdAR(new Date());
  const ev = [];
  for (const raw of store.getSales(from, to)) {
    if (raw.cancelled || ['cancelled', 'returned', 'unpaid', 'ml_cancelled'].includes(raw.order_state)) continue;
    const s = sales.enrich(raw);
    ev.push({ t: s.date, ch: 'ml', acc: String(s.account_id), ship: s.logistic === 'fulfillment' ? 'full' : s.is_flex ? 'flex' : 'otros', u: s.qty || 0, a: Math.round(s.gross || 0),
      skus: [...new Set((s.items || []).map(i => i.sku).filter(Boolean))] });
  }
  for (const o of woo.ordersBetween(from, to)) {
    if (!o.counted) continue;
    ev.push({ t: o.date, ch: 'web', acc: 'web', ship: 'web', u: o.items.reduce((x, i) => x + i.qty, 0), a: Math.round(o.gross), skus: [...new Set(o.items.map(i => i.sku).filter(Boolean))] });
  }
  res.json({ from, to, accounts: store.getAccounts().map(a => ({ id: String(a.user_id), nickname: a.nickname || String(a.user_id) })), has_web: !!store.getSettings().wc_key, events: ev });
});

// ---------- Calculadora ----------
app.get('/api/calc', (req, res) => res.json({ calc: store.getSettings().calc || null }));
app.post('/api/calc', (req, res) => {
  const c = req.body.calc || {}, n = (v, min, max) => { const x = Number(v); return Number.isFinite(x) && x >= min && x <= max ? x : undefined; };
  const clean = { kg: n(c.kg, 0, 10000), tc: n(c.tc, 0, 1e7), tax: n(c.tax, 0, 100), margin: n(c.margin, 0, 100), round: n(c.round, 1, 100000), mlFee: n(c.mlFee, 0, 100), mlShip: n(c.mlShip, 0, 1e8) };
  for (const k of Object.keys(clean)) if (clean[k] === undefined) delete clean[k];
  store.saveSettings({ calc: { ...(store.getSettings().calc || {}), ...clean } });
  res.json({ ok: true });
});

// ---------- Manuales ----------
app.get('/api/manuals', (req, res) => {
  const m = store.getManuals(), st = store.getSettings();
  const names = {};
  for (const i of store.getCosts().items || []) if (i.sku && i.name) names[String(i.sku).toUpperCase().replace(/\s+/g, '')] = i.name;
  const base = process.env.BASE_URL.replace(/\/$/, '');
  res.json({ price_skus: (store.getCosts().items || []).filter(i => i.sku).map(i => ({ sku: i.sku, name: i.name || '' })), updated_at: m.updated_at || null, error: m.error || '', tab: m.tab || '', sheet_url: st.manuals_sheet_url || manuals.DEFAULT_URL, sheet_tab: st.manuals_tab || manuals.DEFAULT_TAB,
    items: manuals.combined().map(it => ({ ...it, name: names[it.sku.toUpperCase().replace(/\s+/g, '')] || '', docs: it.docs.map(d => ({ ...d, public_url: d.file ? `${base}/m/${d.id}/${manualSig(d.id)}` : '' })) })) });
});
// Subir un manual a mano: el archivo va como cuerpo binario y los datos en la dirección.
app.post('/api/manuals/upload', express.raw({ type: () => true, limit: '80mb' }), async (req, res) => {
  try { res.json({ ok: true, doc: await manuals.addUpload({ sku: req.query.sku, title: req.query.title, category: req.query.category, name: req.query.name, buf: req.body }) }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
// En Vercel los archivos van directo del navegador a Vercel Blob (las funciones no aceptan más de 4,5 MB).
app.post('/api/manuals/blob-token', async (req, res) => {
  if (!files.BLOB) return res.status(400).json({ error: 'No hay Vercel Blob configurado.' });
  if (!req.body || req.body.type !== 'blob.generate-client-token') return res.status(400).json({ error: 'Pedido inválido.' });
  try {
    const { handleUpload } = require('@vercel/blob/client');
    const json = await handleUpload({
      body: req.body, request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!/^manuales\/[\w.-]+\.(pdf|png|jpe?g|webp)$/i.test(pathname)) throw new Error('Solo PDF o imágenes.');
        return { allowedContentTypes: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'], maximumSizeInBytes: 200 * 1024 * 1024, addRandomSuffix: true };
      },
    });
    res.json(json);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/manuals/upload-blob', (req, res) => {
  try { res.json({ ok: true, doc: manuals.addBlobUpload(req.body || {}) }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.put('/api/manuals/upload/:id', (req, res) => { try { res.json({ ok: true, doc: manuals.editUpload(req.params.id, req.body || {}) }); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } });
app.delete('/api/manuals/upload/:id', (req, res) => { try { manuals.deleteUpload(req.params.id); res.json({ ok: true }); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } });
app.post('/api/manuals/sync', (req, res) => res.json({ ok: manuals.sync({ force: !!req.body.force }) || false }));
app.get('/api/manuals/status', (req, res) => res.json(manuals.status()));
app.get('/api/manuals/file/:id/:name?', (req, res) => sendManual(res, String(req.params.id).replace(/[^a-f0-9]/g, ''), req.query.dl === '1'));
app.post('/api/manuals/config', (req, res) => {
  const u = String(req.body.url || '').trim(), t = String(req.body.tab || '').trim();
  if (u && !/docs\.google\.com\/spreadsheets\/d\//.test(u)) return res.status(400).json({ ok: false, error: 'Pegá el link de Google Sheets.' });
  store.saveSettings({ manuals_sheet_url: u, manuals_tab: t.slice(0, 60) });
  res.json({ ok: manuals.sync({}) || false });
});

// ---------- Notificaciones push (escritorio / celular) ----------
app.get('/api/push/key', (req, res) => res.json({ key: push.publicKey() }));
app.post('/api/push/subscribe', (req, res) => { try { const b = req.body || {}; const r = push.subscribe(b.sub, b.label, b.topics); res.json({ ok: true, topics: r.topics }); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } });
app.post('/api/push/unsubscribe', (req, res) => { push.unsubscribe(String((req.body || {}).endpoint || '')); res.json({ ok: true }); });
app.post('/api/push/status', (req, res) => { const s = push.find(String((req.body || {}).endpoint || '')); res.json({ on: !!s, topics: s ? s.topics : null }); });
app.post('/api/push/test', async (req, res) => {
  const r = await push.send('test', { title: 'Biogate · prueba', body: 'Las notificaciones de esta compu funcionan ✓', tag: 'test', url: '/' }, String((req.body || {}).endpoint || '')).catch(e => ({ error: e.message }));
  res.json({ ok: !r.error && r.sent > 0, ...r });
});
// Aviso de Recompras del día (una vez por día, desde las 9 de la mañana).
async function refillPush(force) {
  const P = store.getPush(), today = refill.arDay(Date.now()), hour = new Date(Date.now() - 3 * 3600e3).getUTCHours();
  if (!force && (P.last_refill_day === today || hour < 9)) return;
  P.last_refill_day = today; store.savePush();
  const n = refill.list().today_n;
  if (n) await push.send('refill', { title: 'Biogate · Recompras', body: `Hoy tenés ${n} cliente${n === 1 ? '' : 's'} para avisar que se les termina el suplemento.`, tag: 'refill-' + today, url: '/#recompras' });
}

// ---------- Preguntas de compradores ----------
app.get('/api/questions', (req, res) => res.json(questions.list()));
app.get('/api/questions/count', (req, res) => res.json(questions.count()));
app.post('/api/questions/sync', async (req, res) => {
  const p = bg(questions.syncAll());
  const r = await Promise.race([p, new Promise(ok => setTimeout(() => ok({ ok: true, pending: true }), 25e3))]).catch(e => ({ ok: false, errors: [e.message] }));
  res.json({ ...r, ...questions.list() });
});
app.post('/api/questions/:id/answer', async (req, res) => {
  try { res.json({ ok: true, question: await questions.answer(req.params.id, (req.body || {}).text, (req.body || {}).by) }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.get('/api/questions/:id/history', async (req, res) => { try { res.json({ ok: true, ...(await questions.history(req.params.id)) }); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } });
app.put('/api/questions/quick', (req, res) => res.json({ ok: true, quick: questions.saveQuick((req.body || {}).quick) }));
app.get('/api/questions/webhook-url', (req, res) => res.json({ url: process.env.BASE_URL.replace(/\/$/, '') + '/api/ml/notify', app_id: process.env.ML_CLIENT_ID || '' }));

// ---------- Recompras (fin de suplemento) ----------
app.get('/api/refill', (req, res) => {
  try { const out = refill.list(); const p = refill.resolveMissing(); if (p) bg(p); res.json({ ...out, resolving: !!p }); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/refill/name', (req, res) => { try { refill.setName((req.body || {}).who, (req.body || {}).name); res.json({ ok: true }); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } });
app.get('/api/refill/count', (req, res) => { try { res.json({ due: refill.dueCount() }); } catch (e) { res.json({ due: 0 }); } });
app.put('/api/refill/phone', (req, res) => { try { refill.setPhone((req.body || {}).who, (req.body || {}).phone); res.json({ ok: true }); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } });
app.put('/api/refill/config', (req, res) => res.json({ ok: true, config: refill.saveConfig(req.body || {}) }));
app.post('/api/refill/mark', (req, res) => {
  const b = req.body || {};
  const ids = [].concat(b.ids || b.id || []).map(String).slice(0, 200);
  if (!['sent', 'dismissed', 'pending'].includes(b.state)) return res.status(400).json({ ok: false, error: 'Estado inválido.' });
  for (const id of ids) refill.mark(id, b.state, b.by, b.via);
  res.json({ ok: true });
});
// Texto del mensaje ya armado (para WhatsApp o para revisar antes de mandar por ML).
app.post('/api/refill/text', async (req, res) => {
  const id = String((req.body || {}).id);
  let it = refill.list().items.find(i => i.id === id);
  if (!it) return res.status(404).json({ ok: false, error: 'No encontré ese recordatorio.' });
  if (!it.name && it.src === 'ml') { await refill.resolveName(it).catch(() => ''); it = refill.list().items.find(i => i.id === id) || it; } // que siempre salga el nombre
  res.json({ ok: true, ml: refill.text(it, 'ml'), wa: refill.text(it, 'wa'), max_ml: ml.MAX_MSG, name: it.name || '' });
});
// Mensajes armados para varios a la vez (el mismo texto, con el nombre y producto de cada uno).
app.post('/api/refill/texts', async (req, res) => {
  const b = req.body || {}, ids = [].concat(b.ids || []).map(String).slice(0, 100);
  const out = [];
  for (const id of ids) {
    let it = refill.list().items.find(i => i.id === id);
    if (!it) continue;
    if (!it.name && it.src === 'ml') { await refill.resolveName(it).catch(() => ''); it = refill.list().items.find(i => i.id === id) || it; }
    out.push({ id, name: it.name || '', client: it.client, phone: it.phone || '', src: it.src, text: refill.text(it, b.kind === 'ml' ? 'ml' : 'wa', b.template) });
  }
  res.json({ ok: true, items: out, max_ml: ml.MAX_MSG });
});
// Mandar por la mensajería de Mercado Libre (de a uno o varios; con "template" se arma el texto de cada uno).
app.post('/api/refill/send-ml', async (req, res) => {
  const b = req.body || {}, all = refill.list().items, results = [];
  for (const r of (Array.isArray(b.items) ? b.items : []).slice(0, 50)) {
    const it = all.find(i => i.id === String(r.id));
    if (!it || it.src !== 'ml') { results.push({ id: r.id, ok: false, error: 'No es una venta de Mercado Libre.' }); continue; }
    let cur = it;
    if (b.template && !cur.name) { await refill.resolveName(cur).catch(() => ''); cur = refill.list().items.find(i => i.id === it.id) || cur; } // que salga el nombre
    const text = String(r.text || refill.text(cur, 'ml', b.template)).trim();
    try {
      const out = await ml.sendMessage({ account_id: it.account_id, order_id: it.order_id, pack_id: it.pack_id || '' }, text);
      refill.mark(it.id, 'sent', b.by, 'Mercado Libre (' + out.via + ')');
      results.push({ id: it.id, ok: true });
    } catch (e) { results.push({ id: it.id, ok: false, error: e.message }); }
    await new Promise(r => setTimeout(r, 400));
  }
  res.json({ ok: true, sent: results.filter(r => r.ok).length, results });
});

// ---------- Tareas del equipo ----------
const tkErr = (res, e) => res.status(400).json({ ok: false, error: e.message });
app.get('/api/tasks', (req, res) => res.json({ items: tasks.list(), people: tasks.people(), blob_uploads: files.BLOB }));
app.post('/api/tasks', (req, res) => { try { res.json({ ok: true, task: tasks.create(req.body || {}) }); } catch (e) { tkErr(res, e); } });
app.put('/api/tasks/people', (req, res) => { try { res.json({ ok: true, people: tasks.savePeople((req.body || {}).people) }); } catch (e) { tkErr(res, e); } });
app.put('/api/tasks/:id', (req, res) => { try { res.json({ ok: true, task: tasks.update(req.params.id, req.body || {}) }); } catch (e) { tkErr(res, e); } });
app.delete('/api/tasks/:id', async (req, res) => { try { await tasks.remove(req.params.id); res.json({ ok: true }); } catch (e) { tkErr(res, e); } });
app.post('/api/tasks/:id/comments', (req, res) => { try { res.json({ ok: true, task: tasks.comment(req.params.id, req.body || {}) }); } catch (e) { tkErr(res, e); } });
app.delete('/api/tasks/:id/att/:aid', async (req, res) => { try { res.json({ ok: true, task: await tasks.removeAtt(req.params.id, req.params.aid) }); } catch (e) { tkErr(res, e); } });
// Subir foto/archivo: en la PC (o si es chico) va al servidor; en Vercel, si es grande, el navegador lo sube directo a Blob.
app.post('/api/tasks/upload', express.raw({ type: () => true, limit: '80mb' }), async (req, res) => {
  try { res.json({ ok: true, att: await tasks.upload({ name: req.query.name, type: req.query.type, buf: req.body }) }); } catch (e) { tkErr(res, e); }
});
app.post('/api/tasks/blob-token', async (req, res) => {
  if (!files.BLOB) return res.status(400).json({ error: 'No hay Vercel Blob configurado.' });
  if (!req.body || req.body.type !== 'blob.generate-client-token') return res.status(400).json({ error: 'Pedido inválido.' });
  try {
    const { handleUpload } = require('@vercel/blob/client');
    res.json(await handleUpload({
      body: req.body, request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!/^tareas\/[\w.-]+$/.test(pathname)) throw new Error('Nombre de archivo inválido.');
        return { maximumSizeInBytes: 200 * 1024 * 1024, addRandomSuffix: true };
      },
    }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/tasks/blob-att', (req, res) => { try { res.json({ ok: true, att: tasks.blobAtt(req.body || {}) }); } catch (e) { tkErr(res, e); } });
app.get('/api/tasks/file/:aid/:name?', (req, res) => {
  const a = tasks.findAtt(String(req.params.aid));
  if (!a || !a.ref || !files.exists(a.ref)) return res.status(404).send('El archivo ya no está.');
  files.send(res, a.ref, { type: a.type || undefined, name: a.name, download: req.query.dl === '1' });
});

// ---------- Sugerencias ----------
app.get('/api/suggestions', (req, res) => res.json(insights.suggestions()));
app.post('/api/quality/refresh', (req, res) => res.json({ ok: insights.refreshQuality() || false }));
app.get('/api/quality/status', (req, res) => res.json(insights.qualityStatus()));

// ---------- Stock propio ----------
app.get('/api/stock', (req, res) => { try { stock.applySales(); } catch (e) { /* sigue */ } res.json(stock.list()); });
app.post('/api/stock/init', (req, res) => {
  try { const r = stock.initFromPriceList(); stock.applySales(); res.json({ ok: true, ...r }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.post('/api/stock/move', (req, res) => {
  const b = req.body || {};
  const sku = stock.key(b.sku);
  const qty = Number(String(b.qty ?? '').replace(',', '.'));
  if (!sku) return res.status(400).json({ ok: false, error: 'Elegí el producto (SKU).' });
  if (!Number.isFinite(qty) || (b.type !== 'ajuste' && qty <= 0) || (b.type === 'ajuste' && qty < 0)) return res.status(400).json({ ok: false, error: 'Poné una cantidad válida.' });
  const note = String(b.note || '').slice(0, 200);
  const cur = stock.list().items.find(i => i.sku === sku);
  let m;
  if (b.type === 'ingreso') m = stock.move(sku, qty, 'ingreso', { note: note || 'Entró mercadería', name: b.name });
  else if (b.type === 'venta_local') m = stock.move(sku, -qty, 'venta_local', { note: note || 'Venta en el local / WhatsApp', name: b.name });
  else if (b.type === 'ajuste') m = stock.move(sku, qty - (cur ? cur.qty : 0), 'ajuste', { note: note || 'Ajuste por conteo', name: b.name });
  else return res.status(400).json({ ok: false, error: 'Movimiento inválido.' });
  store.saveStock();
  res.json({ ok: true, move: m });
});
app.put('/api/stock/:sku/min', (req, res) => {
  const it = stock.ensure(req.params.sku);
  const v = req.body.min;
  it.min = v === '' || v === null || v === undefined ? null : Math.max(0, Number(v) || 0);
  store.saveStock(); res.json({ ok: true });
});
app.get('/api/stock/:sku/history', (req, res) => res.json(stock.history(req.params.sku)));
app.post('/api/stock/settings', (req, res) => {
  const v = Number(req.body.default_min);
  if (!(v >= 0)) return res.status(400).json({ ok: false, error: 'Número inválido.' });
  store.saveSettings({ stock_min_default: v }); res.json({ ok: true });
});

// ---------- Ventas web (WooCommerce) ----------
app.get('/api/woo/orders', (req, res) => {
  const st = store.getSettings(), w = store.getWoo();
  res.json({ has_key: !!(st.wc_key && st.wc_secret), last_sync: w.last_sync || null, web_fee_pct: Number(st.web_fee_pct) || 0, tax_pct: st.tax_pct ?? 23,
    orders: woo.ordersBetween(validDate(req.query.from) ? req.query.from : null, validDate(req.query.to) ? req.query.to : null) });
});
app.post('/api/woo/sync', (req, res) => {
  const st = store.getSettings();
  if (!st.wc_key || !st.wc_secret) return res.status(400).json({ ok: false, error: 'Falta la clave de WooCommerce: cargala en Estados de WhatsApp → Configurar web.' });
  res.json({ ok: woo.sync({ months: Math.min(36, Math.max(1, Number(req.body.months) || 12)), full: !!req.body.full }) || false });
});
app.get('/api/woo/status', (req, res) => res.json(woo.status()));
// Estado del pedido en el panel (Pendiente / Completado / Cancelado). No cambia nada en la web.
app.put('/api/woo/orders/status', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.slice(0, 2000) : [];
  if (!ids.length) return res.status(400).json({ ok: false, error: 'Elegí al menos un pedido.' });
  try { const n = woo.setPanelStatus(ids, String(req.body.status || '')); stock.applySales(); res.json({ ok: true, changed: n }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.post('/api/woo/settings', (req, res) => {
  const v = Number(String(req.body.web_fee_pct ?? '').replace(',', '.'));
  if (!(v >= 0 && v <= 50)) return res.status(400).json({ ok: false, error: 'Porcentaje inválido.' });
  store.saveSettings({ web_fee_pct: Math.round(v * 100) / 100 }); res.json({ ok: true });
});

// ---------- TUYO (cuenta con productos de Amazon) ----------
app.get('/api/tuyo', (req, res) => {
  const c = tuyo.cfg();
  // Período: desde/hasta (AAAA-MM-DD); por defecto, el mes actual.
  const today = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const from = validDate(req.query.from) ? req.query.from : today.slice(0, 8) + '01';
  const to = validDate(req.query.to) ? req.query.to : today;
  const accounts = store.getAccounts().map(a => ({ user_id: a.user_id, nickname: a.nickname || a.user_id }));
  const base = { cfg: { account_id: c.account_id, kg_usd: c.kg_usd, tc: c.tc }, accounts, from, to };
  if (!c.account_id) return res.json({ ...base, products: [], summary: null, sales: [] });
  const a = new Date(from + 'T00:00:00-03:00'), b = new Date(to + 'T23:59:59-03:00');
  // Publicaciones vendidas por la cuenta TUYO (todas las ventas guardadas), con lo vendido en el período.
  const prods = {};
  for (const raw of store.getSales(null, null, c.account_id)) {
    const s = sales.enrich(raw);
    if (sales.EXCLUDED.includes(s.order_state)) continue;
    const d = new Date(s.date), inRange = d >= a && d <= b;
    for (const i of s.items || []) {
      const k = i.item_id || ('T:' + i.title);
      const p = prods[k] || (prods[k] = { item_id: i.item_id || '', title: i.title, sku: i.sku || '', units: 0, units_month: 0, last_price: 0, last_date: '' });
      if (s.cancelled) continue;
      p.units += i.qty || 1;
      if (inRange) p.units_month += i.qty || 1;
      if (!p.last_date || s.date > p.last_date) { p.last_date = s.date; p.last_price = i.unit_price || (s.gross / Math.max(1, s.qty || 1)); p.title = i.title || p.title; }
    }
  }
  const products = Object.values(prods).map(p => ({ ...p, cost_in: c.items[p.item_id] || null, cost: tuyo.calc(c.items[p.item_id], c) }))
    .sort((x, y) => y.units_month - x.units_month || y.units - x.units);
  const list = withStage(store.getSales(from, to, c.account_id).map(sales.enrich)).filter(s => !sales.EXCLUDED.includes(s.order_state)).sort((x, y) => new Date(y.date) - new Date(x.date));
  const summary = insights.mlBlock(list);
  const okL = list.filter(s => !s.cancelled);
  summary.mp_received = Math.round(okL.reduce((t, s) => t + (s.mp_received || 0), 0));
  summary.mp_n = okL.filter(s => s.mp_received !== null && s.mp_received !== undefined).length;
  summary.flex = Math.round(okL.reduce((t, s) => t + (s.flex_cost || 0), 0));
  summary.ship_ml = Math.round(okL.reduce((t, s) => t + (s.ship_ml_deducted || 0), 0));
  res.json({ ...base, products, summary, sales: list });
});
app.put('/api/tuyo/config', (req, res) => { try { const c = tuyo.saveConfig(req.body || {}); res.json({ ok: true, cfg: { account_id: c.account_id, kg_usd: c.kg_usd, tc: c.tc } }); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } });
app.put('/api/tuyo/item/:id', (req, res) => { try { res.json({ ok: true, ...tuyo.saveItem(req.params.id, req.body || {}) }); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } });

// ---------- Gastos del local ----------
const EXP_METHODS = ['Efectivo', 'Transferencia', 'Débito', 'Crédito', 'Mercado Pago', 'Cheque', 'Otro'];
const validMonth = (m) => /^\d{4}-\d{2}$/.test(String(m || ''));
const prevMonth = (m) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
app.get('/api/expenses', (req, res) => {
  const m = validMonth(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
  const all = store.getExpenses();
  const pm = prevMonth(m);
  const prev = all.filter(e => e.date.startsWith(pm));
  res.json({
    month: m, methods: EXP_METHODS,
    // Solo los nombres que vos ya usaste (los más usados primero), para autocompletar.
    names: Object.entries(all.reduce((o, e) => { o[e.category] = (o[e.category] || 0) + 1; return o; }, {})).sort((a, b) => b[1] - a[1]).map(x => x[0]),
    items: all.filter(e => e.date.startsWith(m)).sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)),
    prev_total: prev.reduce((t, e) => t + e.amount, 0), prev_fixed: prev.filter(e => e.fixed).length,
  });
});
function cleanExpense(b) {
  const raw = typeof b.amount === 'number' ? b.amount : Number(String(b.amount ?? '').replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.'));
  const amount = Math.round((raw || 0) * 100) / 100;
  if (!validDate(b.date)) throw new Error('Poné la fecha del gasto.');
  if (!(amount > 0)) throw new Error('Poné cuánto se gastó.');
  const category = String(b.category || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!category) throw new Error('Poné el nombre del gasto.');
  const description = String(b.description || '').trim().slice(0, 200);
  const method = String(b.method || '').trim().slice(0, 40) || 'Otro';
  return { date: b.date, amount, category, description, method, fixed: !!b.fixed };
}
app.post('/api/expenses', (req, res) => {
  try {
    const e = cleanExpense(req.body || {});
    const id = String(req.body.id || '');
    if (id && !store.getExpenses().some(x => x.id === id)) return res.status(404).json({ ok: false, error: 'No encontré ese gasto.' });
    const saved = store.saveExpense(id ? { id, ...e, updated_at: new Date().toISOString() } : { id: crypto.randomBytes(6).toString('hex'), ...e, created_at: new Date().toISOString() });
    res.json({ ok: true, expense: saved });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});
app.delete('/api/expenses/:id', (req, res) => { store.deleteExpense(req.params.id); res.json({ ok: true }); });
// Importar gastos desde un Excel (el navegador lee la planilla y manda las filas ya ordenadas).
app.post('/api/expenses/import', (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 5000) : [];
  if (!rows.length) return res.status(400).json({ ok: false, error: 'La planilla no tiene gastos para importar.' });
  const skipDupes = req.body.skip_dupes !== false;
  const norm = (e) => `${e.date}|${String(e.category).toLowerCase()}|${Math.round(e.amount * 100)}`;
  const seen = new Set(store.getExpenses().map(norm));
  const now = new Date().toISOString(), add = [], errors = [];
  let dupes = 0;
  rows.forEach((r, i) => {
    try {
      const e = cleanExpense(r || {});
      const plain = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); const m = EXP_METHODS.find(x => plain(x) === plain(e.method)); if (m) e.method = m;
      const k = norm(e);
      if (skipDupes && seen.has(k)) { dupes++; return; }
      seen.add(k);
      add.push({ id: crypto.randomBytes(6).toString('hex'), ...e, imported: true, created_at: now });
    } catch (err) { errors.push({ row: Number(r && r._row) || i + 1, error: err.message }); }
  });
  if (add.length) store.addExpenses(add);
  const months = [...new Set(add.map(e => e.date.slice(0, 7)))].sort();
  res.json({ ok: true, added: add.length, total: Math.round(add.reduce((t, e) => t + e.amount, 0) * 100) / 100, dupes, errors: errors.slice(0, 50), error_count: errors.length, months });
});
// Copia los gastos marcados como "fijo" del mes anterior (una sola vez cada uno).
app.post('/api/expenses/copy-fixed', (req, res) => {
  const m = String(req.body.month || '');
  if (!validMonth(m)) return res.status(400).json({ ok: false, error: 'Mes inválido.' });
  const all = store.getExpenses();
  const already = new Set(all.filter(e => e.date.startsWith(m) && e.copied_from).map(e => e.copied_from));
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(y, mo, 0).getDate();
  const now = new Date().toISOString();
  const add = all.filter(e => e.fixed && e.date.startsWith(prevMonth(m)) && !already.has(e.id)).map(e => ({
    ...e, id: crypto.randomBytes(6).toString('hex'), copied_from: e.id, created_at: now, updated_at: undefined,
    date: `${m}-${String(Math.min(Number(e.date.slice(8, 10)), last)).padStart(2, '0')}`,
  }));
  if (add.length) store.addExpenses(add);
  res.json({ ok: true, added: add.length });
});

// ---------- Full: stock en el depósito de Mercado Libre ----------
// Ventas Full de los últimos 30 días por publicación y variante (como las cuenta Mercado Libre para el depósito).
const fullSold30 = () => {
  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const out = {};
  for (const s of store.getSales(from, null)) {
    if (s.logistic !== 'fulfillment' || s.cancelled || ['cancelled', 'returned', 'unpaid', 'ml_cancelled'].includes(s.order_state)) continue;
    for (const i of s.items || []) {
      if (!i.item_id) continue;
      const k = i.item_id + '|' + (i.variation_id || '');
      out[k] = out[k] || { units: 0, amount: 0 };
      out[k].units += i.qty || 1; out[k].amount += (i.unit_price || 0) * (i.qty || 1);
    }
  }
  return out;
};
app.post('/api/full/refresh', (req, res) => {
  if (!store.getAccounts().length) return res.status(400).json({ ok: false, error: 'No hay cuentas conectadas.' });
  res.json({ ok: full.refresh() || false, busy: true });
});
app.get('/api/full/status', (req, res) => res.json(full.status()));
app.get('/api/full', (req, res) => {
  const f = store.getFull();
  const sold = fullSold30();
  const invs = f.inventories || [];
  // Publicaciones con más de un Código ML (variantes): las ventas sin variante guardada no se pueden repartir.
  const invCount = {};
  for (const g of invs) for (const it of g.items) invCount[it.id] = (invCount[it.id] || 0) + 1;
  res.json({ updated_at: f.updated_at, warning: f.warning, inventories: invs.map(g => {
    let units = 0, amount = 0, unknown = 0;
    for (const it of g.items) {
      const exact = sold[it.id + '|' + (it.variation_id || '')];
      if (exact) { units += exact.units; amount += exact.amount; }
      const noVar = it.variation_id ? sold[it.id + '|'] : null;
      if (noVar) { if (invCount[it.id] === 1) { units += noVar.units; amount += noVar.amount; } else unknown += noVar.units; }
    }
    const perDay = units / 30;
    const weeks = g.error ? null : perDay > 0 ? Math.max(1, Math.ceil((g.available || 0) / perDay / 7)) : null;
    return { ...g, sold_30: units, sold_30_amount: Math.round(amount), sold_30_unknown: unknown, weeks_left: weeks, days_left: g.error || !(perDay > 0) ? null : Math.floor((g.available || 0) / perDay) };
  }) });
});

// ---------- Estados de WhatsApp (productos de la web) ----------
const webInfo = () => {
  const w = store.getWeb(); const st = store.getSettings();
  return { ...w, site: web.siteUrl(), has_key: !!(st.wc_key && st.wc_secret), has_ck: !!st.wc_key, has_cs: !!st.wc_secret, key_hint: st.wc_key ? 'ck_…' + st.wc_key.slice(-4) : '' };
};
app.get('/api/web/test-key', async (req, res) => {
  try { res.json({ ok: true, ...(await web.testKey()) }); } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.get('/api/web/products', (req, res) => res.json(webInfo()));
app.post('/api/web/sync', async (req, res) => {
  try { await web.sync(); res.json({ ok: true, ...webInfo() }); }
  catch (e) { store.saveWeb({ ...store.getWeb(), error: e.message }); res.status(400).json({ ok: false, error: e.message }); }
});
app.post('/api/web/config', (req, res) => {
  const b = req.body || {};
  const partial = {};
  if (b.web_url !== undefined) {
    const u = String(b.web_url).trim();
    if (u && !/^https?:\/\/[^\s/]+/.test(u)) return res.status(400).json({ ok: false, error: 'La dirección de la web tiene que empezar con https://' });
    partial.web_url = u;
  }
  // Un campo vacío no borra la clave guardada; para borrarla se usa clear_keys.
  const k = String(b.wc_key || '').trim(), sc = String(b.wc_secret || '').trim();
  if (k) { if (!/^ck_[a-f0-9]{20,}$/i.test(k)) return res.status(400).json({ ok: false, error: 'La clave del cliente tiene que empezar con ck_ (copiala completa, sin espacios).' }); partial.wc_key = k; }
  if (sc) { if (!/^cs_[a-f0-9]{20,}$/i.test(sc)) return res.status(400).json({ ok: false, error: 'La clave secreta tiene que empezar con cs_ (copiala completa, sin espacios).' }); partial.wc_secret = sc; }
  if (b.clear_keys) { partial.wc_key = ''; partial.wc_secret = ''; }
  store.saveSettings(partial);
  res.json({ ok: true });
});
app.get('/api/web/img', async (req, res) => {
  try { const { type, buf } = await web.image(String(req.query.u || '')); res.set('content-type', type).set('cache-control', 'private, max-age=86400').send(buf); }
  catch (e) { res.status(400).send(e.message); }
});

// ---------- Presupuestos ----------
// De dónde viene cada recibo y cómo se entrega.
const Q_CHANNELS = { lara: 'Pacientes de Lara', whatsapp: 'WhatsApp', local: 'Local', mail: 'Mail', instagram: 'Instagram' };
const Q_DELIVERY = { retiro: 'Retiro en el local', lara: 'Entrega Lara', envio: 'Envío' };
app.put('/api/quotes/:id/meta', (req, res) => {
  const q = store.getQuote(req.params.id);
  if (!q) return res.status(404).json({ ok: false, error: 'No encontré ese presupuesto.' });
  const upd = { id: q.id };
  if (req.body.channel !== undefined) upd.channel = Q_CHANNELS[req.body.channel] ? req.body.channel : '';
  if (req.body.confirmed !== undefined) { upd.confirmed = !!req.body.confirmed; upd.confirmed_at = upd.confirmed ? new Date().toISOString() : null; }
  if (req.body.delivery !== undefined) {
    upd.delivery = Q_DELIVERY[req.body.delivery] ? req.body.delivery : '';
    if (upd.delivery !== 'envio' && q.ship && q.ship.on) upd.ship = { ...q.ship, on: false };   // deja de sumar en Envíos Flex
  }
  res.json({ ok: true, quote: store.saveQuote(upd) });
});
const pad = (n) => String(n).padStart(7, '0');
app.get('/api/quotes', (req, res) => res.json({ channels: Q_CHANNELS, deliveries: Q_DELIVERY, base_url: process.env.BASE_URL.replace(/\/$/, ''), quotes: store.getQuotes().map(q => ({ ...q, file_name: String(q.file_name || '').replace(/^Presupuesto/, 'Recibo'), ship_zone: q.ship && q.ship.on ? zones.zoneFor(q.ship, store.getSettings()) : null })) }));
app.post('/api/quotes', (req, res) => {
  const b = req.body || {};
  const items = (b.items || []).map(i => ({ sku: String(i.sku || '').trim().toUpperCase(), name: String(i.name || '').trim(), qty: Math.max(1, Number(i.qty) || 1), price: Math.max(0, Number(i.price) || 0) }))
    .filter(i => i.name || i.sku);
  const client = String(b.client || '').trim();
  if (!client) return res.status(400).json({ ok: false, error: 'Falta el nombre del cliente.' });
  if (!items.length) return res.status(400).json({ ok: false, error: 'Agregá al menos un producto.' });
  const subtotal = items.reduce((t, i) => t + i.qty * i.price, 0);
  const discount = Math.min(100, Math.max(0, Number(b.discount_pct) || 0));
  const total = Math.round(subtotal * (1 - discount / 100));
  let q = b.id ? store.getQuote(b.id) : null;
  const id = q ? q.id : (Math.max(0, ...store.getQuotes().map(x => x.id)) + 1);
  const data = {
    id, number: pad(id), client, whatsapp: String(b.whatsapp || '').trim(), date: String(b.date || new Date().toISOString().slice(0, 10)),
    items, subtotal, discount_pct: discount, total, payment: String(b.payment || 'MERCADO PAGO / EFECTIVO'),
    token: q?.token || crypto.randomBytes(12).toString('hex'), updated_at: new Date().toISOString(), created_at: q?.created_at || new Date().toISOString(),
    file_name: `Recibo - ${client}.pdf`.replace(/[\\/:*?"<>|]/g, ''),
  };
  if (b.channel !== undefined) data.channel = Q_CHANNELS[b.channel] ? b.channel : '';
  // Los nuevos arrancan sin confirmar; se confirman desde la lista cuando se venden.
  if (typeof b.confirmed === 'boolean') { data.confirmed = b.confirmed; data.confirmed_at = b.confirmed ? (q?.confirmed_at || new Date().toISOString()) : null; }
  else if (!q) data.confirmed = false;
  if (b.delivery !== undefined) data.delivery = Q_DELIVERY[b.delivery] ? b.delivery : '';
  if (q && data.delivery !== undefined && data.delivery !== 'envio' && q.ship && q.ship.on) data.ship = { ...q.ship, on: false };
  res.json({ ok: true, quote: store.saveQuote(data) });
});
app.post('/api/quotes/:id/pdf', async (req, res) => {
  const q = store.getQuote(req.params.id);
  if (!q) return res.status(404).json({ ok: false, error: 'No encontré el presupuesto.' });
  const m = String(req.body.data || '').match(/^data:application\/pdf;[^,]*base64,(.+)$/);
  if (!m) return res.status(400).json({ ok: false, error: 'PDF inválido.' });
  try {
    if (q.pdf_ref && q.pdf_ref.url) await files.remove(q.pdf_ref);
    const ref = await files.put('presupuestos/' + q.token + '.pdf', Buffer.from(m[1], 'base64'), 'application/pdf');
    store.saveQuote({ id: q.id, pdf_ref: ref });
  } catch (e) { return res.status(500).json({ ok: false, error: 'No se pudo guardar el PDF: ' + e.message }); }
  res.json({ ok: true, url: `${process.env.BASE_URL.replace(/\/$/, '')}/p/${q.token}` });
});
app.delete('/api/quotes/:id', async (req, res) => {
  const q = store.getQuote(req.params.id);
  if (q) { await files.remove(q.pdf_ref || { key: 'presupuestos/' + q.token + '.pdf' }); store.deleteQuote(q.id); }
  res.json({ ok: true });
});

// Mensajes (uno o varios clientes a la vez) por la mensajería oficial de Mercado Libre.
const firstWord = (v) => { const w = String(v || '').trim().split(/\s+/)[0] || ''; return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ''; };
app.post('/api/messages', async (req, res) => {
  const ids = [...new Set((req.body.shipment_ids || []).map(String))].slice(0, 100);
  const template = String(req.body.text || '');
  if (!ids.length) return res.status(400).json({ ok: false, error: 'No elegiste ningún cliente.' });
  if (!template.trim()) return res.status(400).json({ ok: false, error: 'El mensaje está vacío.' });
  const results = [];
  for (const id of ids) {
    if (deliveries.isExtra(id)) { results.push({ shipment_id: id, ok: false, error: 'No es una venta de Mercado Libre: mandale el mensaje por WhatsApp.' }); continue; }
    const scan = store.getScan(id);
    if (!scan) { results.push({ shipment_id: id, ok: false, error: 'No está en el listado.' }); continue; }
    const text = template
      .replace(/\{nombre\}/gi, firstWord(scan.first_name || scan.receiver_name))
      .replace(/\{envio\}/gi, scan.shipment_id)
      .trim();
    try {
      const r = await ml.sendMessage(scan, text);
      store.addMessage(id, { at: new Date().toISOString(), text, ok: true, via: r.via }, { pack_id: scan.pack_id || r.pack_id, buyer_id: scan.buyer_id || r.buyer_id });
      results.push({ shipment_id: id, ok: true });
    } catch (e) {
      store.addMessage(id, { at: new Date().toISOString(), text, ok: false, error: e.message });
      results.push({ shipment_id: id, ok: false, error: e.message });
    }
    await new Promise(r => setTimeout(r, 400)); // sin apurar a la API
  }
  res.json({ ok: true, sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results });
});

app.get('/api/debug/:shipmentId', async (req, res) => {
  try { res.json(await ml.debug(req.params.shipmentId)); } catch (e) { res.status(500).json({ error: e.message }); }
});

// Exportar a Excel (CSV con ; y acentos correctos)
const COLS = [
  ['scanned_at', 'Fecha escaneo'], ['shipment_id', 'Envío'], ['order_id', 'Venta'], ['first_name', 'Nombre'],
  ['last_name', 'Apellido'], ['receiver_name', 'Recibe'], ['phone', 'Teléfono'], ['email', 'Email'], ['doc', 'Documento'],
  ['nickname', 'Usuario ML'], ['address', 'Dirección'], ['neighborhood', 'Barrio'], ['city', 'Ciudad'], ['state', 'Provincia'],
  ['zip', 'CP'], ['comment', 'Referencias'], ['items', 'Productos'], ['account_nickname', 'Cuenta vendedor'], ['status', 'Estado'],
  ['zone_label', 'Zona'], ['cost', 'Costo envío'],
];
app.get('/export.csv', (req, res) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [COLS.map(c => esc(c[1])).join(';')];
  const fa = req.query.from ? new Date(req.query.from) : null, fb = req.query.to ? new Date(req.query.to) : null;
  for (const s0 of allScans()) {
    const s = withZone(s0);
    const d = new Date(req.query.by === 'carga' ? s.scanned_at : (s.sale_date || s.scanned_at));
    if ((fa && !isNaN(fa) && d < fa) || (fb && !isNaN(fb) && d >= fb)) continue;
    s.zone_label = s.zone ? zones.ZONES[s.zone].label : 'Sin zona';
    rows.push(COLS.map(([k]) => esc(k === 'scanned_at' ? new Date(s[k]).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false }) : s[k])).join(';'));
  }
  const total = store.getScans().reduce((t, x) => t + (withZone(x).cost || 0), 0);
  rows.push(COLS.map(([k]) => esc(k === 'zone_label' ? 'TOTAL' : k === 'cost' ? total : '')).join(';'));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="clientes-flex-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + rows.join('\r\n'));
});

// Tareas que en la PC corrían al arrancar y cada 15 minutos.
const wooAuto = () => { const st = store.getSettings(); if (st.wc_key && st.wc_secret) woo.sync(); };
function startupTasks() {
  costs.syncFromSheet().then(c => console.log(`Costos cargados: ${c.count} SKU`)).catch(e => console.log('No se pudieron leer los costos:', e.message));
  web.sync().then(w => console.log(`Productos de la web: ${w.count}`)).catch(e => console.log('No se pudieron leer los productos de la web:', e.message));
  try { stock.applySales(); } catch (e) { console.log('Stock:', e.message); }
}
// Registros viejos sin fecha de venta: la buscamos en segundo plano.
async function backfillSaleDates(until = Infinity) {
  for (const sc of store.getScans().filter(x => !x.sale_date && x.order_id)) {
    if (Date.now() > until) break;
    try { const d = await ml.saleDateFor(sc); if (d) store.setScanFields(sc.shipment_id, { sale_date: d }); } catch { /* se reintenta la próxima vez */ }
  }
}
// En Vercel: cada vez que alguien usa el panel se fija qué toca actualizar (con la última vez guardada en la base).
const EVERY = { questions: 10 * 60e3, sales: 15 * 60e3, woo: 15 * 60e3, costs: 6 * 3600e3, web: 6 * 3600e3, manuals: 24 * 3600e3, backfill: 24 * 3600e3 };
let autoBusy = false;
function autoTasks(force = false) {
  if (autoBusy || MISSING.length) return [];
  autoBusy = true;
  const runs = [];
  try {
    const j = store.getJobs(), now = Date.now(), due = (k) => force || !j['last_' + k] || now - new Date(j['last_' + k]).getTime() > EVERY[k];
    const stamp = {};
    if (j.sales_resume && !salesJob.running) { if (resumeSales()) stamp.last_sales = new Date().toISOString(); }
    else if (due('sales') && !salesJob.running) { stamp.last_sales = new Date().toISOString(); autoSales(); }
    if (due('questions')) { stamp.last_questions = new Date().toISOString(); runs.push(bg(questions.syncAll().catch(e => console.log('Preguntas:', e.message)))); }
    runs.push(bg(refillPush(false).catch(() => {})));
    if (due('woo')) { stamp.last_woo = new Date().toISOString(); wooAuto(); }
    if (due('costs')) { stamp.last_costs = new Date().toISOString(); runs.push(bg(costs.syncFromSheet().catch(e => console.log('Costos:', e.message)))); }
    if (due('web')) { stamp.last_web = new Date().toISOString(); runs.push(bg(web.sync().catch(e => console.log('Web:', e.message)))); }
    if (due('manuals') || (store.getManuals().partial && now - new Date(j.last_manuals || 0).getTime() > 10 * 60e3)) { stamp.last_manuals = new Date().toISOString(); if (manuals.sync({})) runs.push(manuals.lastRun()); }
    if (due('backfill')) { stamp.last_backfill = new Date().toISOString(); runs.push(bg(backfillSaleDates(deadline()))); }
    if (Object.keys(stamp).length) store.saveJobs(stamp);
  } finally { autoBusy = false; }
  return runs;
}
module.exports = app;
if (!onVercel) {
  app.listen(PORT, () => {
    console.log(`Flex Scanner escuchando en el puerto ${PORT}`);
    startupTasks();
    setTimeout(wooAuto, 5000); setInterval(wooAuto, 15 * 60e3);
    // Preguntas: en la PC no llegan las notificaciones de ML, se revisan cada 2 minutos.
    setInterval(() => refillPush(false).catch(() => {}), 30 * 60e3);
    setTimeout(() => questions.syncAll().catch(() => {}), 8000); setInterval(() => questions.syncAll().catch(() => {}), 2 * 60e3);
    setTimeout(autoSales, 20000);
    // Manuales: se leen al arrancar (solo baja los archivos nuevos o cambiados).
    setTimeout(() => manuals.sync(), 8000);
    backfillSaleDates();
  });
}
