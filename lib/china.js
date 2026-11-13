// Publicar desde China: lee links de AliExpress, Alibaba y 1688 y arma el costo.
// Costo = precio de 1 unidad + envío dentro de China (si hay) + kilos × US$ por kilo (envío China → Argentina),
// todo en dólares y pasado a pesos con el mismo dólar que usa TUYO. 1688 está en yuanes: se pasan a dólares (6,6 ¥ = US$ 1).
// Estas páginas bloquean seguido a los programas que las leen: si no se puede, se avisa y se completa a mano.
const store = require('./store');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

function cfg() {
  const c = store.getSettings().china || {};
  return { kg_usd: c.kg_usd > 0 ? Number(c.kg_usd) : 35, cny_usd: c.cny_usd > 0 ? Number(c.cny_usd) : 6.6, tc: require('./tuyo').cfg().tc };
}
function saveCfg(b) {
  const s = store.getSettings(); s.china = s.china || {};
  if (Number(b.kg_usd) > 0) s.china.kg_usd = Number(b.kg_usd);
  if (Number(b.cny_usd) > 0) s.china.cny_usd = Number(b.cny_usd);
  store.saveSettings({ china: s.china });
  return cfg();
}

function site(link) {
  const u = String(link || '');
  if (/1688\.com/i.test(u)) return '1688';
  if (/aliexpress\./i.test(u)) return 'aliexpress';
  if (/alibaba\.com/i.test(u)) return 'alibaba';
  return '';
}
const SITE_NAME = { '1688': '1688', aliexpress: 'AliExpress', alibaba: 'Alibaba' };

const txt = (s) => String(s || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const meta = (html, prop) => ((html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i')) || [])[1] || '');

// Fotos del producto que aparecen en la página (servidores de Alibaba/AliExpress/1688), en tamaño grande
function pictures(html) {
  const raw = [...html.matchAll(/(?:https?:)?\/\/(?:ae\d*\.alicdn\.com|s\.alicdn\.com|cbu01\.alicdn\.com|img\.alicdn\.com|sc\d*\.alicdn\.com|ae-pic-a1\.aliexpress-media\.com)\/[^"'\s\\)]+?\.(?:jpg|jpeg|png|webp)/gi)].map(m => m[0]);
  const clean = raw.map(u => (u.startsWith('//') ? 'https:' + u : u).replace(/_\d+x\d+(q\d+)?\.(jpg|jpeg|png|webp)(_\.webp)?$/i, '').replace(/\.(\d+x\d+)\.(jpg|png)$/i, '.$2'))
    .filter(u => !/(icon|logo|avatar|sprite|tps\/|\/imgextra\/.*-2-tps|\d{2}x\d{2}\.)/i.test(u));
  return [...new Set(clean)].slice(0, 12);
}

async function fromChina(link) {
  const u = String(link || '').trim();
  const s = site(u);
  if (!s) throw new Error('Ese no parece un link de AliExpress, Alibaba o 1688.');
  const id = (u.match(/(?:item|offer|product-detail\/[^/]*?_?)\/?(\d{6,})\.html/i) || u.match(/(\d{8,})/) || [])[1] || '';
  const out = { source: 'china', site: s, site_name: SITE_NAME[s], source_id: id, link: u, title: '', title_es: '', currency: s === '1688' ? 'CNY' : 'USD', price: null, tiers: [], local_ship: null, weight_kg: null, pictures: [], bullets: [], description: '', attributes: [], blocked: false, reason: '' };
  let html = '';
  try {
    const r = await fetch(u, { headers: { 'user-agent': UA, 'accept-language': s === '1688' ? 'zh-CN,zh;q=0.9' : 'en-US,en;q=0.9', accept: 'text/html' }, signal: AbortSignal.timeout(15000), redirect: 'follow' });
    html = await r.text();
    const head = html.slice(0, 40000);
    if (!r.ok) throw new Error('la página respondió ' + r.status);
    if (/login\.1688\.com|login\.taobao\.com|passport\.alibaba\.com\/.*login|_____tmd_____|punish|slide to verify|captcha|nc_1_n1z|x5secdata/i.test(head + r.url)) throw new Error(s === '1688' ? '1688 pidió iniciar sesión' : 'la página pidió verificar que no sos un robot');
  } catch (e) { out.blocked = true; out.reason = e.message === 'This operation was aborted' ? 'la página tardó demasiado' : e.message; return out; }

  out.title = txt(meta(html, 'og:title') || (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]).replace(/\s*[-|]\s*(AliExpress|Alibaba\.com|1688\.com|阿里巴巴).*$/i, '');
  out.pictures = pictures(html);
  const og = meta(html, 'og:image'); if (og && !out.pictures.length) out.pictures = [og.startsWith('//') ? 'https:' + og : og];

  // El resto (precio, escalones por cantidad, envío dentro de China, peso, características) lo saca la IA del texto de la página
  const ai = require('./ai');
  if (ai.ready()) {
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(x => /price|Price|sku|weight|subject|offer/i.test(x)).join('\n').slice(0, 25000);
    const pageText = txt(html).slice(0, 15000);
    try {
      const d = await ai.extractChina({ site: SITE_NAME[s], title: out.title, text: pageText, data: scripts });
      if (d.titulo_original && !out.title) out.title = d.titulo_original;
      out.title_es = d.titulo_es || '';
      if (d.moneda && /CNY|RMB|¥|yuan/i.test(d.moneda)) out.currency = 'CNY'; else if (d.moneda && /USD|US\$|\$/i.test(d.moneda)) out.currency = 'USD';
      out.price = Number(d.precio_unidad) > 0 ? Number(d.precio_unidad) : null;
      out.tiers = (d.escalones || []).filter(t => Number(t.precio) > 0).map(t => ({ min: Number(t.desde) || 1, max: Number(t.hasta) || null, price: Number(t.precio) })).slice(0, 6);
      if (!out.price && out.tiers.length) out.price = out.tiers[0].price;
      out.local_ship = Number(d.envio_dentro_china) >= 0 && d.envio_dentro_china !== null && d.envio_dentro_china !== undefined ? Number(d.envio_dentro_china) : null;
      out.weight_kg = Number(d.peso_kg) > 0 ? Number(d.peso_kg) : null;
      out.bullets = (d.caracteristicas || []).filter(Boolean).slice(0, 12);
      out.description = out.bullets.map(b => '• ' + b).join('\n');
      out.min_order = Number(d.compra_minima) > 1 ? Number(d.compra_minima) : null;
    } catch (e) { out.ai_error = e.message; }
  }
  if (!out.title) { out.blocked = true; out.reason = 'no pude leer el producto'; }
  return out;
}

// Costo de 1 unidad puesto en Argentina
function cost(b) {
  const c = cfg();
  const toUsd = (v) => (b.currency === 'CNY' ? (Number(v) || 0) / c.cny_usd : Number(v) || 0);
  const unit = toUsd(b.price), local = toUsd(b.local_ship), kg = Number(b.kg) || 0;
  const ship = kg * c.kg_usd, total = unit + local + ship;
  const r2 = (x) => Math.round(x * 100) / 100;
  return { currency: b.currency === 'CNY' ? 'CNY' : 'USD', unit_usd: r2(unit), local_usd: r2(local), kg, kg_usd: c.kg_usd, ship_usd: r2(ship), total_usd: r2(total), cny_usd: c.cny_usd, tc: c.tc, cost: Math.round(total * c.tc) };
}

module.exports = { fromChina, cost, cfg, saveCfg, site };
