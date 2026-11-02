// Sueldos (solo el dueño): por persona, sueldo, cargas sociales (si tiene y cuánto) y comisiones de cada mes.
// El total del mes se descuenta del resultado del mes, igual que los gastos.
const crypto = require('crypto');
const store = require('./store');

const P = () => store.getPayroll();
const people = () => P().people || (P().people = []);
const months = () => P().months || (P().months = {});
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => { const t = String(v ?? '').trim(); if (!t) return 0; const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/\.(?=\d{3}(\D|$))/g, '')); return Number.isFinite(n) && n > 0 ? r2(n) : 0; };
const validMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));

// Filas de un mes. Cada mes se carga aparte: si todavía no se guardó, aparece vacío (o se pueden copiar los montos del mes anterior).
const ROW_TOTAL = (r) => r2((r.salary || 0) + (r.has_charges ? r.charges || 0 : 0) + (r.os_diff || 0) + (r.commission || 0));
function month(m) {
  if (!validMonth(m)) throw new Error('Mes inválido.');
  const saved = months()[m];
  const rows = people().filter(p => p.active !== false || (saved && saved.rows && saved.rows[p.id])).map(p => {
    const r = (saved && saved.rows && saved.rows[p.id]) || { salary: 0, has_charges: false, charges: 0, os_diff: 0, commission: 0, note: '' };
    return { person_id: p.id, name: p.name, active: p.active !== false, os_diff: 0, ...r, total: ROW_TOTAL(r) };
  });
  const sum = (f) => r2(rows.reduce((t, r) => t + (f(r) || 0), 0));
  return { month: m, saved: !!saved, rows, total: sum(r => r.total), salary: sum(r => r.salary), charges: sum(r => (r.has_charges ? r.charges : 0)), os_diff: sum(r => r.os_diff), commission: sum(r => r.commission) };
}
// Total del mes para descontar en el resultado: solo los meses guardados.
function totalFor(m) { try { return months()[m] ? month(m).total : 0; } catch { return 0; } }
// Montos del último mes guardado anterior a "m" (para copiarlos y editarlos).
function previous(m) {
  const prev = Object.keys(months()).filter(k => k < m).sort().pop();
  return prev ? { month: prev, rows: month(prev).rows } : null;
}

function savePerson(b) {
  const name = String(b.name || '').trim().slice(0, 50);
  if (!name) throw new Error('Poné el nombre.');
  let p = b.id ? people().find(x => x.id === b.id) : null;
  if (!p) { p = { id: crypto.randomBytes(5).toString('hex'), created_at: new Date().toISOString() }; people().push(p); }
  Object.assign(p, { name, active: b.active !== false });
  store.savePayroll();
  return p;
}
function removePerson(id) {
  const used = Object.values(months()).some(m => m.rows && m.rows[id]);
  if (used) { const p = people().find(x => x.id === id); if (p) p.active = false; } // si ya tiene meses cargados, se da de baja (no se borra la historia)
  else P().people = people().filter(x => x.id !== id);
  store.savePayroll();
}
function saveMonth(m, rows) {
  if (!validMonth(m)) throw new Error('Mes inválido.');
  const out = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!people().some(p => p.id === r.person_id)) continue;
    out[r.person_id] = { salary: num(r.salary), has_charges: !!r.has_charges, charges: r.has_charges ? num(r.charges) : 0, os_diff: num(r.os_diff), commission: num(r.commission), note: String(r.note || '').slice(0, 120) };
  }
  months()[m] = { rows: out, updated_at: new Date().toISOString() };
  store.savePayroll();
  return month(m);
}
function history(n = 12) {
  const out = [];
  const d = new Date(); d.setUTCDate(1);
  for (let i = 0; i < n; i++) { const m = d.toISOString().slice(0, 7); out.push({ month: m, total: months()[m] ? month(m).total : null }); d.setUTCMonth(d.getUTCMonth() - 1); }
  return out;
}

module.exports = { previous, month, totalFor, savePerson, removePerson, saveMonth, history, people: () => people() };
