// Aprender: centro de capacitación del equipo.
// Cursos cortos escritos para Biogate (cómo se trabaja acá y con el panel) + links al material gratis
// de Mercado Libre (CLIC, Centro de vendedores, Ayuda). Cada curso tiene lecciones y una prueba corta.
// Se guarda quién leyó cada lección y la nota de cada prueba. El dueño ve el avance de todos y
// puede marcar cursos como obligatorios para cada persona.
const store = require('./store');

const PASS = 80; // % para aprobar
const L = () => { const d = store.getLearn(); d.progress = d.progress || {}; d.required = d.required || {}; return d; };

// Material oficial y gratis de Mercado Libre (se abre en su página)
const OFFICIAL = [
  { t: 'CLIC — formación gratis de Mercado Libre', u: 'https://www.formacionclic.com/', d: 'Plataforma gratis de Mercado Libre para emprendedores y pymes. 6 módulos a tu ritmo (unas 5 horas): comercio electrónico, cómo crear publicaciones, estrategia comercial y empezar a vender. Cada uno se anota con su mail.' },
  { t: 'Centro de vendedores de Mercado Libre', u: 'https://vendedores.mercadolibre.com.ar/', d: 'Guías y notas gratis de Mercado Libre: fotos, títulos, envíos, Full, publicidad, reputación. Cada tanto anuncian webinars en vivo gratis.' },
  { t: 'Ayuda de Mercado Libre', u: 'https://www.mercadolibre.com.ar/ayuda', d: 'Las reglas oficiales: qué se puede publicar, costos, reclamos, envíos.' },
];

const CLIC = { t: 'CLIC (Mercado Libre, gratis)', u: 'https://www.formacionclic.com/' };
const CV = { t: 'Centro de vendedores de ML', u: 'https://vendedores.mercadolibre.com.ar/' };
const AY = { t: 'Ayuda de Mercado Libre', u: 'https://www.mercadolibre.com.ar/ayuda' };

// Texto de las lecciones: párrafos separados por línea en blanco, "- " para listas y **negrita**.
const COURSES = [
  {
    id: 'bienvenida', short: 'Bienvenida', icon: '👋', title: 'Bienvenida: cómo trabajamos en Biogate', minutes: 8, level: 'Básico',
    summary: 'Qué vendemos, dónde vendemos y para qué sirve cada parte del panel.',
    lessons: [
      { title: 'Qué es Biogate', body: `Biogate vende suplementos y productos de salud y bienestar (por ejemplo omega 3, magnesio, ashwagandha) y otros productos importados.

Vendemos por varios lados al mismo tiempo:
- **Mercado Libre**, con varias cuentas. Es donde más se vende.
- **La web biogate.com.ar** (WooCommerce).
- **Redes y WhatsApp**, con presupuestos y recibos que se arman en el panel.
- **El local.**

Lo más importante para nosotros: que el cliente reciba lo que compró, rápido y bien, y que nunca le prometamos algo que no podemos cumplir.` },
      { title: 'El panel: para qué sirve cada sección', body: `El panel junta todas las cuentas en un solo lugar. Cada persona ve solo las secciones que le dio el dueño.

- **Preguntas:** las preguntas de todas las cuentas de ML, con firmas y links para responder rápido.
- **Reclamos:** reclamos y devoluciones abiertas.
- **Publicar:** crear una publicación nueva en una o varias cuentas a la vez.
- **Mis publicaciones:** cambiar precio, stock, fotos, descripción, pausar o activar.
- **Envíos Flex y Escanear / Impresión de etiquetas:** lo que hay que despachar hoy.
- **Stock y Full:** qué tenemos en el depósito y qué hay en los depósitos de Mercado Libre.
- **Presupuestos:** recibos para ventas por redes, WhatsApp y local.
- **Tareas:** lo que tiene que hacer cada uno.
- **Aprender:** estos cursos.

Todo lo que hacés en el panel queda registrado con tu nombre.` },
      { title: 'Reglas de oro', body: `- **Nunca compartas tu usuario ni tu contraseña.** Cada uno entra con el suyo.
- **No toques configuraciones de cuentas de Mercado Libre** (claves, datos de facturación, renovar claves). Si algo parece raro, avisale al dueño.
- **Si no sabés, preguntá antes de hacer.** Un precio mal puesto o una publicación pausada sin querer cuesta ventas.
- **Los mensajes a clientes van sin emojis**, con buena ortografía y la firma que corresponde.
- **No inventes datos** de un producto (dosis, beneficios, medidas). Si no está en la etiqueta o en la ficha, no se dice.` },
    ],
    links: [CLIC],
    quiz: [
      { q: '¿Qué hacés si no sabés cómo cambiar algo en una publicación?', o: ['Pruebo hasta que salga', 'Pregunto antes de hacerlo', 'Lo pauso por las dudas'], a: 1, w: 'Un cambio mal hecho cuesta ventas. Primero se pregunta.' },
      { q: '¿Cómo van los mensajes a los clientes?', o: ['Con muchos emojis para que sean cálidos', 'Sin emojis, con buena ortografía y la firma', 'Cortos y sin saludo'], a: 1, w: 'Es la regla de Biogate para todos los mensajes a clientes.' },
      { q: 'Un cliente pregunta si un suplemento sirve para algo que no dice la etiqueta. ¿Qué hacés?', o: ['Le digo que sí para no perder la venta', 'Le respondo solo con lo que dice la etiqueta o la ficha', 'No le respondo'], a: 1, w: 'Nunca se inventan datos ni beneficios.' },
      { q: '¿Se puede usar el usuario del panel de otro compañero?', o: ['Sí, si me lo presta', 'No, cada uno entra con el suyo', 'Solo los fines de semana'], a: 1, w: 'Todo queda registrado con el nombre de quien lo hizo.' },
    ],
  },
  {
    id: 'publicar', short: 'Publicar', icon: '📝', title: 'Cómo publicar en Mercado Libre, paso a paso', minutes: 15, level: 'Básico',
    summary: 'Crear una publicación completa con la sección Publicar del panel, sin errores.',
    lessons: [
      { title: 'Antes de publicar: qué tener a mano', body: `Antes de empezar, juntá:
- **El producto real** o su link (de Mercado Libre, Amazon o China).
- **Fotos buenas** (ver el curso de fotos).
- **El costo** y el precio al que lo queremos vender.
- **Medidas y peso del paquete ya armado** para enviar.
- **El código de barras (EAN/UPC)** si tiene. Está debajo de las barras, son 12 o 13 números.
- **El SKU** interno: es el código con el que lo identificamos en stock.

Si falta algo, mejor esperar: una publicación incompleta vende menos y después cuesta corregirla.` },
      { title: 'Paso a paso en el panel', body: `En **Publicar**:

1. **¿De dónde sale?** Pegá un link de Mercado Libre, Amazon o China y tocá **Traer datos**, o elegí **Desde cero**.
2. **Título:** máximo 60 caracteres. Podés usar **Título y descripción con IA**, pero siempre revisalo.
3. **Categoría:** buscala y elegí la más específica. Una categoría equivocada hace que no te encuentren.
4. **SKU y stock:** poné el stock real. Nunca más del que hay.
5. **Tipo de publicación y cuotas:** Clásica o Premium, y el plan de cuotas. El panel muestra cuánto cobra Mercado Libre en cada opción.
6. **Código universal y paquete:** el EAN, y alto, ancho, largo y peso del paquete armado.
7. **Fotos, descripción y ficha técnica.**
8. **Precio:** el panel te ayuda a calcularlo con costos y comisiones.
9. **Cuentas:** elegí en qué cuentas se publica.
10. Revisá el resumen y confirmá.` },
      { title: 'Errores comunes', body: `- **Medidas del paquete mal cargadas:** Mercado Libre cobra el envío según esas medidas. Si ponés de menos, después hay diferencias y problemas.
- **Stock inventado:** si se vende algo que no tenemos, hay que cancelar y eso baja la reputación.
- **Categoría genérica** ("Otros"): casi nadie la ve.
- **Ficha técnica vacía:** Mercado Libre usa esos datos para los filtros. Si están vacíos, la publicación no aparece cuando el comprador filtra.
- **Publicar el mismo producto dos veces en la misma cuenta:** Mercado Libre lo puede tomar como publicación duplicada.` },
    ],
    links: [CLIC, CV],
    quiz: [
      { q: '¿Cuántos caracteres puede tener el título?', o: ['30', '60', '120'], a: 1, w: 'El límite es 60, el panel te muestra el contador.' },
      { q: '¿Qué stock se carga?', o: ['Un poco más, por si llega mercadería', 'El stock real', '999 para que nunca se agote'], a: 1, w: 'Vender algo que no hay obliga a cancelar y baja la reputación.' },
      { q: '¿Para qué se usan las medidas y el peso del paquete?', o: ['Para calcular el envío', 'Solo para estadística', 'No se usan'], a: 0, w: 'Mercado Libre cobra el envío según el paquete armado.' },
      { q: '¿Por qué conviene completar la ficha técnica?', o: ['No sirve para nada', 'Porque ML la usa en los filtros de búsqueda', 'Porque sube el precio'], a: 1, w: 'Sin ficha la publicación no aparece al filtrar.' },
      { q: 'El título que armó la IA, ¿se publica directo?', o: ['Sí, la IA no se equivoca', 'No, siempre se revisa', 'Solo si es corto'], a: 1, w: 'La IA ayuda, pero lo revisa una persona.' },
    ],
  },
  {
    id: 'fotos', short: 'Fotos', icon: '📸', title: 'Fotos que venden', minutes: 12, level: 'Básico',
    summary: 'Cómo elegir, sacar y ordenar las fotos de una publicación.',
    lessons: [
      { title: 'La primera foto', body: `La primera foto es la que se ve en la búsqueda: es la que decide si el cliente entra o no.

- **Fondo blanco liso**, sin sombras fuertes.
- **El producto solo**, ocupando casi toda la foto.
- **Sin textos, logos, marcas de agua, precios ni bordes.** Mercado Libre puede bajar la exposición o pedir que la cambies.
- **Nítida y bien iluminada**, con los colores reales.
- **Cuadrada**, idealmente de **1200 x 1200 píxeles**. Mercado Libre activa el zoom en fotos de más de 800 píxeles de ancho.` },
      { title: 'Las demás fotos', body: `Usá las otras fotos para responder las dudas del comprador antes de que pregunte:

- **La etiqueta de atrás:** tabla nutricional, ingredientes y modo de uso. En suplementos es lo que más preguntan.
- **Cantidad:** cuántas cápsulas, gomitas o porciones trae.
- **Tamaño real:** el frasco en la mano o al lado de algo conocido.
- **Distintos ángulos** del producto.
- **El vencimiento o el lote**, si ayuda a dar confianza.
- **Combos:** todos los productos juntos.

Ordenalas de lo más importante a lo menos importante.` },
      { title: 'Cómo sacar una buena foto con el celular', body: `- **Luz natural** de una ventana, de costado. Nada de flash.
- **Fondo:** una cartulina blanca que haga curva detrás del producto, así no se ve la esquina.
- **Celular quieto**, mejor apoyado. Tocá la pantalla para enfocar el producto.
- **Limpiá el producto** antes: huellas y polvo se notan mucho.
- Sacá varias y elegí la mejor.

Requisitos técnicos de Mercado Libre: JPG o PNG, hasta 10 MB, y al menos 500 píxeles de lado.` },
      { title: 'Fotos de proveedores', body: `Muchas veces usamos fotos del proveedor o de la marca.

- Revisá que sean **del mismo producto y la misma presentación** (misma cantidad de cápsulas, mismo sabor).
- **Sacales textos y marcas de agua** de otras tiendas. Nunca publiques una foto con el logo de otro vendedor.
- Si la foto viene de China con textos en chino, no sirve como primera foto. Hay que sacar una propia o limpiarla.` },
    ],
    links: [CV, AY],
    quiz: [
      { q: '¿Cómo tiene que ser el fondo de la primera foto?', o: ['Del color de la marca', 'Blanco liso', 'Una foto de ambiente'], a: 1, w: 'Fondo blanco, producto solo.' },
      { q: '¿Se puede poner "Envío gratis" escrito sobre la primera foto?', o: ['Sí, llama la atención', 'No, sin textos ni logos', 'Solo en letra chica'], a: 1, w: 'Textos, logos y marcas de agua en la primera foto bajan la exposición.' },
      { q: '¿Desde qué ancho Mercado Libre activa el zoom?', o: ['300 píxeles', 'Más de 800 píxeles', 'No tiene zoom'], a: 1, w: 'Por eso se recomienda 1200 x 1200.' },
      { q: 'En un suplemento, ¿qué foto conviene sumar sí o sí?', o: ['La etiqueta con la tabla nutricional y el modo de uso', 'Una foto del depósito', 'El logo de Biogate'], a: 0, w: 'Es lo que más preguntan los compradores.' },
      { q: '¿Qué luz es mejor para sacar fotos con el celular?', o: ['Flash del celular', 'Luz natural de costado', 'Luz amarilla de techo'], a: 1, w: 'La luz natural de ventana da colores reales y sin brillos.' },
    ],
  },
  {
    id: 'titulos', short: 'Títulos y ficha', icon: '✍️', title: 'Título, descripción y ficha técnica', minutes: 12, level: 'Básico',
    summary: 'Cómo escribir para que te encuentren y te compren, sin romper las reglas.',
    lessons: [
      { title: 'El título', body: `El título es lo que el comprador busca. Fórmula simple:

**Producto + Marca + Característica clave + Cantidad o presentación**

Ejemplo: *Omega 3 Sports Research Triple Strength 180 Cápsulas*

- Usá las palabras que usa el comprador, no las internas.
- **No pongas** precio, "envío gratis", "oferta", "el mejor", signos raros ni todo en mayúsculas.
- No repitas palabras.
- Hasta 60 caracteres: aprovechalos, pero que se lea natural.` },
      { title: 'La descripción', body: `La descripción se lee de arriba hacia abajo y en el celular. Que sea fácil:

1. **Qué es** el producto, en una o dos líneas.
2. **Qué trae:** cantidad, presentación, sabor.
3. **Modo de uso**, tal cual dice la etiqueta.
4. **Ingredientes** principales.
5. **Datos de la venta:** que es original, cómo es el envío, que hacemos factura.

Mercado Libre **no permite** en la descripción teléfonos, mails, links a otras páginas ni redes sociales.` },
      { title: 'Cuidado con lo que se promete', body: `En suplementos hay que tener mucho cuidado con lo que se dice:

- **No digas que cura, trata o previene enfermedades.** Un suplemento no es un medicamento. Mercado Libre puede pausar la publicación y además no está permitido.
- Usá lo que dice la etiqueta o la marca: "aporta", "contribuye", "ayuda a complementar la alimentación".
- No inventes dosis. La dosis es la de la etiqueta.
- Si el cliente necesita algo para una enfermedad, se le recomienda consultar con su médico.` },
      { title: 'La ficha técnica', body: `La ficha técnica (atributos) son los datos que pide Mercado Libre: marca, modelo, sabor, cantidad de unidades, formato, etc.

- **Completala toda**, aunque diga "opcional". Mercado Libre usa esos datos para los **filtros**. Si el comprador filtra por marca o por cantidad y el dato está vacío, tu publicación desaparece.
- Los datos tienen que coincidir con el título y las fotos.
- En **Mis publicaciones** podés completar la ficha de una publicación ya hecha, incluso en todas las cuentas a la vez.` },
    ],
    links: [CV, AY],
    quiz: [
      { q: '¿Cuál es el mejor título?', o: ['OFERTA!! OMEGA 3 ENVÍO GRATIS', 'Omega 3 Sports Research Triple Strength 180 Cápsulas', 'Suplemento muy bueno importado'], a: 1, w: 'Producto + marca + característica + cantidad, sin promos ni mayúsculas.' },
      { q: '¿Se puede poner el WhatsApp del local en la descripción?', o: ['Sí', 'No, ML no permite datos de contacto', 'Solo en Premium'], a: 1, w: 'ML no permite teléfonos, mails ni links externos.' },
      { q: '¿Se puede escribir que un suplemento cura una enfermedad?', o: ['Sí, si funciona', 'No, nunca', 'Solo si lo dice un cliente'], a: 1, w: 'Un suplemento no es un medicamento; esas frases no están permitidas.' },
      { q: '¿Por qué completar los datos opcionales de la ficha?', o: ['Para los filtros de búsqueda', 'No hace falta', 'Para cobrar más'], a: 0, w: 'Si falta el dato, al filtrar la publicación no aparece.' },
    ],
  },
  {
    id: 'precios', short: 'Precios y cuotas', icon: '💲', title: 'Tipos de publicación, cuotas y precio', minutes: 12, level: 'Intermedio',
    summary: 'Clásica vs Premium, planes de cuotas, comisiones y cómo poner un precio que deje ganancia.',
    lessons: [
      { title: 'Clásica y Premium', body: `Mercado Libre tiene dos tipos de publicación principales:

- **Clásica:** cobra menos comisión. El comprador puede pagar en cuotas, pero con interés (o con planes de interés bajo según la categoría).
- **Premium:** cobra más comisión, pero el comprador paga en **cuotas sin interés**. Tiene más exposición y suele vender más.

En **Publicar**, el panel muestra los planes que da Mercado Libre para esa categoría (por ejemplo Premium 3, 6, 9 o 12 cuotas sin interés) y cuánto cobra cada uno: **cargo por venta + cargo por cuotas**. Cuantas más cuotas sin interés, más caro para nosotros.` },
      { title: 'Qué se descuenta de cada venta', body: `De cada venta en Mercado Libre se descuenta:

- **Cargo por venta:** un porcentaje del precio (depende de la categoría y del tipo de publicación).
- **Cargo por cuotas**, si el plan lo tiene.
- **Costo fijo:** en productos baratos, Mercado Libre suma un monto fijo por unidad.
- **Envío:** arriba de cierto precio el envío gratis es obligatorio y una parte la paga el vendedor.
- **Impuestos** y retenciones.

Por eso el precio no es "costo + un poco". Hay que hacer la cuenta completa.` },
      { title: 'Cómo poner el precio', body: `- Usá la **Calculadora** o el cálculo de precio de **Publicar**: ponés el costo y el margen que querés, y te da el precio con todos los cargos.
- Mirá cuánto cuesta en la **competencia** (sección Competencia o el botón Comparar). Si estamos muy arriba, no se vende; si estamos muy abajo, perdemos plata.
- **Nunca cambies precios en masa sin preguntar.** En Mis publicaciones hay botón de deshacer, pero un precio mal puesto puede vender a pérdida en minutos.` },
    ],
    links: [AY],
    quiz: [
      { q: '¿Qué tipo de publicación da cuotas sin interés?', o: ['Clásica', 'Premium', 'Ninguna'], a: 1, w: 'Premium tiene cuotas sin interés y cobra más comisión.' },
      { q: 'Más cuotas sin interés para el comprador significa…', o: ['Más costo para nosotros', 'Menos costo para nosotros', 'Lo mismo'], a: 0, w: 'El cargo por cuotas sube con la cantidad de cuotas.' },
      { q: '¿Qué hay que tener en cuenta además del cargo por venta?', o: ['Nada más', 'Costo fijo, envío, cuotas e impuestos', 'Solo el envío'], a: 1, w: 'El precio se calcula con todos los cargos.' },
      { q: '¿Qué hacés antes de cambiar precios de muchas publicaciones?', o: ['Lo hago rápido', 'Pregunto antes', 'Lo hago de noche'], a: 1, w: 'Un error de precio puede vender a pérdida.' },
    ],
  },
  {
    id: 'preguntas', short: 'Preguntas', icon: '💬', title: 'Responder preguntas que venden', minutes: 12, level: 'Básico',
    summary: 'Cómo responder rápido, claro y con la firma correcta.',
    lessons: [
      { title: 'Por qué importa responder rápido', body: `Muchos compradores preguntan a varios vendedores a la vez y le compran al primero que responde bien.

- **Respondé lo antes posible**, sobre todo en horario laboral.
- El panel avisa cuando una pregunta lleva mucho tiempo sin respuesta.
- Una pregunta sin responder es una venta que se va a otro.` },
      { title: 'Cómo es una buena respuesta', body: `1. **Saludo:** "Hola, ¿cómo estás?"
2. **La respuesta concreta**, primero. Si pregunta si hay stock, la primera palabra es "Sí" o "No".
3. **Un dato que ayude a comprar:** envío, factura, que es original.
4. **Firma** de la cuenta (el panel la pone sola según tu usuario y la cuenta).

Reglas:
- **Sin emojis**, con buena ortografía (el panel corrige la ortografía antes de mandar).
- **No pongas** teléfonos, mails, redes ni links a otras páginas. Mercado Libre bloquea esas respuestas.
- No inventes: si no sabés, consultá y respondé después.` },
      { title: 'Herramientas del panel', body: `- **Respuestas rápidas:** textos guardados para las preguntas que se repiten.
- **Sugerir con IA:** te arma una respuesta; siempre la revisás antes de mandar.
- **Link de publicación:** si el cliente pregunta por otro producto, buscalo con el botón de links y se pega el link de **nuestra** publicación en la misma cuenta.
- **Preguntas bloqueadas:** si Mercado Libre no deja responder (por ejemplo, el comprador está bloqueado o la publicación ya no está activa), la pregunta queda en gris y no cuenta como pendiente.` },
    ],
    links: [AY],
    quiz: [
      { q: 'Te preguntan "¿tenés stock?" y hay. ¿Cómo empezás la respuesta?', o: ['"Hola, ¿cómo estás? Sí, tenemos stock…"', '"Fijate en la publicación"', 'Con el link de la web'], a: 0, w: 'Saludo y la respuesta concreta primero.' },
      { q: '¿Se puede pasar el WhatsApp en una respuesta?', o: ['Sí', 'No, ML lo bloquea', 'Solo si el cliente lo pide'], a: 1, w: 'ML no permite datos de contacto en las preguntas.' },
      { q: 'El cliente pregunta por otro producto que vendemos. ¿Qué hacés?', o: ['Le paso el link de nuestra publicación en la misma cuenta', 'Le digo que lo busque', 'Le paso el link de la web'], a: 0, w: 'El botón de links busca nuestras publicaciones de esa cuenta.' },
      { q: '¿Qué pasa con la respuesta que sugiere la IA?', o: ['Se manda sola', 'La reviso antes de mandar', 'No se usa'], a: 1, w: 'Siempre la revisa una persona.' },
    ],
  },
  {
    id: 'reputacion', short: 'Reputación', icon: '🛡️', title: 'Reputación, reclamos y cancelaciones', minutes: 12, level: 'Intermedio',
    summary: 'Qué baja la reputación, cómo cuidarla y qué hacer con un reclamo.',
    lessons: [
      { title: 'Qué es la reputación', body: `La reputación es el termómetro de colores de cada cuenta. Cuanto más verde, más nos muestra Mercado Libre y más confianza da.

Se mide sobre las ventas recientes (en general, los últimos 60 días) y la bajan tres cosas:
- **Reclamos** de compradores.
- **Cancelaciones** hechas por nosotros (por ejemplo por falta de stock).
- **Demoras** en despachar.

En el panel, **Salud de cuentas** muestra cómo está cada cuenta y avisa antes de que se ponga en riesgo.` },
      { title: 'Cómo cuidarla todos los días', body: `- **Stock real siempre.** La causa número uno de cancelaciones es vender algo que no hay.
- **Despachar a tiempo:** las etiquetas y los Flex del día salen el día que corresponde.
- **Revisar el producto antes de empacar:** que sea el correcto, sabor y cantidad correctos, sin vencer, bien cerrado.
- **Empaque firme:** frascos protegidos para que no lleguen rotos.
- **Responder mensajes** de compradores rápido: muchos reclamos se evitan con una respuesta a tiempo.` },
      { title: 'Si llega un reclamo', body: `1. **Leelo con calma** en la sección Reclamos y mirá qué pide el comprador.
2. **Respondé rápido y con amabilidad**, sin discutir. Sin emojis.
3. **Ofrecé una solución:** cambio, devolución o reenvío, según el caso.
4. Si no sabés qué ofrecer, **consultá con el dueño antes de responder.**
5. Nunca le pidas al comprador que cancele o cierre el reclamo a cambio de algo por fuera de Mercado Libre.

Un reclamo resuelto bien y rápido afecta mucho menos que uno que llega a mediación.` },
    ],
    links: [AY],
    quiz: [
      { q: '¿Qué baja la reputación?', o: ['Reclamos, cancelaciones y demoras', 'Tener muchas publicaciones', 'Responder rápido'], a: 0, w: 'Son las tres métricas principales.' },
      { q: '¿Cuál es la causa más común de cancelaciones?', o: ['Stock mal cargado', 'Precio alto', 'Fotos malas'], a: 0, w: 'Vender lo que no hay obliga a cancelar.' },
      { q: 'Llega un reclamo y no sabés qué ofrecer. ¿Qué hacés?', o: ['Le digo que no se puede', 'Consulto con el dueño antes de responder', 'Lo dejo para después'], a: 1, w: 'Mejor responder bien que improvisar.' },
      { q: '¿Se le puede ofrecer al comprador algo por fuera de ML para que cierre el reclamo?', o: ['Sí', 'No', 'Solo por WhatsApp'], a: 1, w: 'Eso va contra las reglas de Mercado Libre.' },
    ],
  },
  {
    id: 'envios', short: 'Envíos', icon: '🚚', title: 'Envíos: Flex, Full y etiquetas', minutes: 12, level: 'Básico',
    summary: 'Cómo sale cada pedido y qué hacer para que llegue a tiempo.',
    lessons: [
      { title: 'Los tipos de envío', body: `- **Mercado Envíos (colecta o correo):** imprimimos la etiqueta, armamos el paquete y lo despachamos antes de la hora que indica Mercado Libre.
- **Flex:** lo entregamos nosotros (o un cadete) el mismo día o al día siguiente, en las zonas que tenemos habilitadas. Cada paquete se **escanea** en el panel al salir.
- **Full:** el stock está guardado en los depósitos de Mercado Libre. Ellos preparan y envían. Nosotros solo mandamos la mercadería al depósito cuando hace falta reponer.` },
      { title: 'El día a día', body: `1. Entrá a **Impresión de etiquetas** y mirá qué hay que despachar hoy.
2. Imprimí las etiquetas.
3. **Prepará cada pedido revisando** producto, sabor, cantidad y vencimiento.
4. Empacá firme y pegá la etiqueta bien visible, sin tapar el código de barras.
5. Los **Flex** se escanean en **Escanear** antes de salir: así queda registrado y se calcula lo que hay que pagar por zona.
6. Despachá antes de la hora de corte.

Si un paquete no va a llegar a salir a tiempo, **avisá enseguida**: es mejor resolverlo antes que tener una demora.` },
      { title: 'Full: cuándo reponer', body: `- En **Full** el panel muestra cuánto stock queda en Mercado Libre y cuánto se vende por día.
- Si un producto se está por quedar sin stock en Full, hay que preparar un envío al depósito. Mercado Libre pide turno y las cajas con sus etiquetas.
- En Full, el stock lo maneja Mercado Libre: no se cambia desde Mis publicaciones.` },
    ],
    links: [AY],
    quiz: [
      { q: '¿Qué es Full?', o: ['Nuestro depósito', 'Stock guardado y enviado por Mercado Libre', 'Un tipo de cuotas'], a: 1, w: 'ML guarda, prepara y envía.' },
      { q: '¿Qué hay que hacer con cada paquete Flex antes de que salga?', o: ['Escanearlo en el panel', 'Sacarle foto', 'Nada'], a: 0, w: 'Así queda registrado y se calcula la zona.' },
      { q: 'Un paquete no va a salir a tiempo. ¿Qué hacés?', o: ['Nada, que salga mañana', 'Aviso enseguida', 'Cancelo la venta'], a: 1, w: 'Avisar a tiempo permite resolverlo sin demora.' },
      { q: '¿Qué se revisa antes de cerrar la caja?', o: ['Producto, sabor, cantidad y vencimiento', 'Solo que la caja cierre', 'El precio'], a: 0, w: 'Así se evitan reclamos.' },
    ],
  },
  {
    id: 'mejorar', short: 'Mejorar con números', icon: '📈', title: 'Mejorar publicaciones con números', minutes: 12, level: 'Intermedio',
    summary: 'Usar Embudo, Competencia y Comparar para saber qué cambiar.',
    lessons: [
      { title: 'Visitas y conversión', body: `Dos números explican casi todo:

- **Visitas:** cuánta gente entra a la publicación.
- **Conversión:** de cada 100 que entran, cuántos compran.

Qué significa:
- **Pocas visitas:** el problema es que no nos encuentran. Revisar título, categoría, ficha técnica, primera foto y tipo de publicación.
- **Muchas visitas y pocas ventas:** nos encuentran pero no compran. Revisar precio, cuotas, envío, fotos, descripción y opiniones.

La sección **Embudo de ventas** marca esto solo para cada publicación.` },
      { title: 'Mirar a la competencia', body: `- **Competencia:** seguimos productos y vemos los precios y ventas de otros vendedores día a día.
- **Comparar con el que más vende:** pone nuestra publicación al lado de la que gana y arma una lista de **qué cambiar**, ordenada por importancia (precio, cuotas, Full/Flex, fotos, ficha, título).

No se trata de copiar: se trata de ver qué tiene el que vende más y nosotros no.` },
      { title: 'Acciones que suelen funcionar', body: `- Completar la ficha técnica.
- Mejorar la primera foto y sumar la foto de la etiqueta.
- Pasar a Premium si el producto se vende mucho en cuotas (consultar antes: cobra más).
- Activar Flex donde se pueda: entrega más rápida.
- Sumar el producto a las campañas y descuentos de Mercado Libre cuando dejan margen.

Cambiá una cosa por vez y mirá el resultado en una o dos semanas.` },
    ],
    links: [CLIC, CV],
    quiz: [
      { q: 'Una publicación tiene muchas visitas y casi no vende. ¿Qué revisás primero?', o: ['El título', 'Precio, cuotas, envío y fotos', 'La categoría'], a: 1, w: 'Si entran y no compran, el problema está en la oferta.' },
      { q: 'Una publicación casi no tiene visitas. ¿Qué revisás?', o: ['Título, categoría, ficha y primera foto', 'Solo el precio', 'Nada, es normal'], a: 0, w: 'Si no nos encuentran, el problema está en cómo aparece.' },
      { q: '¿Qué hace "Comparar con el que más vende"?', o: ['Copia la publicación del otro', 'Arma una lista de qué cambiar', 'Baja el precio solo'], a: 1, w: 'Muestra las diferencias ordenadas por importancia.' },
      { q: '¿Cuántos cambios conviene hacer por vez?', o: ['Todos juntos', 'Uno por vez y medir', 'Ninguno'], a: 1, w: 'Así se sabe qué funcionó.' },
    ],
  },
  {
    id: 'publicidad', short: 'Publicidad', icon: '📣', title: 'Publicidad en Mercado Libre (Product Ads)', minutes: 10, level: 'Intermedio',
    summary: 'Cómo funcionan los anuncios dentro de Mercado Libre y cómo saber si convienen.',
    lessons: [
      { title: 'Cómo funciona', body: `Con **Product Ads** nuestras publicaciones aparecen en lugares destacados de la búsqueda, marcadas como "Promocionado".

- Se paga **por clic**, no por mostrar el anuncio.
- Se arman **campañas** con un presupuesto por día.
- Mercado Libre decide dónde mostrar el anuncio según la relevancia de la publicación y lo que estamos dispuestos a gastar.

La publicidad no arregla una mala publicación: si la publicación no convierte, solo pagamos clics que no compran.` },
      { title: 'El número clave: ACOS', body: `**ACOS** = lo que gastamos en publicidad ÷ lo que vendimos gracias a la publicidad.

Ejemplo: gastamos $10.000 y vendimos $100.000 por los anuncios → ACOS 10%.

- Si el ACOS es más alto que nuestro margen, estamos perdiendo plata con esa publicidad.
- Conviene publicitar productos con **buen margen, buen stock y buena conversión**.
- Revisar las campañas una vez por semana y pausar lo que no rinde.

Las campañas las arma o aprueba el dueño.` },
    ],
    links: [CV],
    quiz: [
      { q: '¿Cómo se paga Product Ads?', o: ['Por cada vez que se muestra', 'Por clic', 'Un abono fijo'], a: 1, w: 'Se paga cuando alguien hace clic.' },
      { q: 'Gastamos $5.000 y vendimos $50.000 por publicidad. ¿Cuál es el ACOS?', o: ['5%', '10%', '50%'], a: 1, w: '5.000 ÷ 50.000 = 10%.' },
      { q: '¿Qué productos conviene publicitar?', o: ['Los que no se venden nunca', 'Los de buen margen, stock y conversión', 'Los que están por quedarse sin stock'], a: 1, w: 'Publicitar una mala publicación es pagar clics que no compran.' },
    ],
  },
  {
    id: 'importados', short: 'Amazon y China', icon: '🌏', title: 'Publicar productos de Amazon y China', minutes: 10, level: 'Intermedio',
    summary: 'Traer datos desde un link y calcular el costo real de un importado.',
    lessons: [
      { title: 'Traer datos desde un link', body: `En **Publicar** podés pegar un link de **Amazon**, **AliExpress**, **Alibaba** o **1688** y tocar **Traer datos**. El panel intenta leer título, fotos, precio y características, y la IA los pasa a español.

Estas páginas a veces bloquean la lectura (1688 casi siempre pide iniciar sesión). Si pasa, el panel avisa y se completa a mano: título, precio, peso y fotos.

Siempre revisá que el título y las características queden bien en español y que las fotos no tengan textos de otra tienda.` },
      { title: 'El costo de un producto de China', body: `El panel calcula el costo de **una unidad puesta en Argentina**:

- **Precio de una unidad** (1688 está en yuanes: 6,6 yuanes = 1 dólar; AliExpress y Alibaba en dólares).
- **Envío dentro de China**, si lo cobran.
- **Kilos × dólares por kilo** del envío China → Argentina.
- Todo pasado a pesos con el mismo dólar que usa TUYO.

Para que el costo dé bien, el **peso** tiene que ser el del producto con su caja. Si no lo sabés, pedilo al proveedor.

Ojo con los **precios por cantidad**: muchas veces el precio barato es comprando 100 o más unidades.` },
    ],
    links: [],
    quiz: [
      { q: '1688 no dejó leer el producto. ¿Qué hacés?', o: ['No se puede publicar', 'Completo a mano título, precio, peso y fotos', 'Uso otro proveedor siempre'], a: 1, w: 'El panel avisa y se completa a mano.' },
      { q: 'En 1688, ¿en qué moneda están los precios?', o: ['Dólares', 'Yuanes', 'Pesos'], a: 1, w: '6,6 yuanes son 1 dólar en el cálculo del panel.' },
      { q: '¿Qué dato es clave para calcular bien el envío desde China?', o: ['El color', 'El peso con caja', 'El nombre del proveedor'], a: 1, w: 'El envío se cobra por kilo.' },
    ],
  },
  {
    id: 'postventa', short: 'Postventa', icon: '🤝', title: 'Atención y postventa', minutes: 10, level: 'Básico',
    summary: 'Ventas por WhatsApp y redes, presupuestos, recompras y buen trato.',
    lessons: [
      { title: 'Ventas por WhatsApp, redes y local', body: `- Cada venta por fuera de Mercado Libre se carga en **Presupuestos**: así queda el recibo, se descuenta el stock y cuenta en los números del mes.
- Indicá de dónde vino (redes, WhatsApp, local) y cómo se entrega.
- Si se manda por correo, cargá el número de seguimiento en el recibo.
- Los precios para redes y local salen de la **Lista de precios**, no se inventan.` },
      { title: 'Recompras', body: `Los suplementos se terminan. La sección **Recompras** avisa cuándo a un cliente se le está por terminar lo que compró.

- El mensaje es corto, amable y **sin presión**: "Hola, ¿cómo estás? Te escribo porque hace unas semanas te llevaste… ¿Querés que te lo separemos?"
- Sin emojis y con la firma.
- Si el cliente dice que no quiere más mensajes, no se le escribe más.` },
      { title: 'Buen trato siempre', body: `- Tratá de **usted o vos** según cómo escriba el cliente, pero siempre con respeto.
- Si el cliente está enojado: escuchá, pedí disculpas por la molestia y ofrecé una solución concreta. No discutas.
- Nunca prometas fechas que no podés cumplir.
- Si algo se te escapa de las manos, pasáselo al dueño.` },
    ],
    links: [],
    quiz: [
      { q: '¿Dónde se carga una venta por WhatsApp?', o: ['En Presupuestos', 'En ningún lado', 'En un papel'], a: 0, w: 'Así queda el recibo, baja el stock y cuenta en el mes.' },
      { q: 'Un cliente dice que no quiere más avisos de recompra. ¿Qué hacés?', o: ['Le sigo escribiendo cada tanto', 'No le escribo más', 'Le mando un descuento'], a: 1, w: 'Se respeta siempre.' },
      { q: 'Un cliente escribe enojado. ¿Qué hacés?', o: ['Le explico que tiene la culpa', 'Escucho, pido disculpas y ofrezco una solución', 'No respondo'], a: 1, w: 'Nunca se discute con el cliente.' },
    ],
  },
];

const byId = (id) => COURSES.find(c => c.id === id) || null;
const key = (user) => (user && !user.owner ? String(user.id) : 'owner');
const mine = (user) => { const p = L().progress; const k = key(user); return p[k] || (p[k] = {}); };
const rec = (user, cid) => { const m = mine(user); return m[cid] || (m[cid] = { lessons: [] }); };

function status(c, r) {
  if (!r) return 'nuevo';
  if (r.passed_at) return 'aprobado';
  if ((r.lessons || []).length || r.tries) return 'en curso';
  return 'nuevo';
}

// Lo que ve cada persona: cursos (sin las respuestas correctas) y su avance
function list(user) {
  const m = mine(user), req = new Set(L().required[key(user)] || []);
  return {
    pass: PASS, official: OFFICIAL,
    courses: COURSES.map(c => {
      const r = m[c.id] || null;
      return {
        id: c.id, icon: c.icon, title: c.title, minutes: c.minutes, level: c.level, summary: c.summary, links: c.links,
        lessons: c.lessons.map(l => ({ title: l.title, body: l.body })),
        quiz: c.quiz.map(q => ({ q: q.q, o: q.o })),
        required: req.has(c.id),
        progress: { lessons: (r && r.lessons) || [], score: r ? r.score ?? null : null, best: r ? r.best ?? null : null, tries: r ? r.tries || 0 : 0, passed_at: r ? r.passed_at || null : null, status: status(c, r) },
      };
    }),
  };
}

function lesson(user, cid, idx) {
  const c = byId(cid); if (!c) throw new Error('No encontré ese curso.');
  const i = Number(idx); if (!(i >= 0 && i < c.lessons.length)) throw new Error('No encontré esa lección.');
  const r = rec(user, cid);
  if (!r.lessons.includes(i)) r.lessons.push(i);
  r.started_at = r.started_at || new Date().toISOString();
  store.saveLearn();
  return { lessons: r.lessons };
}

function quiz(user, cid, answers) {
  const c = byId(cid); if (!c) throw new Error('No encontré ese curso.');
  const a = Array.isArray(answers) ? answers : [];
  if (a.length !== c.quiz.length || a.some(x => x === null || x === undefined || x === '')) throw new Error('Respondé todas las preguntas.');
  const detail = c.quiz.map((q, i) => ({ ok: Number(a[i]) === q.a, right: q.a, why: q.w }));
  const ok = detail.filter(d => d.ok).length;
  const score = Math.round(ok / c.quiz.length * 100);
  const r = rec(user, cid);
  r.tries = (r.tries || 0) + 1; r.score = score; r.best = Math.max(r.best || 0, score); r.last_at = new Date().toISOString();
  const passed = score >= PASS;
  if (passed && !r.passed_at) r.passed_at = r.last_at;
  store.saveLearn();
  return { score, ok, total: c.quiz.length, passed, pass: PASS, detail, title: c.title };
}

// Para el dueño: avance de cada persona en cada curso
function team() {
  const users = require('./users').all().filter(u => u.active);
  const d = L();
  const people = [{ id: 'owner', name: 'Vos (dueño)' }, ...users.map(u => ({ id: u.id, name: u.name }))];
  return {
    pass: PASS,
    courses: COURSES.map(c => ({ id: c.id, icon: c.icon, title: c.title, short: c.short, lessons: c.lessons.length })),
    people: people.map(p => {
      const m = d.progress[p.id] || {}, req = d.required[p.id] || [];
      const rows = {};
      for (const c of COURSES) {
        const r = m[c.id];
        rows[c.id] = { status: status(c, r), lessons: r ? (r.lessons || []).length : 0, best: r ? r.best ?? null : null, tries: r ? r.tries || 0 : 0, passed_at: r ? r.passed_at || null : null, required: req.includes(c.id) };
      }
      const passed = COURSES.filter(c => rows[c.id].status === 'aprobado').length;
      const reqPending = req.filter(id => rows[id] && rows[id].status !== 'aprobado').length;
      return { id: p.id, name: p.name, rows, passed, total: COURSES.length, required_pending: reqPending };
    }),
  };
}

function setRequired(uid, cid, on) {
  if (!byId(cid)) throw new Error('No encontré ese curso.');
  const id = String(uid || '');
  if (id !== 'owner' && !require('./users').get(id)) throw new Error('No encontré ese usuario.');
  const d = L(); const cur = new Set(d.required[id] || []);
  if (on) cur.add(cid); else cur.delete(cid);
  d.required[id] = [...cur];
  store.saveLearn();
  return d.required[id];
}

// Cursos obligatorios que la persona todavía no aprobó (para el aviso del menú)
function pending(user) {
  const req = L().required[key(user)] || [], m = mine(user);
  return req.filter(id => byId(id) && !(m[id] && m[id].passed_at)).length;
}

module.exports = { COURSES, OFFICIAL, PASS, list, lesson, quiz, team, setRequired, pending, byId };
