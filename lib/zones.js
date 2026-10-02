// Zonas de envío según el mapa: CAPITAL (rosa), GBA1 (verde), GBA2 (azul), GBA3 (rojo).
// Cada zona lista partidos y localidades tal como suelen venir en las direcciones de Mercado Libre.

const ZONES = {
  CAPITAL: { label: 'Capital', color: '#e05fd0' },
  GBA1: { label: 'GBA 1', color: '#1fae9b' },
  GBA2: { label: 'GBA 2', color: '#1f3a93' },
  GBA3: { label: 'GBA 3', color: '#e0322f' },
};

const DEFAULT_PRICES = { CAPITAL: 3500, GBA1: 5200, GBA2: 6800, GBA3: 8800 };

const CABA_BARRIOS = `Capital Federal, Ciudad Autonoma de Buenos Aires, CABA, Agronomia, Almagro, Balvanera, Barracas,
  Belgrano, Boedo, Caballito, Chacarita, Coghlan, Colegiales, Constitucion, Flores, Floresta, La Boca, Boca,
  La Paternal, Paternal, Liniers, Mataderos, Monte Castro, Montserrat, Monserrat, Nueva Pompeya, Pompeya, Nunez,
  Palermo, Parque Avellaneda, Parque Chacabuco, Parque Chas, Parque Patricios, Puerto Madero, Recoleta, Retiro,
  Saavedra, San Cristobal, San Nicolas, San Telmo, Velez Sarsfield, Versalles, Villa Crespo, Villa del Parque,
  Villa Devoto, Villa General Mitre, Villa Lugano, Lugano, Villa Luro, Villa Ortuzar, Villa Pueyrredon, Villa Real,
  Villa Riachuelo, Villa Santa Rita, Villa Soldati, Villa Urquiza, Once, Abasto, Barrio Norte, Congreso, Microcentro,
  Tribunales, Villa Crespo, Parque Centenario`;

const PROVINCE = {
  GBA1: `
    San Isidro, Acassuso, Martinez, Beccar, Boulogne, Boulogne Sur Mer, Villa Adelina,
    San Fernando, Victoria, Virreyes,
    Vicente Lopez, Olivos, Florida, Florida Oeste, La Lucila, Munro, Carapachay, Villa Martelli,
    General San Martin, San Martin, Villa Ballester, Jose Leon Suarez, San Andres, Villa Lynch, Villa Maipu,
    Billinghurst, Chilavert, Villa Zagala, Villa Chacabuco, Malaver, Villa Libertad, Tropezon, Villa Coronel Jose M Zapiola,
    Tres de Febrero, 3 de Febrero, Caseros, Ciudadela, Jose Ingenieros, Loma Hermosa, Martin Coronado, Once de Septiembre,
    Pablo Podesta, Remedios de Escalada de San Martin, Saenz Pena, Santos Lugares, Villa Bosch, Villa Raffo, Churruca, El Libertador,
    Hurlingham, William C Morris, William Morris, Villa Tesei,
    Ituzaingo, Villa Udaondo,
    Moron, Castelar, Haedo, El Palomar, Palomar, Villa Sarmiento,
    Ramos Mejia, Lomas del Mirador, Villa Luzuriaga, San Justo, La Tablada, Tapiales, Aldo Bonzi, Villa Madero,
    Ciudad Evita, Isidro Casanova, Villa Celina, Villa Insuperable,
    Avellaneda, Dock Sud, Sarandi, Wilde, Villa Dominico, Gerli, Pineyro, Crucecita,
    Lanus, Lanus Este, Lanus Oeste, Remedios de Escalada, Monte Chingolo, Valentin Alsina,
    Lomas de Zamora, Banfield, Temperley, Turdera, Llavallol, Lavallol, Ingeniero Budge, Villa Fiorito, Fiorito,
    Villa Centenario, Villa Albertina`,
  GBA2: `
    Tigre, Don Torcuato, General Pacheco, Pacheco, El Talar, Benavidez, Rincon de Milberg, Nordelta, Ricardo Rojas,
    Troncos del Talar, Dique Lujan, Villa La Nata,
    Malvinas Argentinas, Los Polvorines, Grand Bourg, Tortuguitas, Pablo Nogues, Ingeniero Pablo Nogues,
    Ingeniero Adolfo Sourdeaux, Adolfo Sourdeaux, Villa de Mayo, Tierras Altas,
    Jose C Paz, Jose Clemente Paz,
    San Miguel, Bella Vista, Muniz, Santa Maria,
    Moreno, Paso del Rey, La Reja, Francisco Alvarez, Trujui, Cuartel V, Las Catonas,
    Merlo, Parque San Martin, Libertad, Mariano Acosta, Pontevedra, San Antonio de Padua, Padua,
    Gregorio de Laferrere, Laferrere, Rafael Castillo, Gonzalez Catan, Virrey del Pino, 20 de Junio, Veinte de Junio,
    Ezeiza, Tristan Suarez, Carlos Spegazzini, Spegazzini, La Union, Canning, Jose Maria Ezeiza,
    Esteban Echeverria, Monte Grande, Luis Guillon, El Jaguel, 9 de Abril, Nueve de Abril,
    Almirante Brown, Adrogue, Burzaco, Longchamps, Glew, Jose Marmol, Rafael Calzada, Claypole,
    Ministro Rivadavia, Don Orione,
    Quilmes, Quilmes Oeste, Bernal, Bernal Oeste, Ezpeleta, Don Bosco, San Francisco Solano, Villa La Florida,
    Florencio Varela, Bosques, Zeballos, Gobernador Julio A Costa, Villa Vatteone, Villa Brown, Ingeniero Allan,
    Berazategui, Ranelagh, Sourigues, Platanos, Hudson, Guillermo Hudson, Gutierrez, Juan Maria Gutierrez,
    El Pato, Villa Espana, Pereyra`,
  GBA3: `
    Escobar, Belen de Escobar, Garin, Ingeniero Maschwitz, Maschwitz, Maquinista Savio, Matheu, Loma Verde,
    Puerto de Escobar,
    Pilar, Del Viso, Presidente Derqui, Derqui, Villa Rosa, Fatima, Manzanares, La Lonja, Villa Astolfi,
    Manuel Alberti, Zelaya, Lagomarsino,
    General Rodriguez, Marcos Paz, Canuelas, Alejandro Petion, Maximo Paz, Vicente Casares, Uribelarrea,
    San Vicente, Alejandro Korn, Domselaar, Presidente Peron, Guernica, La Capilla,
    Ensenada, Punta Lara, Berisso,
    La Plata, City Bell, Gonnet, Manuel B Gonnet, Villa Elisa, Tolosa, Ringuelet, Los Hornos, Melchor Romero,
    Abasto, Olmos, Lisandro Olmos, Villa Elvira, San Carlos, Joaquin Gorina, Gorina, Arturo Segui, Hernandez`,
};

const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

const list = (txt) => txt.split(',').map(norm).filter(Boolean);
const CABA = new Set(list(CABA_BARRIOS));
const PROV = new Map();
for (const [zone, txt] of Object.entries(PROVINCE)) for (const name of list(txt)) if (!PROV.has(name)) PROV.set(name, zone);
// Para buscar nombres dentro de textos más largos, primero los más largos ("lanus oeste" antes que "lanus").
const PROV_KEYS = [...PROV.keys()].sort((a, b) => b.length - a.length);

function matchProvince(text) {
  const t = norm(text);
  if (!t) return null;
  if (PROV.has(t)) return PROV.get(t);
  const padded = ` ${t} `;
  for (const k of PROV_KEYS) if (padded.includes(` ${k} `)) return PROV.get(k);
  return null;
}

// Clave con la que se recuerda una localidad que el usuario asignó a mano.
const cityKey = (scan) => norm(scan.city) + '|' + norm(scan.state);

function autoZone(scan) {
  const st = norm(scan.state);
  const isCaba = /capital federal|ciudad autonoma|caba/.test(st);
  const isProv = /buenos aires/.test(st) && !isCaba;
  if (isCaba) return 'CAPITAL';
  for (const field of [scan.city, scan.neighborhood]) {
    const z = matchProvince(field);
    if (z) return z;
  }
  if (!isProv && (CABA.has(norm(scan.city)) || CABA.has(norm(scan.neighborhood)))) return 'CAPITAL';
  return null;
}

// Devuelve { zone, zone_source, cost } para un envío.
function zoneFor(scan, settings) {
  const prices = { ...DEFAULT_PRICES, ...(settings.prices || {}) };
  let zone = null, source = null;
  if (scan.zone_manual) { zone = scan.zone_manual; source = 'manual'; }
  else if (settings.learned && settings.learned[cityKey(scan)]) { zone = settings.learned[cityKey(scan)]; source = 'aprendida'; }
  else { zone = autoZone(scan); source = zone ? 'auto' : null; }
  return { zone, zone_source: source, cost: zone ? Number(prices[zone]) || 0 : null };
}

module.exports = { ZONES, DEFAULT_PRICES, zoneFor, cityKey, autoZone, norm };
