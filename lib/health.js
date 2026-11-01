// Salud de las cuentas: reputación de Mercado Libre de cada cuenta (color, MercadoLíder, reclamos, demoras y
// cancelaciones de los últimos 60 días), historial diario y alertas antes de que una cuenta baje de color.
const store = require('./store');
const ml = require('./ml');
const { get } = ml;

const H = () => store.getHealth();
const now = () => new Date().toISOString();
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
// Límites para las alertas (% de las ventas de los últimos 60 días). Son orientativos y prudentes: se pueden cambiar.
const DEFAULT_LIMITS = { claims: 1, cancellations: 1, delayed: 10, warn_at: 70 };
const limits = () => ({ ...DEFAULT_LIMITS, ...(H().limits || {}) });
const LEVEL = { '5_green': { n: 5, name: 'Verde', color: '#16a34a' }, '4_light_green': { n: 4, name: 'Verde claro', color: '#84cc16' }, '3_yellow': { n: 3, name: 'Amarilla', color: '#eab308' }, '2_orange': { n: 2, name: 'Naranja', color: '#f97316' }, '1_red': { n: 1, name: 'Roja', color: '#dc2626' } };
const POWER = { platinum: 'MercadoLíder Platinum', gold: 'MercadoLíder Gold', silver: 'MercadoLíder' };

function metric(m, limitPct, sales) {
  if (!m) return null;
  const rate = Number(m.rate) || 0, value = Number(m.value) || 0;
  const real = m.excluded ? { value: Number(m.excluded.real_value) || 0, rate: Number(m.excluded.real_rate) || 0 } : null;
  const allowed = sales ? Math.floor(sales * limitPct / 100) : null;
  return {
    rate_pct: Math.round(rate * 10000) / 100, value, limit_pct: limitPct,
    // Cuántos más "entran" antes de pasar el límite (aprox., con las ventas de los últimos 60 días)
    left: allowed != null ? Math.max(0, allowed - value) : null,
    use_pct: limitPct ? Math.round(rate * 100 / limitPct * 100) : 0,
    real_pct: real ? Math.round(real.rate * 10000) / 100 : null, real_value: real ? real.value : null,
  };
}

async function refresh() {
  const L = limits(), out = [], d = today();
  const hist = H().hist || (H().hist = {});
  for (const acc of store.getAccounts()) {
    const row = { account_id: String(acc.user_id), account: acc.nickname || String(acc.user_id), reconnect: !!acc.needs_reconnect };
    if (acc.needs_reconnect) { out.push(row); continue; }
    const r = await get(acc, `/users/${acc.user_id}`).catch(e => ({ ok: false, data: { message: e.message } }));
    if (!r.ok) { row.error = (r.data && r.data.message) || 'error'; out.push(row); continue; }
    const rep = r.data.seller_reputation || {}, m = rep.metrics || {}, sales = Number(m.sales && m.sales.completed) || 0;
    Object.assign(row, {
      level: rep.level_id || null, level_info: LEVEL[rep.level_id] || null, real_level: rep.real_level || null, protected_until: rep.protection_end_date || null,
      power: rep.power_seller_status || null, power_name: POWER[rep.power_seller_status] || '',
      sales_60: sales, period: (m.sales && m.sales.period) || '60 days',
      claims: metric(m.claims, L.claims, sales), cancellations: metric(m.cancellations, L.cancellations, sales), delayed: metric(m.delayed_handling_time, L.delayed, sales),
      ratings: rep.transactions && rep.transactions.ratings ? rep.transactions.ratings : null,
    });
    // Historial diario (un registro por día)
    const h = hist[row.account_id] = (hist[row.account_id] || []).filter(x => x.d !== d && x.d >= new Date(Date.now() - 120 * 86400e3).toISOString().slice(0, 10));
    h.push({ d, level: row.level, power: row.power, c: row.claims ? row.claims.rate_pct : null, x: row.cancellations ? row.cancellations.rate_pct : null, t: row.delayed ? row.delayed.rate_pct : null, s: sales });
    h.sort((a, b) => a.d.localeCompare(b.d));
    // Alertas
    const alerts = [], prev = h.length > 1 ? h[h.length - 2] : null;
    const lvl = (id) => (LEVEL[id] || {}).n || 0;
    if (prev && prev.level && row.level && lvl(row.level) < lvl(prev.level)) alerts.push({ sev: 'alta', text: `Bajó la reputación de ${LEVEL[prev.level]?.name || prev.level} a ${LEVEL[row.level]?.name || row.level}.` });
    if (prev && prev.power && !row.power) alerts.push({ sev: 'alta', text: `Perdió ${POWER[prev.power] || 'MercadoLíder'}.` });
    if (row.level && lvl(row.level) <= 3) alerts.push({ sev: 'alta', text: `La reputación está en ${LEVEL[row.level]?.name || row.level}: pierde exposición y ventas.` });
    if (row.real_level && !/green/.test(row.real_level) && row.protected_until) alerts.push({ sev: 'media', text: `Está protegida hasta ${new Date(row.protected_until).toLocaleDateString('es-AR')}, pero la reputación real es ${row.real_level}.` });
    for (const [k, name] of [['claims', 'reclamos'], ['cancellations', 'cancelaciones'], ['delayed', 'despachos con demora']]) {
      const x = row[k]; if (!x) continue;
      if (x.rate_pct > x.limit_pct) alerts.push({ sev: 'alta', text: `${name[0].toUpperCase() + name.slice(1)}: ${x.rate_pct}% (límite ${x.limit_pct}%).` });
      else if (x.use_pct >= L.warn_at) alerts.push({ sev: 'media', text: `${name[0].toUpperCase() + name.slice(1)}: ${x.rate_pct}%, cerca del límite de ${x.limit_pct}%${x.left != null ? ` (te quedan ~${x.left} antes de pasarlo)` : ''}.` });
    }
    row.alerts = alerts;
    row.history = h.slice(-30);
    out.push(row);
  }
  H().last = out; H().at = now();
  // Aviso a la compu/celular: una vez por día por cuenta, solo si hay alertas importantes.
  const sentDay = H().alerts || (H().alerts = {});
  const toSend = out.filter(r => (r.alerts || []).some(a => a.sev === 'alta') && sentDay[r.account_id] !== d);
  if (toSend.length) {
    for (const r of toSend) sentDay[r.account_id] = d;
    await require('./push').send('health', { title: '🛡️ Reputación en riesgo', body: toSend.map(r => `${r.account}: ${r.alerts.find(a => a.sev === 'alta').text}`).join('\n'), tag: 'health', url: '/#salud', sticky: true }).catch(() => {});
  }
  store.saveHealth();
  return list();
}
function list() { return { items: H().last || [], at: H().at || null, limits: limits() }; }
function saveLimits(b) {
  const n = (v, d, max) => { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) && x > 0 && x <= max ? x : d; };
  H().limits = { claims: n(b.claims, DEFAULT_LIMITS.claims, 50), cancellations: n(b.cancellations, DEFAULT_LIMITS.cancellations, 50), delayed: n(b.delayed, DEFAULT_LIMITS.delayed, 100), warn_at: n(b.warn_at, DEFAULT_LIMITS.warn_at, 100) };
  store.saveHealth();
  return limits();
}

module.exports = { refresh, list, saveLimits };
