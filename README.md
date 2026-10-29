# Flex Scanner (versión gratis: tu PC + ngrok)

Escaneás el QR de la etiqueta de Mercado Envíos Flex con el celu y los datos del cliente (nombre, apellido, teléfono, dirección y productos) aparecen en un panel web en la PC. Todo queda guardado en tu computadora y se puede bajar a Excel.

**Costo: $0.** El programa corre en tu PC y ngrok (gratis) le da una dirección https fija para que el celu lo abra desde cualquier lado, con WiFi o datos.
**Única condición:** la PC tiene que estar prendida y con `iniciar.bat` abierto mientras escaneás.

## ☁️ Publicarlo en Vercel (gratis, sin la PC prendida)

El panel también anda en **Vercel** (plan Hobby, gratis) con tu cuenta de GitHub. Ahí los datos se guardan en una base **Upstash Redis** gratis y los archivos (manuales, recibos, logo) en **Vercel Blob**; las dos se crean desde Vercel en dos clics.

**Diferencias con la versión de la PC (por los límites del plan gratis):**
- Las ventas, pedidos web, costos y manuales se actualizan **cuando alguien usa el panel** (como mucho cada 15 minutos) y **una vez por día** de forma automática (7 de la mañana), aunque nadie lo abra.
- Las tareas largas (traer el historial de 12 meses, muchos manuales) se hacen **en tandas de unos 4 minutos**: con el panel abierto siguen solas hasta terminar.
- El plan Hobby de Vercel es, según sus reglas, para uso personal / no comercial. Si lo usan muchas personas o el negocio crece, el plan Pro sale US$ 20 por mes.

### Paso 1 · Subir el proyecto a GitHub
1. Entrá a https://github.com → **New repository**. Nombre: `biogate-panel`. Marcá **Private**. **Create repository**.
2. En la página nueva tocá **uploading an existing file**.
3. Descomprimí `biogate-panel-vercel.zip`, abrí la carpeta `biogate-panel` y **arrastrá todo lo que hay adentro** (carpetas `lib`, `public`, `views` y los archivos sueltos). **No subas** el archivo `.env` ni la carpeta `data` (tienen tus claves y datos).
4. Abajo, **Commit changes**.

### Paso 2 · Crear el proyecto en Vercel
1. https://vercel.com → **Add New… → Project** → elegí el repositorio `biogate-panel` → **Import**.
2. En **Environment Variables** cargá:
   - `ADMIN_PASSWORD` → la contraseña para entrar al panel.
   - `ML_CLIENT_ID` y `ML_CLIENT_SECRET` → los de tu aplicación de Mercado Libre (los mismos del `.env` de la PC).
   - `CRON_SECRET` → cualquier texto largo inventado (protege la actualización diaria).
3. **Deploy**. Al terminar, anotá la dirección (por ejemplo `https://biogate-panel.vercel.app`). Si la abrís ahora, va a decir "Falta configurar": es normal, sigue el paso 3.

### Paso 3 · Crear la base y el almacenamiento (gratis)
En el proyecto de Vercel → pestaña **Storage**:
1. **Create Database → Upstash → Redis** (plan **Free**, región **São Paulo** si aparece) → **Connect** al proyecto.
2. **Create → Blob** → acceso **Public** → **Connect** al proyecto.
3. Pestaña **Deployments** → en el último, menú **⋯ → Redeploy**.

### Paso 4 · Mercado Libre
En https://developers.mercadolibre.com.ar → tu aplicación → **URI de redirect**, agregá: `https://TU-PROYECTO.vercel.app/auth/callback`. Guardá.

### Paso 5 · Pasar tus datos de la PC (cuentas, ventas, recibos, manuales…)
1. **Cerrá el panel de la PC** (la ventana de `iniciar.bat`).
2. En Vercel → **Storage** → tu base Upstash → **.env.local** → copiá `KV_REST_API_URL` y `KV_REST_API_TOKEN`. En tu Blob store → **.env.local** → copiá `BLOB_READ_WRITE_TOKEN`.
3. Pegá esas 3 líneas al final del archivo `.env` de la carpeta del panel en la PC.
4. Reemplazá en la PC los archivos del panel con los de este zip y abrí una ventana de comandos en la carpeta: `npm install` y después `node migrar.js`.
5. Al terminar dice "Listo". Abrí tu dirección de Vercel y entrá con tu contraseña: está todo.

**Importante:** desde ese momento usá **solo** el panel de Vercel. Si volvés a prender el de la PC, los dos renuevan el permiso de Mercado Libre por separado y las cuentas se pueden desconectar.

Si preferís empezar de cero (sin pasar datos), salteá el paso 5 y conectá las cuentas desde el panel de Vercel con **Conectar cuenta**.

---

## Qué datos se obtienen

| Dato | ¿Viene? |
|---|---|
| Nombre y apellido (facturación) | Sí |
| Quién recibe, dirección, referencias | Sí |
| DNI | Si el comprador cargó datos de facturación |
| Teléfono | Depende del envío: Mercado Libre a veces lo oculta |
| Email real | No: Mercado Libre no lo comparte |
| Productos | Sí |

---

## Instalación (una sola vez, unos 20 minutos)

### 1. Descomprimir
Descomprimí `flex-scanner.zip` en una carpeta fija, por ejemplo `Documentos\flex-scanner`.

### 2. Instalar Node.js
Bajalo de https://nodejs.org (botón **LTS**) e instalalo con todas las opciones por defecto.

### 3. Crear la cuenta de ngrok (gratis)
1. Registrate en https://ngrok.com.
2. En el panel de ngrok:
   - **Getting Started → Your Authtoken:** copiá el token.
   - **Domains** (o *Universal Gateway → Domains*): vas a ver tu **dominio gratis**, algo como `pepito-algo.ngrok-free.app`. Si no aparece, tocá **Create Domain**. Anotalo.
3. **Download → Windows:** bajá el zip, sacá `ngrok.exe` y copialo **adentro de la carpeta flex-scanner**.

### 4. Crear la aplicación en Mercado Libre
1. Entrá a https://developers.mercadolibre.com.ar con tu cuenta de vendedor.
2. **Mis aplicaciones → Crear aplicación.** Completá nombre y descripción (por ejemplo "Flex Scanner", "Uso interno").
3. **URI de redirect:** `https://TU-DOMINIO-NGROK/auth/callback` (ejemplo: `https://pepito-algo.ngrok-free.app/auth/callback`).
4. **PKCE:** desactivado.
5. **Permisos:** lectura en **Ventas/Órdenes** y **Envíos**, más **offline access**.
6. Guardá y copiá el **App ID** y la **Clave secreta**.

### 5. Configurar
Doble clic en **`configurar.bat`** y completá lo que te pide: App ID, clave secreta, dominio de ngrok, una contraseña y el authtoken de ngrok. Usá solo letras y números en la contraseña.

---

## Uso diario

### Menú lateral
Ventas · Resultado del mes · Stock · Full · Envíos Flex · Ranking · Lista de precios · Presupuestos · Gastos del local · Estados de WhatsApp · Sugerencias · Ventas web. El panel abre en **Ventas**.
Las ventas de Mercado Libre de hoy y ayer se actualizan solas cada 15 minutos (y los pedidos de la web también).

### 📊 Resultado del mes
Arriba, **Traer historial de 12 meses** baja de una vez las ventas de todas las cuentas (hacelo la primera vez; después se mantiene solo). El **Detalle del mes** muestra el **neto neto**: ventas brutas de Mercado Libre − canceladas y devueltas − comisiones − envíos − impuestos − costo de mercadería = ganancia ML; + ganancia de la web; − gastos del local = **NETO NETO**. Se compara con el mes anterior y con el mismo mes del año pasado, y abajo está el histórico de 12 meses (gráfico y tabla; tocá un mes para verlo). Si a un mes le faltan ventas guardadas, aparece el botón para traerlas. Avisa si hay ventas sin costo cargado (su mercadería no se resta). Abajo, **Unidades vendidas mes a mes**: tildá las cuentas (y la web) que querés sumar; muestra gráfico y tabla por cuenta con la variación contra el mes anterior.

### 📘 Manuales
Lee la pestaña **MANUALES** de tu Google Sheets de manuales: columna A el SKU (las filas sin documentos y sin números, como MÁSCARAS o VARITAS, son categorías) y en las columnas siguientes el título de cada documento con su link. El panel baja cada archivo (PDF o imagen) y guarda una copia en tu PC, así siguen andando aunque un link cambie. Cada producto muestra su SKU, el nombre de la lista de precios y sus documentos con **Ver**, **Descargar**, **WhatsApp** (en el celu manda el archivo; en la PC, un link para el cliente que no necesita contraseña) y 🔗 copiar link. Buscador por SKU o nombre y filtro por categoría. Tocá **Actualizar manuales** cuando agregues uno a la planilla (también se actualiza al abrir el panel). Si un documento no baja, el panel dice por qué (archivo privado, link a carpeta, etc.). La planilla y los archivos tienen que estar compartidos como "Cualquier persona con el enlace: Lector".

**Subir manuales a mano:** en Manuales, **⬆ Subir manual** → elegís uno o varios PDF o imágenes, el SKU, el título y (opcional) la categoría. Quedan guardados en tu PC y aparecen junto a los de la planilla (si el SKU ya existe, se suman a ese producto) con la marca "subido"; esos se pueden editar (✎) o borrar (🗑).

### 🛵 Envíos por mensajería de recibos y ventas web
El PDF que le llega al cliente ahora dice **RECIBO** (número de recibo, archivo "Recibo - Nombre.pdf"); el resto del diseño no cambia.
En **Presupuestos**, cada recibo tiene la columna **Envío** con el botón **🛵 + Envío**; en **Ventas web**, cada pedido tiene el mismo botón. Cargás dirección, localidad, provincia y fecha del envío: el panel detecta la zona (CABA, GBA 1, 2 o 3) con el mismo esquema que Mercado Libre Flex y muestra el costo; si no la reconoce, la elegís a mano. Esos envíos aparecen en **Envíos Flex** (con la marca "Recibo" o "Pedido web"), suman al total a pagar a la mensajería y salen en el Excel. En Envíos Flex se les puede cambiar la zona igual que a los demás; la ✕ quita el envío sin borrar el recibo ni el pedido.

**Origen y entrega de cada recibo:** en Presupuestos cada recibo tiene **Origen** (Pacientes de Lara, WhatsApp, Local, Mail, Instagram) y **Entrega** (Retiro en el local, Entrega Lara o 🛵 Envío). Se eligen en el editor o directo en la lista. Al elegir **Envío** se abre el formulario de dirección y zona, y ese envío suma en Envíos Flex; si después lo cambiás a Retiro o Entrega Lara, deja de sumar. Arriba hay filtros por origen (con cantidad y total de cada uno) y por tipo de entrega. Esto no aparece en el PDF que le llega al cliente.

### 🏷️ Etiquetas de envío (10 × 15, horizontal)
Para los recibos/presupuestos y pedidos web que tienen **Envío** (no para los Flex de Mercado Libre, que ya traen su etiqueta). Botón **🏷️ Etiqueta** en Presupuestos, en Ventas web y en Envíos Flex. Se abre una vista previa con destinatario, teléfono, dirección, localidad y CP, aclaraciones y el teléfono del local; lo que corrijas queda guardado en el envío. **Descargar etiqueta (PDF)** baja un PDF de 15 × 10 cm en blanco y negro, con el logo de Biogate. En Envíos Flex, **🏷️ Etiquetas del período** junta en un PDF todas las de ese día, semana o mes (una por página).

### 🧮 Calculadora
Para productos de Amazon: cargás el precio en dólares y el peso (kg, onzas o libras). Envío = peso en kg × costo por kilo (US$ 35); costo total = (precio + envío) × tipo de cambio. El precio de venta sale de: precio − 23% de IVA + IIBB − costo total = 40% del precio (ganancia neta). Costo por kilo, tipo de cambio, % de impuestos, % de ganancia y redondeo se pueden cambiar y quedan guardados. Con "Vender en Mercado Libre" también descuenta la comisión y el envío de ML y te dice a cuánto publicarlo. "Copiar resumen" copia el resultado.

### 🕐 Horarios de compra
Mapa de calor de día y hora (hora de Argentina) con las ventas, unidades o $ del período elegido, filtrable por cuentas, canal (Full, Flex, web…) y producto. Dice cuándo compran más, el mejor horario y día, el % por momento del día, ventas por hora, por día de la semana y por día del mes, cómo evoluciona mes a mes, qué franjas subieron o bajaron contra el período anterior, y sugerencias (a qué hora subir estados, qué días lanzar ofertas, en qué horario responder).

### 📦 Stock
La primera vez tocá **Cargar stock desde la lista de precios**: toma la columna STOCK de la planilla. Desde ese momento baja solo con cada venta de Mercado Libre (menos Full, que sale del depósito de ML) y de la web; si una venta se cancela o se devuelve, las unidades vuelven. Botones: **Entró mercadería**, **Venta en local / WhatsApp** y **Ajustar (conteo)**. Cada producto tiene mínimo (para el aviso de stock bajo) e **Historial** de movimientos. Con **Ordenar** elegís menos unidades primero (por defecto), más unidades, más vendidos o por SKU.

### 💡 Sugerencias
Lista ordenada por urgencia con cosas para cambiar: publicaciones que pierden plata o con margen bajo (con precio sugerido), productos que se agotan en Full o en el local, unidades no aptas o stock parado en Full, pausadas con stock, ventas sin SKU o sin costo, productos con muchas cancelaciones, candidatos a Full y, con **Analizar calidad de publicaciones**, lo que sugiere Mercado Libre para tus más vendidas (si lo informa).

### 🌐 Ventas web
Con la clave de WooCommerce cargada (Estados de WhatsApp → Configurar web → Probar clave), trae los pedidos de biogate.com.ar (la primera vez, los últimos 12 meses; después cada 15 minutos). Cada pedido tiene un estado **en el panel**: ⏳ Pendiente (así entran los nuevos), ✅ Completado o ❌ Cancelado. **Solo suman los que marcás como Completado** (en Ventas web, Resultado del mes, Stock y Horarios). Se pueden marcar varios a la vez con los tildes, y el filtro "Por revisar" muestra los que faltan marcar. El cambio queda solo en el panel: tu web no se toca. Al lado se ve el estado que tiene en WooCommerce como referencia. Los productos sin costo tienen el botón **cargar** para ponerle el costo a mano (por SKU, o por nombre si no tiene SKU). Muestra cliente, productos, pago, impuestos, comisión del medio de pago (poné tu % en "Comisión medio de pago"), costo y neto. Estas ventas descuentan stock y se suman al Resultado del mes.


1. Doble clic en **`iniciar.bat`**. Se abren dos ventanas negras (dejalas abiertas) y el panel en el navegador.
2. La primera vez, en el panel: **Conectar mi cuenta de Mercado Libre** y autorizá.
3. En el celu abrí `https://TU-DOMINIO-NGROK/escanear`, entrá con tu contraseña y permití la cámara.
   Consejo: en el menú del navegador elegí **Agregar a pantalla de inicio** y te queda como una app.
4. Escaneá etiquetas: suena un pitido, aparece el cliente en el celu y la tabla de la PC se actualiza sola.
5. **Descargar Excel** baja todo en un archivo que abre directo en Excel.
6. Para apagar, cerrá las dos ventanas negras. Los datos quedan guardados en la carpeta `data`.

> **Aviso de ngrok:** la primera vez que abras el sitio en cada navegador (y al volver de autorizar en Mercado Libre) ngrok muestra una página que dice *"You are about to visit…"*. Tocá **Visit Site**. Es normal en la versión gratis y después no vuelve a aparecer.

### Ventas (panel lateral → 💰 Ventas)
Elegí el período (este mes, mes anterior, últimos 3 meses, este año, un mes puntual o un rango) y tocá **Traer ventas de este período**. Trae las ventas de todas tus cuentas (o de una sola) y muestra, por venta: precio, comisión de Mercado Libre, envío cobrado por Mercado Libre, neto, lo recibido en Mercado Pago (si Mercado Pago lo informa), tu costo de envío Flex según la zona y el **neto final**. Arriba: facturación, comisiones, envíos, tu costo Flex, ticket promedio y neto final. Las canceladas no suman.
- Las ventas quedan guardadas: la próxima vez solo se actualizan las recientes (tildá "volver a traer las ya guardadas" para forzar).
- Mercado Libre suele dar el historial del último año aproximadamente.
- **Descargar Excel** baja las ventas del período con totales.

**Impuestos:** a cada venta se le descuenta un % del precio por IVA + Ingresos Brutos (23% por defecto, editable en Configuración). Neto = precio − comisión − envío ML − impuestos; Neto final = Neto − tu costo de envío Flex. "Recibido MP" es solo referencia.
**Períodos:** Hoy, 7 días, 15 días, 1 mes, y el selector de mes con flechas ‹ › para ir mes por mes. También hay un rango de fechas a mano.

### Costos de productos y neto después de costos
Los costos se leen de tu lista de precios de Google Sheets (columnas "SKU" y "C TOTAL $PESO"), cada vez que entrás a Ventas o con **Actualizar costos**. También podés **Subir Excel de costos**. Si un SKU no tiene costo, tocá "cargar" y ponelo a mano.
En Ventas, las dos últimas columnas son **Neto** (precio − comisión − impuestos − envío) y **Neto después de costos** (Neto − costo del producto × cantidad), con el margen %. En ventas Flex solo se descuenta tu envío Flex, nunca el envío de Mercado Libre.
El link de la planilla se cambia en Configuración; tiene que estar compartida como "Cualquier persona con el enlace: Lector".

### Estado de las ventas
En Ventas podés filtrar por **Por enviar** (las nuevas que tenés que preparar), **En camino**, **Entregadas** y **Canceladas/devueltas**. Cada venta muestra su estado con color y las tarjetas se calculan sobre lo filtrado. Al entrar a Ventas, el programa actualiza solo el estado de las ventas no entregadas. Las ventas sin envío de Mercado Libre (retiro/acordar) cuentan como entregadas.

### Ranking y Lista de precios (panel lateral)
- **🏆 Ranking:** los SKU más vendidos en el período que elijas (Hoy, 7/15 días, 1 mes, mes a mes o rango), por cuenta, ordenados por unidades, facturación o ganancia. Usa las ventas ya traídas; si el período no está, ofrece traerlo.
- **📋 Lista de precios:** tu planilla (SKU, artículo, stock, costo), con buscador y filtros "sin costo", "cargados a mano" y "sin stock". Desde ahí podés cargar o editar costos a mano.

### Presupuestos (panel lateral → 🧾)
"+ Nuevo presupuesto": cliente, WhatsApp, fecha y productos por SKU (el nombre y el precio "WEB = CLÁSICA" se completan solos desde la lista de precios; el precio se puede cambiar), descuento y medio de pago. **Descargar PDF** genera "Presupuesto - Nombre Apellido.pdf" con el diseño de Biogate.
**Enviar por WhatsApp:** en el celu se abre el menú de compartir con el PDF adjunto (elegís WhatsApp y el contacto). En la PC se abre el chat del cliente con un mensaje y un link al PDF (funciona mientras la app esté prendida) y además se descarga el PDF por si lo querés adjuntar.

### Cuentas que pierden la conexión
Si una cuenta pierde la conexión con Mercado Libre, aparece un cartel rojo arriba y la cuenta se marca con "Reconectar". Casi siempre se debe a que la aplicación de developers no tiene activado **Refresh Token**: activalo y volvé a conectar la cuenta.

### Fecha de venta en Envíos Flex
La columna **Venta** muestra la fecha y hora en que se hizo la venta en Mercado Libre (debajo, en chico, cuándo se cargó en la web). Los filtros Hoy/Ayer/7 días usan la fecha de venta; si necesitás, cambiá a "por fecha de carga".

### Zonas y costo de envío
Cada envío muestra su zona (Capital, GBA 1, GBA 2, GBA 3) y lo que te cuesta, según la localidad del cliente. Arriba del panel ves el **total a pagar** y el detalle por zona, según el período y los filtros elegidos. En el Excel salen las columnas Zona y Costo envío, con el total al final.
- Si una localidad no se reconoce, aparece "Sin zona: elegir…". La elegís una vez y queda recordada para todos los envíos de esa localidad.
- Con "cambiar" podés corregir la zona de un envío puntual.
- Los precios se cambian en el engranaje (Configuración).

### Apariencia y logo
Con el botón de sol/luna cambiás entre modo claro y oscuro. En Configuración podés subir el logo de tu negocio (PNG, JPG, WEBP o SVG, hasta 2 MB): aparece en el panel, el escáner y el login.

### Traer envíos sin escanear (varias cuentas)
- **Traer envíos Flex de todas mis cuentas:** busca las ventas de los días que elijas en todas las cuentas conectadas y carga solo los envíos Flex pendientes (con "incluir ya entregados" trae también los entregados).
- **Subir Excel de ventas:** descargá el reporte de ventas de Mercado Libre (Ventas → Descargar/Exportar) y subilo. La app busca los números de venta o de envío que haya en el archivo y trae los datos de cada uno.

**Para conectar tus 6 cuentas:** en el panel, **Copiar link para otro vendedor**. Abrí ese link en una **ventana de incógnito** (Ctrl+Shift+N), entrá con la cuenta de Mercado Libre y autorizá. Cerrá la ventana y repetí con la siguiente cuenta. Así no tenés que cerrar sesión en tu navegador.

### Mensajes a clientes (uno o varios a la vez)
1. En tu aplicación de Mercado Libre (developers → Mis aplicaciones → Editar), en **Permisos** activá **Comunicaciones pre y post venta** (lectura y escritura) y guardá.
2. En el panel tocá **Desconectar** tu cuenta y después **Conectar mi cuenta de Mercado Libre** otra vez, para que el permiso nuevo quede activo.
3. Tildá los clientes (o el casillero de arriba para todos los que se ven), tocá **Mandar mensaje por Mercado Libre**, elegí un modelo o escribí el tuyo y **Enviar**. `{nombre}` se reemplaza por el nombre de cada cliente.

**Mensaje sugerido:** cada cliente tiene el botón "✉ Mensaje sugerido", y al escanear con el celu aparece el mensaje de bienvenida ya personalizado con el nombre del comprador, listo para enviar o copiar. En la ventana de mensajes, "Bienvenida Biogate" lo carga y la vista previa muestra cómo le llega a cada uno. El texto se edita en Configuración.

Reglas de Mercado Libre: máximo 350 caracteres, solo temas de la venta o la entrega, sin teléfonos, emails ni links. Si el comprador todavía no te escribió, el mensaje sale como "inicio de conversación", y Mercado Libre puede limitar cuántos de esos mandás por venta. Si algo falla, el panel muestra el motivo en cada cliente.

### Mensajes por WhatsApp (semiautomático)
Tildá los clientes y tocá **Mandar por WhatsApp**. Elegí el mensaje (la bienvenida completa, sin límite de caracteres, u otro modelo) y tocá **Abrir siguiente en WhatsApp**: se abre WhatsApp con el mensaje ya escrito y el nombre de ese cliente; tocás Enviar en WhatsApp, volvés y repetís. Solo aparecen los clientes con teléfono cargado. Queda anotado "WhatsApp abierto" en cada uno.
En el celu, al escanear, el mensaje sugerido tiene también el botón **WhatsApp**.
No es 100% automático a propósito: los envíos automáticos desde un WhatsApp común están prohibidos por WhatsApp y te pueden bloquear el número.

### Si repartís envíos de otros vendedores
En el panel tocá **Copiar link para otro vendedor** y mandáselo. El vendedor lo abre, autoriza su cuenta de Mercado Libre y desde ese momento sus envíos aparecen cuando los escaneás. No necesita tu contraseña y puede revocar el permiso cuando quiera desde su cuenta. Sin esa autorización, Mercado Libre no entrega los datos.

### Ventas Full
En **Ventas**, las ventas enviadas por Full tienen la etiqueta **⚡ FULL**, y el selector "Todos los envíos" permite ver solo Full, solo Flex o el resto.

### ⚡ Full (menú lateral)
- **Ventas Full**: elegí 7, 15 o 30 días, este mes, el anterior o **Elegir fechas** (desde/hasta). Arriba, **Vendido por producto**: cuántas unidades y ventas tuvo cada SKU por Full, con facturación y ganancia; se puede ordenar de más a menos vendido (o al revés, o por facturación/ganancia) y bajar en Excel. Tocando un producto se ven solo sus ventas.
- **Stock en el depósito**: tocá **Actualizar stock**. Se muestra igual que en Mercado Libre: una fila por producto del depósito (**Código ML**), aunque esté en varias publicaciones, con ventas Full de los últimos 30 días (unidades y $), no aptas para vender (con el motivo), aptas para vender y tiempo hasta agotar stock en semanas. Las ventas por variante se cuentan con las ventas traídas desde esta versión; para las anteriores, en Ventas tildá "volver a traer las ya guardadas".

### 🏪 Gastos del local
Cargá cada gasto con fecha, monto, **nombre del gasto** (el que quieras; te sugiere solo los nombres que ya usaste), un detalle opcional y cómo se pagó. Con las flechas pasás de mes; arriba ves el total, la comparación con el mes anterior y cuánto va a cada gasto y forma de pago. Tildá **Gasto fijo** en lo que se repite y al mes siguiente **Copiar gastos fijos** los carga de una. **Descargar Excel** baja el mes.

### Estados de WhatsApp
En el menú lateral, **📱 Estados de WhatsApp**. El panel lee los productos de biogate.com.ar (nombre, SKU, precio, foto y descripción) al arrancar y con **Actualizar productos de la web**.
1. Elegí el producto.
2. **Diseño**: Clásico, Oferta (estrella con el precio), Minimal (fondo blanco, foto grande), Diagonal, Beneficios (con 3 tildes), Nuevo ingreso o Combo (tocá 2 o 3 productos de la lista; el precio combo arranca con 10% menos y lo podés cambiar).
3. **Fondo**: foto difuminada, magenta, violeta, verde salud, negro, pastel, íconos de salud o **tu fondo** (subís una imagen).
4. **✨ Sugerir textos**: títulos cortos, beneficios y frases armados con el nombre y la descripción de tu web; tocá el que te guste.
5. Ajustes: tamaño y posición de la foto, tamaño del título, color del precio, sticker (Envío gratis, Cuotas sin interés, -15%…), frase y posición del logo.
6. **🎲 Sorprendeme** cambia diseño, fondo y colores para que no salgan todos iguales.
7. **Descargar imagen**, o en el celu **Compartir en WhatsApp → Mi estado**.
Si la web no deja leer la lista de productos, en "Configurar web" cargá una clave de WooCommerce de solo **Lectura** (WordPress → WooCommerce → Ajustes → Avanzado → API REST → Añadir clave).

### Recibos en el Resultado del mes
En **📊 Resultado del mes** se suman los presupuestos **confirmados** del mes (por su fecha), separados por origen. En **Presupuestos**, cada uno tiene el botón **✅ Confirmado / ⏳ Sin confirmar**: los nuevos arrancan sin confirmar y los tocás cuando se venden (los anteriores a este cambio quedaron confirmados). Los sin confirmar aparecen como aviso, sin sumar. Se separan por origen: **Pacientes de Lara**, **WhatsApp**, **Local** (y Mail, Instagram o "Sin origen" si hay). La ganancia se calcula igual que la web: total − impuestos (23%) − costo de mercadería de la lista de precios. Entran en el NETO NETO, en el histórico y en el Excel del resultado.

### Elegir qué cuentas ver (Ventas y Resultado del mes)
En **Resultado del mes** también está el selector de cuentas (al lado del mes), con **Todas / Todas menos TUYO / Ninguna** o tildando una por una, y además podés sacar **Ventas web** o **Presupuestos confirmados** del cálculo. **TUYO aparece en la lista pero viene destildada**: si la tildás, se suma con su propio bloque (bruto, comisiones, envíos, impuestos, costo Amazon y Neto TUYO), entra en la facturación total y el NETO NETO, aparece la columna TUYO en el histórico y también se incluye en el informe PDF. Si no la tildás, no se suma. En **Total del mes**, debajo de "Neto de todas las ventas", está **Neto Mercado Libre + comisiones**: el neto que paga Mercado Libre (el mismo "Neto antes del costo de mercadería" de Ventas) más las comisiones de Mercado Libre (y TUYO si está tildada). Debajo de "Ventas brutas" de Mercado Libre se ve cuánto vendió cada cuenta. Al lado de lo facturado de cada cuenta está su **Neto** = neto que paga Mercado Libre (antes del costo de mercadería) + comisiones; también sale en el informe PDF. Cada sección recuerda su propia elección.

### Ventas por cuenta
En **Ventas**, arriba de la lista, la tabla **Ventas por cuenta** muestra para el período elegido cuánto vendió cada cuenta de Mercado Libre: ventas, unidades, facturado, % del total, neto y neto después de costos, y canceladas.

### 📄 Informe del mes (PDF)
En **Resultado del mes** elegí el mes con las flechas y tocá **📄 Informe PDF**. Se descarga un PDF listo para imprimir o mandar con: un resumen en texto comparado con el mes anterior (facturación, ventas, ganancia, neto neto, la cuenta que más vendió, el producto más vendido, el mejor día), los indicadores principales, de dónde vino la facturación (Mercado Libre, web y presupuestos), Mercado Libre por cuenta, los 10 más vendidos (con las unidades del mes anterior) y los gastos del local por categoría. Incluye TUYO solo si está tildada en el selector de cuentas.

### Elegir qué cuentas ver y traer (Ventas)
En **Ventas**, la lista **Todas las cuentas** se abre y tiene una casilla por cuenta: tildá solo las que querés ver. **Traer ventas de este período** trae solo esas. Atajos: **Todas**, **Todas menos TUYO** y **Ninguna**. La elección queda guardada.

### 🛒 TUYO (productos de Amazon)
Cuenta de Mercado Libre con productos comprados en Amazon: sus ventas se traen igual que las demás, pero el costo no sale de la lista de precios.
1. Conectá la cuenta nueva (en TUYO → **Copiar link de invitación**, abrilo en incógnito y autorizá con esa cuenta).
2. En **TUYO** elegí esa cuenta. Arriba quedan el **envío por kilo (US$ 35)** y el **tipo de cambio (1550)**, editables.
3. Traé sus ventas desde **Ventas** (elegí la cuenta → Traer ventas).
4. En la tabla de productos cargá a cada publicación el **precio en Amazon (US$)** y el **peso** (kg, libras u onzas). El panel calcula: costo US$ = precio + peso en kilos × 35; costo $ = costo US$ × 1550. Se guarda solo.
5. Arriba elegís el período: **Hoy**, **7 días**, **30 días**, un mes con las flechas, o un rango con las fechas **desde/hasta**. **Traer ventas de este período** trae todas las ventas pagadas de esa cuenta en esas fechas, aunque todavía no se hayan despachado.
6. **Cómo se pagó y cuánto queda**: facturación bruta − canceladas y devueltas − comisiones − envíos − impuestos − costo Amazon = neto después de costos. Abajo está la lista de ventas igual que en Ventas, con filtro Por enviar / En camino / Entregadas / Canceladas y devueltas.
7. En **Resultado del mes** (y en el informe PDF) TUYO se suma solo si la tildás en el selector de cuentas.

### 🔔 Notificaciones en el escritorio (aunque el panel esté cerrado)
En **Preguntas** o **Recompras** tocá **🔔 Activar notificaciones** → **Activar** → Permitir. Desde ese momento a esa compu (o celular) le llegan avisos de Windows/Android **aunque el panel esté cerrado**, mientras el navegador esté abierto o en segundo plano: cada **pregunta nueva** al instante, y a las **9 de la mañana** cuántos clientes hay para avisar en **Recompras**. Se activa en cada equipo; con **Probar** ves cómo llega y con **Desactivar** se apaga. Si no aparecen: Windows → Configuración → Sistema → Notificaciones → que el navegador esté activado y "No molestar" apagado.

### 💬 Preguntas (todas las cuentas)
Menú lateral → **Preguntas**: las preguntas de los compradores de todas tus cuentas de Mercado Libre (incluida TUYO; con el selector elegís cuáles ver). Cada una muestra la cuenta, el comprador, la publicación (foto, precio, stock y SKU) y la pregunta; respondés ahí mismo y se publica en Mercado Libre.
- **Al instante**: activá una vez las notificaciones de Mercado Libre (el cartel de la sección te guía): en developers.mercadolibre.com.ar → Mis aplicaciones → tu aplicación → Editar, en **URL de retornos de llamada de notificación** poné `https://<tu panel>/api/ml/notify` y tildá el tópico **Questions**. Además, por las dudas, el panel repasa las preguntas sin responder cada pocos minutos.
- **Aviso**: numerito rojo en el menú, sonido (🔊 se apaga desde la sección) y notificación del navegador (🔔 Activar avisos en esta compu) cuando entra una pregunta nueva con el panel abierto.
- **⚡ Respuestas rápidas**: textos guardados que se insertan con un toque (ej. Stock, Envío, Cómo se toma).
- **👤 Historial del comprador**: otras preguntas que te hizo y si ya te compró.

### 🔔 Recompras (cuándo se le termina el suplemento al cliente)
Usa la columna **DURACION** de la lista de precios (por ejemplo "60 DIAS"). Por cada venta de Mercado Libre, presupuesto confirmado o venta web, cruza el SKU con esa duración: fecha de compra + días (× unidades: 2 frascos de 30 días = 60 días). **Aviso del día:** a cada cliente le toca avisarle **1 día antes** de que se le termine; si ese día cae **sábado o domingo, el aviso pasa al lunes** (todos juntos). El numerito rojo del menú, el cartel de arriba y la notificación del navegador (🔔 Activar avisos en esta compu) cuentan **solo los de hoy**. Las dos cosas se cambian en **⚙️ Mensajes y aviso**.
- Pestañas: **Hoy** · **Próximos 7 días** (se terminan hoy, mañana o en los próximos días) · **Después** · **Avisados** · **Todos**, y **Día de aviso** para ver cualquier fecha.
- **Varios a la vez:** tildá los clientes (o el casillero de arriba para todos) y tocá **✉️ Mandar el mismo mensaje**. Elegís por dónde (ML a los de ML y WhatsApp al resto, WhatsApp a todos los que lo tienen, o solo ML) y a cada uno le cambia el nombre, el producto y la fecha. Los de Mercado Libre se mandan solos; los de WhatsApp se abren de a uno con **Abrir el siguiente**. También podés **marcar avisados** o **no avisar** a todos los tildados.
- **💬 Mercado Libre**: abre el mensaje ya armado (lo podés cambiar) y lo manda por la mensajería de la venta. Máximo 350 caracteres.
- **🟢 WhatsApp**: aparece si tenemos el teléfono (presupuestos, web, o compradores de ML que alguna vez pasaron por un envío Flex escaneado); abre WhatsApp con el mensaje listo. Si no está, tocá **➕ Agregar WhatsApp** debajo del nombre: queda guardado para todas las compras de ese cliente (con ✏️ se cambia o se borra).
- **✓** ya le avisaste por otro lado · **✕** no avisar. Si el cliente volvió a comprar el mismo producto antes de que se le termine, se marca solo como **🔁 volvió a comprar**.
- Los mensajes usan {nombre}, {producto}, {fecha}, {cuando}, {dias} y {hasta} (hoy + 7 días, para la validez del descuento). Los dos (WhatsApp y Mercado Libre) ofrecen un **cupón de 10% de descuento válido por 7 días** para reponer. En ML conviene mandarlos de a uno (Mercado Libre controla los mensajes con promociones) y, para aplicar el descuento, crear un cupón de vendedor en ML.
- **Nombre del cliente**: en ML se busca solo en los datos de facturación de la venta; si no aparece, tocá ✏️ al lado del nombre y cargalo (queda para todas sus compras). Los productos sin duración en la planilla no avisan.

### ✅ Tareas
Para repartir tareas al equipo (menú lateral → **Tareas**).
1. Tocá **👥 Encargados** y cargá los nombres (cada uno con su color).
2. **+ Nueva tarea**: qué hay que hacer, detalle, encargado, prioridad y, si querés, **fecha límite** (con hora opcional; si no la tildás, queda sin fecha). Podés sumar **fotos** (se achican solas para que suban rápido), **archivos** (PDF, Excel, etc.) y **links** (por ejemplo un Google Doc). También podés arrastrar fotos o archivos sobre la ventana.
3. Los encargados entran al panel con la contraseña de siempre, eligen su nombre arriba en **Soy** (queda guardado en ese celular o compu) y en cada tarea tocan **Sin revisar / En proceso / Terminada**. También pueden dejar comentarios con fotos. Todo queda en el **Historial** de la tarea con quién lo hizo.
4. Se ve **Por estado** (3 columnas) o **Por empleado** (una columna por encargado). Arriba: filtro por encargado, buscador y **Ocultar terminadas**. Las vencidas se marcan en rojo y los contadores muestran cuántas hay.

### Subir gastos desde Excel
En **🏪 Gastos del local** → **📥 Subir Excel**. El panel reconoce solo las columnas (Fecha, Gasto/Concepto, Monto/Importe, Forma de pago, Detalle), aunque el título no esté en la primera fila. Antes de importar muestra una vista previa; si alguna columna no se reconoció, la elegís en la lista. Si la planilla tiene varias hojas (por ejemplo una por mes), podés importar **Todas las hojas**. Las filas de TOTAL se ignoran y los gastos que ya estaban cargados (misma fecha, gasto y monto) se saltean.

### Etiquetas de producto
En el menú lateral, **🏷️ Etiquetas de producto**. Arma la etiqueta de 10 × 5 cm igual a los modelos de cada marca, pero dice **SKU** en lugar de MODELO.
1. Tocá la marca: **BIOGATE**, **PESTGATE**, **PETGO** o **PLAYFUSION** (logo, color de la barra y del borde de cada una).
2. Escribí el **SKU**. Podés elegir uno de la lista de precios o poner uno nuevo. Si es muy largo, la letra se achica sola para que entre.
3. **Cantidad** = cuántas copias. **Origen** viene en CHINA; cambialo si hace falta.
4. **Descargar PDF** baja esa etiqueta. Con **Agregar a la lista** juntás varias (distintas marcas y SKU) y las bajás todas juntas con **Descargar todas**:
   - **Rollo / impresora de etiquetas**: una etiqueta por página de 10 × 5 cm.
   - **Hoja A4**: 10 etiquetas por hoja.
5. **Últimas generadas**: tocá una para volver a cargarla.
6. **Datos del importador** (nombre, dirección, CUIT, teléfono) se pueden editar y quedan guardados para todas las etiquetas.
Al imprimir el PDF, elegí **Tamaño real / 100 %** (no "Ajustar a la página").

---

## Problemas comunes

- **La ventana del servidor dice "Falta la variable de entorno…":** corré `configurar.bat` de nuevo.
- **ngrok da error de dominio o de token:** revisá que el dominio escrito en `configurar.bat` sea exactamente el de tu panel de ngrok y que el authtoken esté cargado.
- **Mercado Libre dice "redirect_uri inválido":** la URI de tu aplicación en Mercado Libre tiene que ser exactamente `https://TU-DOMINIO-NGROK/auth/callback`.
- **"No pertenece a ninguna cuenta conectada":** el envío es de un vendedor que no autorizó la aplicación.
- **La cámara no abre:** la dirección tiene que empezar con https y el navegador tiene que tener permiso de cámara. Si no, usá "Cargar número de envío a mano".
- **Falta algún dato:** con sesión iniciada, abrí `https://TU-DOMINIO-NGROK/api/debug/NUMERO_DE_ENVIO` para ver qué responde Mercado Libre. Con eso se ajusta `lib/ml.js`.
- **Backup:** copiá la carpeta `data` de vez en cuando; ahí está todo.

## Privacidad
Guardás datos personales de compradores: usalos solo para gestionar la entrega y la atención de esa venta, como piden las políticas de Mercado Libre y la Ley 25.326 de protección de datos. El panel está protegido con contraseña; elegí una larga. No compartas el archivo `.env`.
