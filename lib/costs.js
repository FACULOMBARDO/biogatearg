// Costos de productos por SKU, leídos de la lista de precios (Google Sheets o Excel).
// Se toman solo dos columnas: "SKU" y "C TOTAL $PESO".
const store = require('./store');

const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1xlnvrMN_OCqlHg2BmFVIrAttHoHiH2o8DZKb14d9h6w/edit?gid=1070341998#gid=1070341998';
const key = (sku) => String(sku ?? '').trim().toUpperCase();

// Convierte "$ 25,606.00", "25.606,50", 25606 → número.
function parseMoney(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/[$\s ]/g, '');
  if (!s || /#|n\/a/i.test(s)) return NaN;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) {
    // Con los dos separadores, el que aparece último es el decimal.
    s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lc >= 0) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');   // 25,606 = miles · 25,5 = decimal
  } else if (ld >= 0) {
    if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');                     // 25.606 = miles
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// "60 DIAS", "33 DIA", "120", "4O DIAS" (O por cero) → días. "3 X DIA" (dosis, no duración) → null.
function parseDays(v) {
  let s = String(v ?? '').trim().toUpperCase().replace(/(\d)O/g, '$10').replace(/O(\d)/g, '0$1');
  if (/X\s*DIA/.test(s)) return null;
  const m = s.match(/^(\d{1,4})\s*(DIAS?)?\.?$/);
  const n = m ? Number(m[1]) : NaN;
  return n > 0 && n <= 3000 ? n : null;
}

// CSV simple con comillas.
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// Busca la fila de encabezados y arma { SKU: costo }.
function tableToCosts(rows) {
  let hr = -1, skuCol = -1, costCol = -1, nameCol = -1, stockCol = -1, priceCol = -1, durCol = -1;
  const up = (c) => String(c ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
  for (let r = 0; r < Math.min(rows.length, 40) && hr < 0; r++) {
    const cells = (rows[r] || []).map(up);
    let s = cells.findIndex(c => c === 'SKU');
    const c = cells.findIndex(c => /C(OSTO)? ?TOTAL ?\$ ?PESO/.test(c));
    // Si la columna del SKU no tiene título: la que está antes del nombre del artículo y tiene códigos sin espacios.
    if (s < 0 && c >= 0) {
      const body = rows.slice(r + 1, r + 40);
      const nameI = cells.findIndex(x => /^(ARTICULO|PRODUCTO|DESCRIPCION|NOMBRE)$/.test(x));
      const codeLike = (i) => body.filter(row => /^[A-Z0-9][A-Z0-9._\/-]{1,40}$/i.test(String((row || [])[i] ?? '').trim())).length;
      let bestI = -1, best = 0;
      for (let i = 0; i < (nameI > 0 ? nameI : c); i++) { const n = codeLike(i); if (n > best) { best = n; bestI = i; } }
      if (bestI >= 0 && best >= Math.min(5, body.length / 2)) s = bestI;
    }
    if (s >= 0 && c >= 0) { hr = r; skuCol = s; costCol = c; nameCol = cells.findIndex(c => /^(ARTICULO|PRODUCTO|DESCRIPCION|NOMBRE)$/.test(c)); stockCol = cells.findIndex(c => c === 'STOCK'); priceCol = cells.findIndex(c => /^WEB ?[=/] ?CLASICA$/.test(c)); durCol = cells.findIndex(c => /^DURACION( \(?DIAS\)?)?$/.test(c)); }
  }
  if (hr < 0) throw new Error('No encontré las columnas "SKU" y "C TOTAL $PESO" en la planilla.');
  const map = {}, withoutCost = [], items = [];
  let rowsWithCost = 0;
  for (let r = hr + 1; r < rows.length; r++) {
    const sku = key((rows[r] || [])[skuCol]);
    if (!sku) continue; // filas sin SKU (títulos, totales, etc.) se ignoran
    const cost = parseMoney((rows[r] || [])[costCol]);
    const stockN = stockCol >= 0 ? parseMoney((rows[r] || [])[stockCol]) : NaN;
    const priceN = priceCol >= 0 ? parseMoney((rows[r] || [])[priceCol]) : NaN;
    items.push({ sku, name: nameCol >= 0 ? String((rows[r] || [])[nameCol] ?? '').trim() : '', stock: Number.isFinite(stockN) ? stockN : null,
      cost: cost > 0 ? Math.round(cost * 100) / 100 : null, price: priceN > 0 ? Math.round(priceN) : null, // price: columna "WEB = CLÁSICA"
      days: durCol >= 0 ? parseDays((rows[r] || [])[durCol]) : null }); // days: columna "DURACION" (cuántos días dura)
    if (!(cost > 0)) { if (!(sku in map)) withoutCost.push(sku); continue; }
    rowsWithCost++;
    map[sku] = Math.max(map[sku] || 0, Math.round(cost * 100) / 100); // SKU repetido: el costo más alto
  }
  return { map, items, count: Object.keys(map).length, rows_with_cost: rowsWithCost, without_cost: withoutCost.filter(s => !(s in map)) };
}

// Link de Google Sheets → descarga CSV de esa pestaña.
function csvUrl(url) {
  const id = (String(url).match(/\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
  if (!id) throw new Error('El link no parece de Google Sheets.');
  const gid = (String(url).match(/[#?&]gid=(\d+)/) || [])[1];
  // Sin pestaña en el link: Google entrega la primera.
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
}

function save(result, source) {
  const data = { map: result.map, items: result.items, count: result.count, rows_with_cost: result.rows_with_cost, without_cost: result.without_cost, source, updated_at: new Date().toISOString() };
  store.saveCosts(data);
  return data;
}

let syncing = null;
async function syncFromSheet() {
  if (syncing) return syncing;
  const url = store.getSettings().costs_sheet_url || DEFAULT_SHEET_URL;
  syncing = (async () => {
    const r = await fetch(csvUrl(url), { redirect: 'follow' });
    if (!r.ok) throw new Error(`Google Sheets respondió ${r.status}. Revisá que la planilla esté compartida como "Cualquier persona con el enlace".`);
    const text = await r.text();
    if (/^\s*<!doctype html|<html/i.test(text)) throw new Error('Google Sheets pidió iniciar sesión: compartí la planilla como "Cualquier persona con el enlace: Lector".');
    return save(tableToCosts(parseCSV(text)), 'Google Sheets');
  })().finally(() => { syncing = null; });
  return syncing;
}

function fromRows(rows) { return save(tableToCosts(rows), 'Excel subido'); }

// Costo unitario de un SKU: primero el cargado a mano, después la planilla.
function costFor(sku) {
  const k = key(sku);
  if (!k) return null;
  const manual = store.getSettings().cost_manual || {};
  if (manual[k] > 0) return manual[k];
  const c = store.getCosts().map || {};
  return c[k] > 0 ? c[k] : null;
}

module.exports = { parseDays, DEFAULT_SHEET_URL, syncFromSheet, fromRows, costFor, key, parseMoney, parseCSV, tableToCosts };
