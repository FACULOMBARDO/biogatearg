// Sugerencias de respuesta para las preguntas de Mercado Libre con Gemini (Google, plan gratis).
// Toma los datos de la publicación (ficha, descripción, fotos, precio, stock), las respuestas que
// ya diste en esa publicación y tus datos fijos. Nunca responde sola: deja un borrador para revisar.
// La clave va solo en Vercel → Environment Variables como GEMINI_API_KEY.
const store = require('./store');
const ml = require('./ml');

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
// Si Google cambia los nombres, se puede forzar uno con la variable GEMINI_MODEL.
const MODELS = () => (process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest']);
const MAX_PICS = 3;
// La clave limpia: sin comillas ni espacios, y si se pegó dos veces, solo la primera.
const apiKey = () => (String(process.env.GEMINI_API_KEY || '').replace(/["']/g, '').trim().split(/\s+/)[0] || '');
const ready = () => !!apiKey();
// Ningún mensaje de error muestra la clave.
const hideKey = (m) => { let t = String(m || ''); const raw = String(process.env.GEMINI_API_KEY || ''); for (const k of [apiKey(), ...raw.split(/\s+/)]) if (k && k.length > 8) t = t.split(k).join('***'); return t.replace(/\b(AIza[\w-]{20,}|AQ\.[\w.-]{20,})/g, '***'); };

const money = (n) => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const cut = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };

// Datos de la publicación (se guardan 30 min en memoria para no pedirlos de nuevo).
const cache = new Map();
async function itemContext(acc, itemId) {
  const hit = cache.get(itemId);
  if (hit && Date.now() - hit.at < 30 * 60e3) return hit.data;
  const [it, desc, prev] = await Promise.all([
    ml.get(acc, `/items/${itemId}`).catch(() => null),
    ml.get(acc, `/items/${itemId}/description`).catch(() => null),
    ml.get(acc, `/questions/search?item=${itemId}&status=ANSWERED&api_version=4&sort_fields=date_created&sort_types=DESC&limit=15`).catch(() => null),
  ]);
  if (!it || !it.ok) throw new Error('No pude traer la publicación de Mercado Libre.');
  const b = it.data;
  const attrs = (b.attributes || []).filter(a => a.value_name && !['SELLER_SKU', 'GTIN', 'ITEM_CONDITION'].includes(a.id)).map(a => `${a.name}: ${a.value_name}`);
  const sku = ((b.attributes || []).find(a => a.id === 'SELLER_SKU') || {}).value_name || b.seller_custom_field || '';
  const vars = (b.variations || []).map(v => `${(v.attribute_combinations || []).map(c => c.value_name).join(' / ')}: ${v.available_quantity > 0 ? v.available_quantity + ' en stock' : 'sin stock'}${v.price && v.price !== b.price ? ' · ' + money(v.price) : ''}`);
  const warranty = (b.sale_terms || []).filter(t => /WARRANTY/.test(t.id) && t.value_name).map(t => `${t.name}: ${t.value_name}`);
  const data = {
    title: b.title || '', price: b.price, stock: b.available_quantity, status: b.status, sku,
    condition: b.condition === 'new' ? 'Nuevo' : b.condition === 'used' ? 'Usado' : '',
    free_ship: !!(b.shipping && b.shipping.free_shipping), full: !!(b.shipping && b.shipping.logistic_type === 'fulfillment'),
    attrs, vars, warranty,
    description: desc && desc.ok ? cut(desc.data.plain_text, 6000) : '',
    pictures: (b.pictures || []).slice(0, MAX_PICS).map(p => p.secure_url || p.url).filter(Boolean),
    previous: (prev && prev.ok ? prev.data.questions || [] : []).filter(q => q.answer && q.answer.text).slice(0, 15).map(q => ({ q: cut(q.text, 300), a: cut(q.answer.text, 600) })),
  };
  cache.set(itemId, { at: Date.now(), data });
  return data;
}

// Cuántos días dura el producto (columna DURACION de la lista de precios).
function durationFor(sku) {
  if (!sku) return null;
  const k = require('./costs').key(sku);
  const row = (store.getCosts().items || []).find(i => i.sku === k && i.days > 0);
  return row ? row.days : null;
}

async function picture(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const type = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 3.5e6) return null;
    return { inline_data: { mime_type: type, data: buf.toString('base64') } };
  } catch { return null; }
}

const RULES = `Sos quien atiende las preguntas de los compradores de una tienda argentina de suplementos que vende en Mercado Libre.
Escribí la respuesta a la pregunta del comprador, lista para publicar.
Reglas:
- Español rioplatense, amable y directo (vos, no tú ni usted). Corto: 1 a 3 oraciones. Sin emojis.
- Empezá con "Hola!" y terminá con "Saludos!", salvo que las respuestas anteriores del vendedor usen otro saludo o firma: en ese caso copiá su forma exacta.
- Usá SOLO los datos que te paso (ficha, descripción, fotos, precio, stock, respuestas anteriores, datos del vendedor). No inventes nada.
- Si el dato que piden no está, no lo inventes: respondé lo que sí sepas (o una frase corta y amable) y explicá en "falta" qué dato no encontraste.
- Las respuestas anteriores del vendedor mandan sobre la descripción si se contradicen, salvo stock y precio, que son los de ahora.
- Si hay stock, podés decir que está disponible para comprar. Si no hay stock, decilo con amabilidad.
- No prometas resultados ni efectos sobre la salud, no hagas diagnósticos ni recomiendes dosis distintas a las del producto. Si preguntan algo médico, sugerí consultar con su médico o nutricionista.
- Nunca pongas teléfonos, mails, links, redes sociales ni direcciones (Mercado Libre lo prohíbe), ni invites a comprar por fuera de Mercado Libre.
- No uses comillas ni formato (ni negritas ni listas).
Devolvé JSON: {"respuesta": "...", "falta": "..."} ("falta" vacío si tenías todos los datos).`;

async function callGemini(parts) {
  const body = {
    system_instruction: { parts: [{ text: RULES }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.4, maxOutputTokens: 4096, responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { respuesta: { type: 'STRING' }, falta: { type: 'STRING' } }, required: ['respuesta'] },
    },
  };
  let last = '';
  for (const model of MODELS()) {
    const r = await fetch(`${API}/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey() },
      body: JSON.stringify(body), signal: AbortSignal.timeout(45000),
    }).catch(e => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }));
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      const txt = ((((d.candidates || [])[0] || {}).content || {}).parts || []).map(p => p.text || '').join('').trim();
      if (!txt) { last = 'La IA no devolvió texto (puede ser un filtro de Google). Probá de nuevo.'; continue; }
      let out; try { out = JSON.parse(txt); } catch { out = { respuesta: txt }; }
      return { text: String(out.respuesta || '').trim(), missing: String(out.falta || '').trim(), model };
    }
    const msg = hideKey((d.error && d.error.message) || 'error ' + r.status);
    if (r.status === 429) throw new Error('Llegaste al límite gratis de la IA por ahora. Esperá un minuto y probá de nuevo.');
    if (r.status === 400 && /API key|API_KEY/i.test(msg) || r.status === 401 || r.status === 403) throw new Error('Google no aceptó la clave de la IA (GEMINI_API_KEY). Revisala en Vercel.');
    last = msg;
    if (r.status === 404 || r.status >= 500 || r.status === 0) continue; // modelo no disponible o caído: probar el siguiente
    break;
  }
  throw new Error('La IA no pudo responder: ' + hideKey(last));
}

async function suggest(qid) {
  if (!ready()) throw new Error('Falta configurar la IA: agregá GEMINI_API_KEY en Vercel → Environment Variables (te explico cómo en el README, sección "Sugerencias con IA").');
  const all = store.getQuestions().items || {};
  const q = all[String(qid)];
  if (!q) throw new Error('No encontré esa pregunta.');
  const acc = store.getAccount(q.account_id);
  if (!acc) throw new Error('La cuenta de esa pregunta ya no está conectada.');
  const it = await itemContext(acc, q.item_id);
  const days = durationFor(it.sku);
  const notes = String(store.getSettings().ai_notes || '').trim();
  // Lo que ya preguntó este comprador en esta publicación (para no repetir)
  const same = Object.values(all).filter(x => x.from_id && x.from_id === q.from_id && x.item_id === q.item_id && x.id !== q.id).sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-5);

  const lines = [
    `PUBLICACIÓN: ${it.title}`,
    `Precio: ${money(it.price)}${it.status && it.status !== 'active' ? ` · publicación ${it.status === 'paused' ? 'pausada' : it.status}` : ''}`,
    `Stock disponible: ${it.stock ?? 'sin dato'}`,
    it.condition && `Condición: ${it.condition}`,
    it.full ? 'Envío: por Mercado Envíos Full.' : it.free_ship ? 'Envío: gratis.' : '',
    days && `Duración aproximada de una unidad (según la lista de precios del vendedor): ${days} días.`,
    it.vars.length && `Variantes:\n- ${it.vars.join('\n- ')}`,
    it.attrs.length && `Ficha técnica:\n- ${it.attrs.join('\n- ')}`,
    it.warranty.length && `Garantía: ${it.warranty.join(' · ')}`,
    it.description && `Descripción:\n${it.description}`,
    notes && `DATOS FIJOS DEL VENDEDOR:\n${notes}`,
    it.previous.length && `RESPUESTAS ANTERIORES DEL VENDEDOR EN ESTA PUBLICACIÓN (copiá el estilo):\n${it.previous.map(p => `P: ${p.q}\nR: ${p.a}`).join('\n\n')}`,
    same.length && `LO QUE YA PREGUNTÓ ESTE COMPRADOR EN ESTA PUBLICACIÓN:\n${same.map(x => `P: ${x.text}${x.answer ? `\nR: ${x.answer.text}` : ''}`).join('\n\n')}`,
    it.pictures.length && 'Te paso también las fotos de la publicación (pueden tener la etiqueta, tabla nutricional o ingredientes).',
    `PREGUNTA DEL COMPRADOR:\n${q.text}`,
  ].filter(Boolean).join('\n\n');

  const pics = (await Promise.all(it.pictures.map(picture))).filter(Boolean);
  const out = await callGemini([{ text: lines }, ...pics]);
  if (!out.text) throw new Error('La IA no armó una respuesta. Probá de nuevo.');
  out.text = out.text.replace(/^["“]|["”]$/g, '').slice(0, require('./questions').MAX_ANSWER);
  return out;
}

module.exports = { suggest, ready };
