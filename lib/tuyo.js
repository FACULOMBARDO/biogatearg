// TUYO: cuenta de Mercado Libre con productos comprados en Amazon.
// El costo no sale de la lista de precios: se carga por publicación en dólares + peso.
// Costo US$ = precio US$ + kilos × US$ por kilo · Costo $ = costo US$ × tipo de cambio (1550).
// US$ por kilo: 32 para las ventas desde octubre 2026; 35 para las anteriores.
const store = require('./store');

const LB = 0.45359237, OZ = 0.028349523125;
const r2 = (n) => Math.round((n || 0) * 100) / 100;
function cfg() {
  const t = store.getSettings().tuyo || {};
  // Hasta septiembre 2026 el kilo salía US$ 35; desde octubre, el valor actual (32 si no se cambió después).
  const kg = t.kg_v2 && t.kg_usd > 0 ? t.kg_usd : 32;
  return { account_id: String(t.account_id || ''), kg_usd: kg, kg_before: t.kg_before > 0 ? t.kg_before : 35, kg_from: t.kg_from || '2026-10-01', tc: t.tc > 0 ? t.tc : 1550, items: t.items || {} };
}
const isTuyo = (accountId) => { const c = cfg(); return !!c.account_id && String(accountId) === c.account_id; };
const toKg = (w, unit) => (Number(w) || 0) * (unit === 'lb' ? LB : unit === 'oz' ? OZ : 1);
// Costo de una publicación cargada (null si no tiene datos).
// US$ por kilo según la fecha de la venta (sin fecha: el valor actual).
function kgUsdFor(date, c = cfg()) {
  if (!date) return c.kg_usd;
  const d = new Date(date).toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
  return d < c.kg_from ? c.kg_before : c.kg_usd;
}
function calc(it, c = cfg(), date) {
  if (!it || !(Number(it.usd) > 0)) return null;
  const kg = toKg(it.weight, it.unit), perKg = kgUsdFor(date, c);
  const usd = Number(it.usd) + kg * perKg;
  return { kg: Math.round(kg * 1000) / 1000, kg_usd: perKg, ship_usd: r2(kg * perKg), usd: r2(usd), ars: Math.round(usd * c.tc) };
}
// Costo unitario en pesos de un ítem vendido (por publicación), con el costo del kilo de la fecha de la venta.
function costFor(item, date) { const c = cfg(); const x = calc(c.items[item.item_id], c, date); return x ? x.ars : null; }

function saveConfig(b) {
  const t = { ...(store.getSettings().tuyo || {}) };
  if (b.account_id !== undefined) t.account_id = String(b.account_id || '');
  const num = (v) => Number(String(v ?? '').replace(/\./g, '').replace(',', '.'));
  if (b.kg_usd !== undefined) { const v = num(b.kg_usd); if (!(v > 0)) throw new Error('Poné cuánto sale el kilo en US$.'); t.kg_usd = v; t.kg_v2 = true; }
  if (b.tc !== undefined) { const v = num(b.tc); if (!(v > 0)) throw new Error('Poné el tipo de cambio.'); t.tc = v; }
  store.saveSettings({ tuyo: t });
  return cfg();
}
function saveItem(itemId, b) {
  if (!/^[A-Z]{3}\d+$/.test(String(itemId))) throw new Error('Publicación inválida.');
  const t = { ...(store.getSettings().tuyo || {}) };
  t.items = { ...(t.items || {}) };
  const num = (v) => { const n = Number(String(v ?? '').trim().replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const usd = num(b.usd), weight = num(b.weight), unit = ['kg', 'lb', 'oz'].includes(b.unit) ? b.unit : 'kg';
  if (!usd && !weight) delete t.items[itemId];
  else t.items[itemId] = { usd, weight, unit, title: String(b.title || '').slice(0, 160), updated_at: new Date().toISOString() };
  store.saveSettings({ tuyo: t });
  return { item: t.items[itemId] || null, cost: calc(t.items[itemId]) };
}

module.exports = { cfg, isTuyo, calc, costFor, kgUsdFor, saveConfig, saveItem, toKg };
