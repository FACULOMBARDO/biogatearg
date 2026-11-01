// Comparar una publicación tuya con quienes venden el mismo producto (el que gana el catálogo, el que más vende
// y el más barato): precio, envío, Full, cuotas, fotos, clip, ficha técnica, título, descripción, opiniones,
// descuento y reputación. Devuelve una lista concreta de cambios para vender más y posicionar mejor.
const store = require('./store');
const ml = require('./ml');
const { get, pick } = ml;

async function retry(fn) {
  let r = null;
  for (let i = 0; i < 3; i++) {
    r = await fn().catch(e => ({ ok: false, status: 0, data: { message: e.message } }));
    if (r.ok || (r.status && r.status !== 429 && r.status < 500)) return r;
    await new Promise(ok => setTimeout(ok, 700 * 2 ** i));
  }
  return r;
}
const money = (n) => '$ ' + Math.round(n || 0).toLocaleString('es-AR');
const POWER = { platinum: 'MercadoLíder Platinum', gold: 'MercadoLíder Gold', silver: 'MercadoLíder' };
const LEVEL = { '5_green': 'Verde', '4_light_green': 'Verde claro', '3_yellow': 'Amarilla', '2_orange': 'Naranja', '1_red': 'Roja' };
const STOP = new Set(['de', 'la', 'el', 'en', 'con', 'para', 'por', 'y', 'x', 'a', 'del', 'los', 'las', 'un', 'una', 'mg', 'g', 'gr', 'kg', 'ml', 'caps', 'capsulas', 'cápsulas', 'unidades', 'u', 'pack', 'ar', '-', '+']);
const words = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w));

// Toda la info de una publicación (propia o de otro vendedor).
async function snapshot(acc, id) {
  const [it, desc, rev] = await Promise.all([
    retry(() => get(acc, `/items/${id}?include_attributes=all`)),
    retry(() => get(acc, `/items/${id}/description`)),
    retry(() => get(acc, `/reviews/item/${id}`)),
  ]);
  if (!it || !it.ok) return null;
  const b = it.data;
  const u = await retry(() => get(acc, `/users/${b.seller_id}`));
  const rep = u && u.ok ? u.data.seller_reputation || {} : {};
  const attrs = (b.attributes || []).filter(a => (a.value_name || a.value_id) && !['SELLER_SKU', 'ITEM_CONDITION'].includes(a.id));
  return {
    id: b.id, title: b.title, link: b.permalink, price: b.price, original_price: b.original_price || null, sold: b.sold_quantity ?? null, stock: b.available_quantity ?? null,
    seller_id: String(b.seller_id), seller: u && u.ok ? u.data.nickname : '', power: rep.power_seller_status || null, level: rep.level_id || null, official: !!b.official_store_id,
    full: pick(b.shipping?.logistic_type) === 'fulfillment', flex: pick(b.shipping?.logistic_type) === 'self_service', free_ship: !!b.shipping?.free_shipping,
    premium: b.listing_type_id === 'gold_pro', listing_type: b.listing_type_id, catalog: !!b.catalog_listing, catalog_product_id: b.catalog_product_id || null,
    pictures: (b.pictures || []).length, video: !!b.video_id, attrs: attrs.map(a => ({ id: a.id, name: a.name, value: a.value_name })), attrs_n: attrs.length,
    desc_len: desc && desc.ok ? String(desc.data.plain_text || '').length : 0, rating: rev && rev.ok ? Number(rev.data.rating_average) || null : null, reviews: rev && rev.ok ? Number(rev.data.paging?.total ?? rev.data.reviews?.length ?? 0) : 0,
    manufacturing: ((b.sale_terms || []).find(t => t.id === 'MANUFACTURING_TIME') || {}).value_name || '',
    health: typeof b.health === 'number' ? b.health : null, category_id: b.category_id,
  };
}

async function compare(accountId, itemId) {
  const acc = store.getAccount(String(accountId));
  if (!acc) throw new Error('La cuenta no está conectada.');
  const me = await snapshot(acc, itemId);
  if (!me) throw new Error('No pude leer tu publicación.');
  // Producto de catálogo: el de mi publicación, el vinculado en Competencia o el más parecido por título.
  let pid = me.catalog_product_id, how = 'catalog';
  if (!pid) {
    try { const g = Object.values(store.getCompetition().groups || {}).find(x => (x.competitors || []).length && store.getListings().items[itemId] && (x.key === String(store.getListings().items[itemId].sku || '').toUpperCase().replace(/\s+/g, ''))); if (g) { pid = g.product_id; how = 'competencia'; } } catch { /* nada */ }
  }
  if (!pid) {
    const r = await retry(() => get(acc, `/products/search?status=active&site_id=MLA&q=${encodeURIComponent(me.title.slice(0, 100))}&limit=1`));
    const p = r && r.ok ? (r.data.results || [])[0] : null;
    if (p) { pid = p.id; how = 'titulo'; }
  }
  if (!pid) return { me, others: [], actions: [{ prio: 1, text: 'No encontré a nadie más vendiendo este producto en el catálogo de ML. Sumá ficha técnica completa, 6+ fotos y un título con marca, modelo y contenido para posicionar.' }], product: null };
  const [pr, its] = await Promise.all([retry(() => get(acc, `/products/${pid}`)), retry(() => get(acc, `/products/${pid}/items?limit=50`))]);
  const mineIds = new Set(store.getAccounts().map(a => String(a.user_id)));
  const list = (its && its.ok ? its.data.results || [] : []).filter(x => !mineIds.has(String(x.seller_id)));
  const winner = pr && pr.ok ? pick(pr.data.buy_box_winner?.item_id) : '';
  // Vendidos de cada uno para elegir al que más vende
  const sold = {};
  for (let i = 0; i < list.length; i += 20) {
    const r = await retry(() => get(acc, `/items?ids=${list.slice(i, i + 20).map(x => x.item_id).join(',')}&attributes=id,sold_quantity`));
    for (const y of (r && r.ok && Array.isArray(r.data) ? r.data : [])) if (y.code === 200 && y.body) sold[y.body.id] = y.body.sold_quantity || 0;
  }
  const byPrice = [...list].sort((a, b) => a.price - b.price);
  const bySold = [...list].sort((a, b) => (sold[b.item_id] || 0) - (sold[a.item_id] || 0));
  const pickIds = [];
  const add = (id, role) => { if (id && !mineIds.has(id) && !pickIds.some(p => p.id === id) && list.some(x => x.item_id === id)) pickIds.push({ id, role }); };
  add(winner, 'Gana el catálogo'); add(bySold[0] && bySold[0].item_id, 'El que más vende'); add(byPrice[0] && byPrice[0].item_id, 'El más barato');
  const others = [];
  for (const p of pickIds.slice(0, 3)) { const s = await snapshot(acc, p.id); if (s) others.push({ ...s, role: p.role }); }
  const leader = others.find(o => o.role === 'El que más vende') || others[0];
  const actions = [];
  const A = (prio, text) => actions.push({ prio, text });
  if (leader) {
    const L = leader;
    if (L.price < me.price * 0.97) A(1, `Precio: ${L.seller || 'el líder'} vende a ${money(L.price)} y vos a ${money(me.price)} (${Math.round((me.price / L.price - 1) * 100)}% más caro). Si tu margen lo permite, acercate a ${money(Math.max(L.price, L.price * 1.02))}.`);
    else if (L.price > me.price * 1.1 && (L.sold || 0) > (me.sold || 0)) A(3, `Precio: vendés ${Math.round((1 - me.price / L.price) * 100)}% más barato que el líder y él vende más: el precio no es el problema, mejorá lo demás (y quizás podés subir).`);
    if (L.full && !me.full) A(1, `Envío: ${L.seller || 'el líder'} está en Full (llega en 24 h y ML lo prioriza). Mandá este producto a Full${me.flex ? '' : ' o activá Flex'}.`);
    else if (L.flex && !me.full && !me.flex) A(2, 'Envío: el líder tiene Flex (entrega en el día). Activá Flex o Full.');
    if (L.free_ship && !me.free_ship) A(2, me.price >= 33000 ? 'Envío gratis: el líder lo ofrece y tu publicación no lo muestra. Revisá la configuración de envío de esta publicación.' : `Envío gratis: el líder lo ofrece y vos no (por debajo de $ 33.000 lo paga el comprador). Evaluá absorberlo o llevar el precio a $ 33.000 para que quede gratis.`);
    if (L.premium && !me.premium) A(2, 'Cuotas: el líder publica en Premium (cuotas sin interés) y vos en Clásica. En productos de este precio suele subir mucho la conversión.');
    if (me.manufacturing && !L.manufacturing) A(1, `Disponibilidad: tu publicación tiene entrega a plazo (${me.manufacturing}) y el líder entrega inmediato. Eso baja mucho la conversión y el posicionamiento.`);
    if (L.original_price && !me.original_price) A(2, `Descuento: el líder muestra precio tachado (${money(L.original_price)} → ${money(L.price)}). Aplicá un descuento propio desde Mis publicaciones: se ve mejor en la búsqueda.`);
    if (L.pictures > me.pictures + 1 || me.pictures < 6) A(2, `Fotos: tenés ${me.pictures} y el líder ${L.pictures}. Sumá hasta 8–10: etiqueta, tabla nutricional, modo de uso, tamaño real.`);
    if (L.video && !me.video) A(2, 'Clip: el líder tiene video y vos no. Los clips suman exposición en ML.');
    const mineAttr = new Set(me.attrs.map(a => a.id));
    const missing = L.attrs.filter(a => !mineAttr.has(a.id) && !['GTIN', 'SELLER_PACKAGE_HEIGHT', 'SELLER_PACKAGE_WIDTH', 'SELLER_PACKAGE_LENGTH', 'SELLER_PACKAGE_WEIGHT'].includes(a.id));
    if (missing.length) A(1, `Ficha técnica: el líder completó ${missing.length} datos que vos no: ${missing.slice(0, 8).map(a => `${a.name}${a.value ? ` (${a.value})` : ''}`).join(', ')}${missing.length > 8 ? '…' : ''}. Completalos desde Mis publicaciones → Calidad y ficha.`);
    const myW = new Set(words(me.title)), extra = [...new Set(others.flatMap(o => words(o.title)))].filter(w => !myW.has(w)).slice(0, 6);
    if (extra.length) A(2, `Título: los que más venden usan palabras que tu título no tiene: ${extra.map(w => `"${w}"`).join(', ')}. Si aplican a tu producto, sumalas (máx. 60 caracteres)${(store.getListings().items[itemId] || {}).sold > 0 ? '. Ojo: con ventas, ML no deja cambiar el título; en ese caso publicá una nueva con el título mejorado' : ''}.`);
    if (me.title.length < 45) A(3, `Título corto (${me.title.length} caracteres): usá Producto + Marca + Modelo + Contenido + Variante.`);
    if (L.desc_len > me.desc_len * 1.5 && L.desc_len > 400) A(3, `Descripción: la tuya tiene ${me.desc_len} caracteres y la del líder ${L.desc_len}. Hacela más completa (podés usar ✨ Escribir con IA).`);
    if ((L.reviews || 0) > (me.reviews || 0) + 5) A(3, `Opiniones: el líder tiene ${L.reviews} (${L.rating || '—'}★) y vos ${me.reviews || 0}. Cuidá la post-venta (embalaje, mensaje de seguimiento) para sumar opiniones.`);
    if (me.rating && me.rating < 4.3) A(2, `Tus opiniones promedian ${me.rating}★: revisalas, algo del producto o del envío no está gustando.`);
    if (L.power && !me.power) A(3, `Reputación: el líder es ${POWER[L.power]} y esta cuenta no tiene MercadoLíder. ML favorece a los MercadoLíder: mirá Salud de cuentas.`);
    if (!me.catalog && L.catalog) A(2, 'Catálogo: este producto se vende en catálogo y tu publicación no participa. Publicá también en catálogo para competir por "Comprar".');
    if (winner && !others.some(o => o.id === winner) && me.id !== winner) { /* nada */ }
    if (me.stock != null && me.stock <= 2 && !me.full) A(2, `Stock: te quedan ${me.stock}. Con poco stock ML muestra menos la publicación.`);
  }
  if (!actions.length) A(3, 'Tu publicación está a la par de la competencia. Para crecer: publicidad (Product Ads) en esta publicación y mantener stock.');
  actions.sort((a, b) => a.prio - b.prio);
  const quick = [];
  if (!me.full && !me.flex) quick.push('flex');
  if (!me.premium && me.listing_type === 'gold_special') quick.push('premium');
  if (!me.original_price) quick.push('discount');
  return { me, others, actions, quick, account_id: String(accountId), product: pr && pr.ok ? { id: pid, name: pr.data.name, how } : { id: pid, how }, competitors_n: list.length, i_win_buybox: winner && winner === itemId };
}

module.exports = { compare };
