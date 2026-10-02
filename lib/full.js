// Stock en el depósito de Mercado Libre (Full), por publicación y variante.
const store = require('./store');
const { get, pick } = require('./ml');

// Publicaciones con logística Full (activas y pausadas: las pausadas suelen ser las que se quedaron sin stock).
async function fullItemIds(acc) {
  const ids = [];
  for (const status of ['active', 'paused']) {
    let scroll = '';
    for (let i = 0; i < 200; i++) {
      const r = await get(acc, `/users/${acc.user_id}/items/search?logistic_type=fulfillment&status=${status}&search_type=scan&limit=100${scroll ? '&scroll_id=' + encodeURIComponent(scroll) : ''}`);
      if (!r.ok) throw new Error(`No pude listar las publicaciones Full de ${acc.nickname || acc.user_id}: ${r.data?.message || r.status}`);
      const res = r.data.results || [];
      ids.push(...res);
      scroll = r.data.scroll_id;
      if (!res.length || !scroll) break;
    }
  }
  return [...new Set(ids)];
}

const NA_LABEL = {
  damaged: 'Dañado', lost: 'Perdido', withdrawal: 'En retiro', internal_process: 'En proceso interno', transfer: 'En transferencia',
  noFiscalCoverage: 'Sin cobertura fiscal', not_supported: 'No apto', expired: 'Vencido', quarantine: 'En cuarentena',
};

// Datos de las publicaciones y sus inventarios (uno por variante si tiene variantes).
async function itemsWithInventories(acc, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 20) {
    const r = await get(acc, `/items?ids=${ids.slice(i, i + 20).join(',')}`);
    if (!r.ok || !Array.isArray(r.data)) continue;
    for (const x of r.data) {
      const b = x.body || {};
      if (!b.id) continue;
      const skuAttr = (b.attributes || []).find(a => a.id === 'SELLER_SKU');
      const item = {
        id: b.id, title: b.title || '', thumb: pick(b.secure_thumbnail, b.thumbnail), permalink: b.permalink || '', status: b.status || '',
        sku: pick(b.seller_custom_field, skuAttr?.value_name), account_id: String(acc.user_id), account_nickname: acc.nickname || '',
        listed_qty: Number(b.available_quantity) || 0, inventories: [],
      };
      const vars = (b.variations || []).filter(v => v.inventory_id);
      if (vars.length) {
        for (const v of vars) item.inventories.push({
          inventory_id: v.inventory_id,
          name: (v.attribute_combinations || []).map(a => a.value_name).filter(Boolean).join(' · '), variation_id: String(v.id || ''),
          sku: pick(v.seller_custom_field, (v.attributes || []).find(a => a.id === 'SELLER_SKU')?.value_name),
        });
      } else if (b.inventory_id) item.inventories.push({ inventory_id: b.inventory_id, name: '', sku: '' });
      out.push(item);
    }
  }
  return out;
}

async function inventoryStock(acc, inv) {
  const r = await get(acc, `/inventories/${inv.inventory_id}/stock/fulfillment`);
  if (!r.ok) { inv.error = `${r.status} ${r.data?.message || ''}`.trim(); return; }
  const d = r.data || {};
  inv.available = Number(d.available_quantity) || 0;
  inv.not_available = Number(d.not_available_quantity) || 0;
  inv.total = Number(d.total ?? inv.available + inv.not_available) || 0;
  inv.not_available_detail = (d.not_available_detail || []).filter(n => Number(n.quantity) > 0)
    .map(n => ({ status: n.status, label: NA_LABEL[n.status] || n.status, quantity: Number(n.quantity) }));
  // Si Mercado Libre informa mercadería en camino al depósito, se toma; si no, queda sin dato.
  const transit = d.in_transit_quantity ?? d.inbound_quantity ?? d.in_transit?.quantity;
  inv.in_transit = transit === undefined || transit === null ? null : Number(transit) || 0;
  inv.not_available_detail = inv.not_available_detail || [];
}

let job = { running: false };
function status() { return { ...job, errors: (job.errors || []).slice(0, 15) }; }

function refresh() {
  if (job.running) return false;
  job = { running: true, phase: 'Buscando publicaciones Full…', total: 0, done: 0, errors: [], started_at: new Date().toISOString() };
  require('./bg').bg((async () => {
    const all = [];
    try {
      for (const acc of store.getAccounts()) {
        const nick = acc.nickname || acc.user_id;
        job.phase = `Buscando publicaciones Full de ${nick}…`;
        let ids;
        try { ids = await fullItemIds(acc); } catch (e) { job.errors.push(e.message); continue; }
        if (!ids.length) continue;
        job.phase = `Leyendo publicaciones de ${nick}…`;
        const items = await itemsWithInventories(acc, ids);
        // Un mismo producto del depósito (Código ML) puede estar en varias publicaciones: se cuenta una sola vez.
        const invMap = new Map();
        for (const it of items) {
          for (const v of it.inventories) {
            let g = invMap.get(v.inventory_id);
            if (!g) {
              g = { inventory_id: v.inventory_id, account_id: it.account_id, account_nickname: it.account_nickname, title: it.title, variation: v.name,
                thumb: it.thumb, sku: v.sku || it.sku, items: [] };
              invMap.set(v.inventory_id, g);
            }
            if (!g.sku && (v.sku || it.sku)) g.sku = v.sku || it.sku;
            if (!g.thumb && it.thumb) g.thumb = it.thumb;
            g.items.push({ id: it.id, title: it.title, status: it.status, permalink: it.permalink, variation_id: v.variation_id || null });
          }
          if (!it.inventories.length) job.errors.push(`${it.id}: Mercado Libre no informó el Código ML de esta publicación.`);
        }
        const invs = [...invMap.values()];
        job.total += invs.length;
        job.phase = `Consultando el depósito de ${nick}…`;
        let next = 0;
        const worker = async () => {
          while (next < invs.length) {
            const inv = invs[next++];
            try { await inventoryStock(acc, inv); } catch (e) { inv.error = e.message; }
            job.done++;
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        // La publicación activa manda para el título y el link.
        for (const g of invs) { const act = g.items.find(i => i.status === 'active'); if (act) g.title = act.title; g.paused = !act; }
        all.push(...invs);
      }
      const failed = all.filter(i => i.error).length;
      const warning = all.length && failed === all.length
        ? `Mercado Libre no respondió el stock de Full (${all[0].error}). Revisá que las cuentas estén conectadas; si sigue, mandame una captura.`
        : failed ? `${failed} productos no se pudieron consultar; se muestran como "sin dato".` : '';
      store.saveFull({ inventories: all, updated_at: new Date().toISOString(), warning });
      job.phase = 'Listo';
    } catch (e) { job.phase = 'Error'; job.errors.push(e.message); }
    job.running = false; job.finished_at = new Date().toISOString();
  })());
  return true;
}

module.exports = { refresh, status };
