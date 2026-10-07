// TUYO: cuenta de Mercado Libre con productos comprados en Amazon.
// El costo no sale de la lista de precios: se carga por publicación en dólares + peso.
// Costo US$ = precio US$ + kilos × US$ por kilo (35) · Costo $ = costo US$ × tipo de cambio (1550).
const store = require('./store');

const LB = 0.45359237, OZ = 0.028349523125;
const r2 = (n) => Math.round((n || 0) * 100) / 100;
function cfg() {
  const t = store.getSettings().tuyo || {};
  return { account_id: String(t.account_id || ''), kg_usd: t.kg_usd > 0 ? t.kg_usd : 35, tc: t.tc > 0 ? t.tc : 1550, items: t.items || {} };
}
const isTuyo = (accountId) => { const c = cfg(); return !!c.account_id && String(accountId) === c.account_id; };
const toKg = (w, unit) => (Number(w) || 0) * (unit === 'lb' ? LB : unit === 'oz' ? OZ : 1);
// Costo de una publicación cargada (null si no tiene datos).
function calc(it, c = cfg()) {
  if (!it || !(Number(it.usd) > 0)) return null;
  const kg = toKg(it.weight, it.unit);
  const usd = Number(it.usd) + kg * c.kg_usd;
  return { kg: Math.round(kg * 1000) / 1000, ship_usd: r2(kg * c.kg_usd), usd: r2(usd), ars: Math.round(usd * c.tc) };
}
// Costo unitario en pesos de un ítem vendido (por publicación).
function costFor(item) { const x = calc(cfg().items[item.item_id]); return x ? x.ars : null; }

function saveConfig(b) {
  const t = { ...(store.getSettings().tuyo || {}) };
  if (b.account_id !== undefined) t.account_id = String(b.account_id || '');
  const num = (v) => Number(String(v ?? '').replace(/\./g, '').replace(',', '.'));
  if (b.kg_usd !== undefined) { const v = num(b.kg_usd); if (!(v > 0)) throw new Error('Poné cuánto sale el kilo en US$.'); t.kg_usd = v; }
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

module.exports = { cfg, isTuyo, calc, costFor, saveConfig, saveItem, toKg };
