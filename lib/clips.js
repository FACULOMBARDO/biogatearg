// Clips (videos cortos) de las publicaciones: cuáles tienen y cuáles faltan.
const store = require('./store');
const ml = require('./ml');
const { get, pick } = ml;

// Publicaciones activas de una cuenta (modo "scan" para pasar el límite de 1000).
async function activeItemIds(acc) {
  const ids = [];
  let scroll = '';
  for (let i = 0; i < 200; i++) {
    const r = await get(acc, `/users/${acc.user_id}/items/search?status=active&search_type=scan&limit=100${scroll ? '&scroll_id=' + encodeURIComponent(scroll) : ''}`);
    if (!r.ok) throw new Error(`No pude listar las publicaciones de ${acc.nickname || acc.user_id}: ${r.data?.message || r.status}`);
    const res = r.data.results || [];
    ids.push(...res);
    scroll = r.data.scroll_id;
    if (!res.length || !scroll) break;
  }
  return [...new Set(ids)];
}

// Datos de a 20 publicaciones por consulta.
async function itemDetails(acc, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20);
    const r = await get(acc, `/items?ids=${chunk.join(',')}`);
    if (!r.ok || !Array.isArray(r.data)) continue;
    for (const x of r.data) {
      const b = x.body || {};
      if (!b.id) continue;
      const skuAttr = (b.attributes || []).find(a => a.id === 'SELLER_SKU');
      const varSkus = (b.variations || []).map(v => pick(v.seller_custom_field, (v.attributes || []).find(a => a.id === 'SELLER_SKU')?.value_name)).filter(Boolean);
      out.push({
        id: b.id, title: b.title || '', thumb: pick(b.secure_thumbnail, b.thumbnail), permalink: b.permalink || '',
        sku: pick(b.seller_custom_field, skuAttr?.value_name, varSkus[0]), sold_total: Number(b.sold_quantity) || 0,
        video_ev: videoEvidence(b),
      });
    }
  }
  return out;
}

// Señales de video dentro de los datos de la publicación (video_id, etiquetas, campos o atributos con "video"/"clip").
const has = (v) => v !== null && v !== undefined && v !== '' && v !== false && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
function videoEvidence(b) {
  const ev = [];
  if (has(b.video_id)) ev.push('video_id');
  for (const t of b.tags || []) if (/video|clip/i.test(t) && !/without|no_video|missing|sin_/i.test(t)) ev.push('tag:' + t);
  for (const k of Object.keys(b)) if (k !== 'video_id' && /video|clip/i.test(k) && has(b[k])) ev.push(k);
  for (const a of b.attributes || []) if (/VIDEO|CLIP/i.test(a.id || '') && has(a.value_name) && !/^no$/i.test(a.value_name)) ev.push('attr:' + a.id);
  return ev;
}

// Estado de clips de una publicación. Se prueban las dos rutas que documenta Mercado Libre.
const PATHS = [(id) => `/marketplace/items/${id}/clips`, (id) => `/items/${id}/clips`];
let workingPath = null;
let pathFails = {};   // si una ruta falla muchas veces seguidas sin ningún OK, se deja de usar (no se pregunta 1000 veces lo mismo)
function parseClips(data) {
  const clips = Array.isArray(data) ? data : (data.clips || data.results || []);
  const states = [];
  const reasons = [];
  for (const c of clips) {
    const st = pick(c.status, c.moderation_status, ...(c.metadata || []).map(m => m.moderation_status));
    if (st) states.push(String(st).toUpperCase());
    for (const m of c.metadata || []) for (const r of m.moderation_reasons || []) reasons.push(typeof r === 'string' ? r : (r.description || r.reason || r.code || ''));
    if (c.moderation_reasons) for (const r of c.moderation_reasons) reasons.push(typeof r === 'string' ? r : (r.description || r.code || ''));
  }
  let state = 'none';
  if (states.some(s => ['PUBLISHED', 'ACTIVE', 'APPROVED'].includes(s))) state = 'published';
  else if (states.some(s => ['UNDER_REVIEW', 'PENDING', 'PROCESSING', 'TRANSCODING'].includes(s))) state = 'review';
  else if (states.some(s => ['REJECTED', 'TRANSCODING_REJECTED'].includes(s))) state = 'rejected';
  else if (states.some(s => s === 'PAUSED')) state = 'paused';
  else if (clips.length) state = 'published';
  return { state, count: clips.length, reasons: [...new Set(reasons.filter(Boolean))].slice(0, 3) };
}
async function clipState(acc, id, diag) {
  const paths = workingPath ? [workingPath] : PATHS.filter((p, i) => (pathFails[i] || 0) < 12);
  if (!paths.length) return { state: 'unknown', count: 0, reasons: [], err_code: diag.lastCode, error: diag.lastErr };
  let last = null;
  for (const p of paths) {
    const r = await get(acc, p(id));
    if (!r.ok && !workingPath) { const i = PATHS.indexOf(p); pathFails[i] = (pathFails[i] || 0) + 1; diag.lastCode = r.status; diag.lastErr = `${r.status} ${r.data?.message || r.data?.error || ''}`.trim(); }
    last = r;
    diag.codes[r.status] = (diag.codes[r.status] || 0) + 1;
    if (r.ok) { workingPath = p; diag.ok++; return parseClips(r.data || {}); }
    if (r.status === 404 && workingPath) return { state: 'none', count: 0, reasons: [] }; // la ruta anda: 404 = sin clips
  }
  return { state: 'unknown', count: 0, reasons: [], err_code: last?.status, error: last ? `${last.status} ${last.data?.message || last.data?.error || ''}`.trim() : '' };
}

let job = { running: false };
function status() { return { ...job, errors: (job.errors || []).slice(0, 15) }; }

function refresh() {
  if (job.running) return false;
  job = { running: true, phase: 'Buscando publicaciones…', total: 0, done: 0, errors: [], started_at: new Date().toISOString() };
  workingPath = null; pathFails = {};
  require('./bg').bg((async () => {
    const diag = { ok: 0, codes: {} };
    const all = [];
    try {
      for (const acc of store.getAccounts()) {
        job.phase = `Buscando publicaciones de ${acc.nickname || acc.user_id}…`;
        let ids;
        try { ids = await activeItemIds(acc); } catch (e) { job.errors.push(e.message); continue; }
        job.phase = `Leyendo publicaciones de ${acc.nickname || acc.user_id}…`;
        const items = await itemDetails(acc, ids);
        items.forEach(i => { i.account_id = acc.user_id; i.account_nickname = acc.nickname || ''; });
        job.total += items.length;
        job.phase = `Revisando clips de ${acc.nickname || acc.user_id}…`;
        let next = 0;
        const worker = async () => {
          while (next < items.length) {
            const it = items[next++];
            try { Object.assign(it, await clipState(acc, it.id, diag)); } catch (e) { it.state = 'unknown'; it.error = e.message; }
            job.done++;
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        all.push(...items);
      }
      // Las que se revisaron antes de descubrir qué ruta anda y dieron 404: no tienen clips.
      if (diag.ok > 0) all.forEach(i => { if (i.state === 'unknown' && i.err_code === 404) { i.state = 'none'; delete i.error; } });
      // Si la publicación misma dice que tiene video, cuenta como "con video" aunque la consulta de clips no responda.
      const anyEvidence = all.some(i => (i.video_ev || []).length);
      all.forEach(i => {
        if ((i.video_ev || []).length && i.state !== 'review' && i.state !== 'rejected') { i.state = 'published'; i.count = i.count || 1; delete i.error; delete i.err_code; }
        else if (i.state === 'unknown' && anyEvidence && diag.ok === 0) { i.state = 'none'; delete i.error; delete i.err_code; }
      });
      const unknown = all.filter(i => i.state === 'unknown').length;
      let warning = '';
      if (all.length && diag.ok === 0 && !anyEvidence) {
        const codes = Object.entries(diag.codes).map(([k, v]) => `${k} (${v})`).join(', ');
        warning = `Mercado Libre no informó los videos de tus publicaciones (respuestas: ${codes}). Usá "Probar una publicación" con una que SÍ tenga video y mandame lo que aparece, así lo ajusto a cómo lo guarda Mercado Libre.`;
      } else if (unknown) warning = `${unknown} publicaciones no se pudieron revisar; se muestran como "sin datos".`;
      store.saveClips({ items: all, updated_at: new Date().toISOString(), warning, codes: diag.codes });
      job.phase = 'Listo';
    } catch (e) { job.phase = 'Error'; job.errors.push(e.message); }
    job.running = false; job.finished_at = new Date().toISOString();
  })());
  return true;
}

// Diagnóstico: todo lo que Mercado Libre devuelve sobre video para UNA publicación.
async function diagnose(itemId) {
  const id = String(itemId || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{3}\d+$/.test(id)) throw new Error('Poné el número de publicación, por ejemplo MLA2676617894.');
  let acc = null, item = null;
  for (const a of store.getAccounts()) {
    const r = await get(a, `/items/${id}`);
    if (r.ok) { item = r.data; if (String(r.data.seller_id) === String(a.user_id)) { acc = a; break; } if (!acc) acc = a; }
  }
  if (!item) throw new Error('No encontré esa publicación en tus cuentas.');
  const found = {};
  const walk = (o, path) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      const p = path ? `${path}.${k}` : k;
      if (/video|clip/i.test(k) || (typeof v === 'string' && /video|clip/i.test(v) && v.length < 200)) found[p] = v;
      if (typeof v === 'object') walk(v, p);
    }
  };
  walk(item, '');
  const tries = [
    `/marketplace/items/${id}/clips`, `/items/${id}/clips`, `/items/${id}/videos`, `/items/${id}/clips/list`,
    `/clips/items/${id}`, `/marketplace/clips?item_id=${id}`, `/users/${acc.user_id}/clips?item_id=${id}`,
    `/items/${id}?include_attributes=all`,
  ];
  const endpoints = [];
  for (const t of tries) {
    const r = await get(acc, t);
    let body = r.data;
    if (t.includes('include_attributes')) { const f = {}; walk(r.data, ''); body = r.ok ? { campos_con_video: Object.keys(found).length ? 'ver arriba' : 'ninguno' } : r.data; }
    endpoints.push({ ruta: t.replace(id, '{ID}').replace(String(acc.user_id), '{USER}'), status: r.status, respuesta: JSON.stringify(body).slice(0, 400) });
  }
  return {
    publicacion: id, cuenta: acc.nickname || acc.user_id, titulo: item.title,
    video_id: item.video_id ?? null, tags: item.tags || [], campos_con_video_o_clip: found,
    evidencia_detectada: videoEvidence(item), endpoints,
  };
}

module.exports = { refresh, status, parseClips, diagnose, videoEvidence };
