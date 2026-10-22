# Orbit — instrucciones del proyecto

## Qué es
App web instalable (PWA) de finanzas personales. Sitio estático: casi todo vive en `index.html`
(~18.000 líneas). Funciones de servidor en `/api` desplegadas en Vercel. Base de datos y login en
Supabase (Postgres con seguridad por fila). IA a través de Groq.

- Despliegue: Vercel, sin paso de build (`vercel.json`). Cron diario de `/api/send-push`.
- `wealthos_v6.html` es una versión antigua: no editarla; se eliminará.

## Principios innegociables
1. **Nunca inventar datos.** Prohibido mostrar datos de ejemplo, simulados o de relleno como si fueran
   reales. Si una fuente falla: mostrar el error y la última cifra válida con su fecha.
2. **Una sola fuente de verdad por dato: Supabase.** `localStorage` solo para caché y preferencias,
   nunca como almacén principal.
3. **Fallar en voz alta.** Nada de `try {} catch {}` vacíos. Toda escritura en Supabase se espera
   con `await` y su error se comprueba y se muestra.
4. **Todo dato de mercado lleva fecha, fuente y moneda.** Todo se convierte a EUR con el tipo del BCE
   (Frankfurter) antes de sumarse.
5. **Ninguna clave en el cliente.** Solo `process.env` dentro de `/api`.
6. **Menos funciones, que funcionen bien.** No añadir funcionalidades no pedidas. Núcleo: patrimonio
   (cartera, private equity, efectivo), gastos, precios, política y registro de decisiones.
   Congelados: social, noticias, resumen diario, push no esencial.
7. **Cambios pequeños.** Un cambio lógico por commit, con mensaje descriptivo. Nunca borrar y
   volver a subir archivos enteros.
8. **Lógica financiera con prueba previa.** Antes de cambiar un cálculo, escribir casos con números
   concretos y el resultado esperado, y verificarlos.
9. **Nunca datos personales en el repositorio.** El repo es público: nada de importes, posiciones,
   nombres ni documentos reales en código, comentarios, tests o commits.

## Seguridad
Hecho (1 oct 2026):
- `/api/news`: sin clave de reserva en el código; error claro si falta `NEWS_API_KEY` y 502 si NewsAPI falla.
- `/api/health`: ya no devuelve fragmentos de la clave de Groq; rechaza peticiones de otras webs.
- `/api/send-push`: `CRON_SECRET` obligatoria (Vercel la envía automáticamente en el cron).
- `/api/groq`: solo peticiones desde la propia app, lista cerrada de modelos
  (`llama-3.3-70b-versatile`, `meta-llama/llama-4-scout-17b-16e-instruct`, `groq/compound-mini`),
  tope de 4.000 tokens y de 60 mensajes. Si se añade un modelo nuevo en la app, añadirlo a la lista.

Modelos de IA (resuelto 3 oct 2026):
- El Mentor dejó de funcionar porque Groq retiró los tres modelos que usaba la app:
  `llama-3.3-70b-versatile` (16/08/2026), `meta-llama/llama-4-scout-17b-16e-instruct` (17/07/2026)
  y `groq/compound-mini` (21/09/2026, sin sustituto). No era la clave ni la comprobación de origen.
- `/api/groq` traduce los nombres antiguos a los sustitutos oficiales: texto → `openai/gpt-oss-120b`
  (razonamiento `low`, sin devolverlo, mínimo 1.024 tokens); imágenes → `qwen/qwen3.8-27b`.
  Configurable sin tocar código con `GROQ_MODEL_TEXT` y `GROQ_MODEL_VISION` en Vercel.
- `groq/compound-mini` se rechaza con 410: lo usaban las noticias con URL y el comentario macro de
  los informes, que necesitan búsqueda web. Un modelo sin internet inventaría esos datos.
- La respuesta incluye también `content[0].text`: cuatro puntos de la app leían ese formato y
  recibían texto vacío sin avisar.
- Revisar https://console.groq.com/docs/deprecations periódicamente.
- Pendiente: el mensaje de error de `sendChat` culpa siempre a `GROQ_API_KEY`; debe mostrar el error real.

Pendiente:
- Las claves de Twelve Data, Finnhub y FMP siguen en `index.html`: rotarlas y moverlas al servidor
  (tarea 2). Hasta entonces, no volver a escribir claves nuevas en el cliente.
- `/api/groq`: exigir además la sesión de Supabase (JWT). La comprobación de origen frena a otras
  webs, pero no a quien llame directamente fuera del navegador.

## Problemas conocidos, por prioridad

### 1. Noticias inventadas — resuelto
`getMockNews()` y `generateMockPortfolioNews()` eliminadas (eran código muerto). Las noticias reales
salen de `/api/news`. `fetchFinancialNews()` tampoco se usa: candidata a eliminarse.

### 2. Precios
- Dos caminos: `updateBolsaPricesForBlock()` convierte divisas; `updateBolsaPrices()` no (suma USD
  como EUR). Dejar una única función.
- Llamar a precios desde el servidor (`/api/prices` existe y no se usa), no desde el navegador.
- Resolver cada posición por ISIN una vez y guardar cotización, bolsa y moneda exactas.
- Cada posición guarda `price`, `currency`, `price_date`, `source`. Si falla, conservar el último
  precio válido marcado como antiguo; no marcar el bloque como actualizado si alguna posición falló.

### 3. Gastos
- Los meses se guardan por nombre ("Marzo") sin año y en dos idiomas: los años se mezclan.
- Sin control de duplicados al importar.
- `mergeExpenseMovements()` aplica `Math.abs` y `isIncome:false`: los ingresos y devoluciones
  cuentan como gasto.
- Todo el historial se guarda como un único JSON que se sobrescribe (se pierden datos entre
  dispositivos) y el guardado no se espera.
- El aviso de nómina duplicada compara el mes sin el año y borra documentos.
- Categorización por 29 palabras clave: la mayoría de conceptos reales caen en "Altres".

Modelo objetivo: tabla `movements` (una fila por movimiento):
`id, user_id, date (date), amount numeric (negativo = gasto), currency, account_id, concept_raw,
category, source (import | manual | quick), dedupe_hash, created_at`, con
`unique(user_id, dedupe_hash)` y seguridad por fila `auth.uid() = user_id`.
Tabla `category_rules (user_id, pattern, category, priority)`: reglas del usuario que se aplican
antes que la IA; la IA solo sugiere y el usuario confirma; cada recategorización puede crear regla.
Migrar los datos actuales usando la fecha de cada movimiento, no la clave del mes.

### 4. Private equity
Resuelto (3 oct 2026):
- Subir un capital call o una distribución registra el movimiento (`registerPEFlowFromDoc`) y lo SUMA
  al acumulado, igual que `saveTx`. Antes el importe de la llamada sustituía al desembolsado total
  y no se creaba ningún movimiento. No se duplica si se sube dos veces el mismo documento.
- El valor de la posición se ajusta con cada movimiento (`nav_adjustments`, `nav_adjusted_since`)
  hasta que un informe trae un NAV oficial, que lo sustituye.
- TVPI, DPI y RVPI de la posición se calculan: (distribuido + NAV) / desembolsado, etc. Los múltiplos
  que trae un informe son los del fondo y se muestran aparte como "Fondo (informe)".
- `detectPEFlowType`: el tipo real del documento se detecta por su contenido (nombre, campos, texto).
  El desplegable de subida viene marcado como "Report trimestral" y los capital calls entraban como
  informe, sobrescribiendo el desembolsado con el importe de una sola llamada.
- En avisos de capital call o distribución no se aplica nada de `actualizar_bloque` (ni valor ni
  acumulados): su importe es el de esa operación.
- Ningún documento puede hacer bajar `called`, `distributed` ni `committed`.
- Modelo de una sola fuente de verdad (`recomputePE`): `called`, `distributed`, `committed` y el
  valor ya no se escriben, se CALCULAN con los movimientos (`pe_transactions`), un saldo inicial
  (`called_base`, `distributed_base`, `committed_base`) y el último NAV oficial (`nav_official`,
  `nav_date`). Valor = NAV + calls posteriores − distribuciones posteriores (o coste sin NAV).
  Se recalcula al cargar, al registrar o borrar un movimiento, al subir documentos y al editar.
- El formulario de edición conserva los datos que no edita (antes reemplazaba `extra` entero y ponía
  el distribuido a DPI × desembolsado). Lo tecleado son totales reales; el saldo inicial se deduce.
- Los movimientos se pueden borrar (`deleteTx`).
- La app pregunta antes de actuar: enseña el antes/después (desembolsado, pendiente, valor) y pide
  confirmación; si hay un movimiento igual pregunta si es el mismo; si no encuentra importe o fecha
  los pide. `peConsistencyHTML` detecta valor ≠ desembolsado neto sin NAV oficial (`nav_source`) y
  ofrece resolverlo en un toque (`peResolve`).

## Sincronización entre dispositivos (5 oct 2026)
- Ocho tipos de datos vivían solo en el navegador: presupuestos, objetivos, meta de ahorro,
  aportaciones, alertas, historial del Mentor, marca de nómina y preferencias.
- Tabla `user_kv` (`sql/user_kv.sql`, con seguridad por fila). `Storage.prototype.setItem` se
  intercepta para subir las claves de usuario de la lista `KV_PREFIXES`/`KV_GLOBALS`; `kvSync()` se
  ejecuta al arrancar (antes de leer esos datos) y gana la versión más reciente por clave. En la
  primera sincronización, si el dispositivo tenía un valor distinto, se guarda en `orbit_kvbackup_*`.
- `refreshFromCloud()` recarga todo al volver a la app tras más de 30 s.
- Las cachés (precios, noticias, ISIN, LLM) no se sincronizan.
- Limitación: no es en tiempo real con los dos dispositivos abiertos a la vez; gana la última edición.

Pendiente:
- La extracción debe ser **a ciegas**: no pasar al modelo el comprometido ni el desembolsado del
  bloque. Comparar con el registro propio después, en código.
- `extractPDFText()` une el texto con espacios y destruye las tablas; no hay OCR para escaneados;
  el texto se trunca (~30.000 caracteres).
- Dos tipos de documento: *estado de posición* (fecha valor, nº de acciones, valor liquidativo por
  acción, desembolsado, distribuciones: valor = acciones × NAV por acción) e *informe trimestral*
  (solo resumen). El usuario confirma antes de aplicar y el documento queda enlazado como fuente.
- Conservar la validación existente (`validateFundExtraction`): es correcta.

## Cómo trabajar
- Una tarea cada vez, en el orden de arriba. Antes de editar, explicar qué se va a cambiar.
- Tras cada cambio: comprobar la sintaxis de los scripts de `index.html` y describir cómo probarlo.

## Instinct (6 oct 2026) — paso 3 del plan, adelantado
- El usuario lo gestiona todo desde Instinct por WhatsApp: las respuestas de `/api/instinct` son la
  interfaz principal. Campo `message` listo para enviar; cifras siempre calculadas en código.
- `sql/002_instinct.sql`: `movements`, `budgets`, `savings_goals`, `instinct_tokens` (solo hash),
  `notifications_sent`. Seguridad por fila en todas.
- `api/instinct.js`: expense, income, set_budget, set_goal, save, buy, sell, summary, alerts, undo,
  recent. Importes en céntimos; mes en hora de Europe/Madrid; idempotencia por `request_id`; avisos que
  no se repiten; deshacer 24 h. Probado con 20 conversaciones contra una base de datos simulada.
- `instinct.html`: vista móvil del mes y formularios. Token en el fragmento `#t=`; consulta los avisos
  con `all=1` para no marcarlos como enviados.
- Guía y texto para Instinct: `docs/INSTINCT.md`. Plan general: `docs/PLAN.md`.
- Pendiente: Cartera leyendo `movements` (paso 2) y Gastos unificado en `movements` (paso 4).

## Instinct escribe en los almacenes de la app (6 oct 2026)
- Requisito del usuario: todo lo que apunte Instinct debe verse en la app y viceversa. `api/instinct.js`
  ya no usa tablas propias para gastos, límites ni objetivos: lee y escribe `user_expense_data` (mismo
  formato que el Excel y `applyQuickExpense`), `user_kv` (`wealth_budgets_*`, `wealth_goals_legacy_*`) y
  las categorías de `QUICK_CATS` en catalán. `movements` queda solo para compras y ventas.
- Cada movimiento de Instinct lleva `id`, `created_at`, `source:'instinct'` y `request_id`.
- Cliente: `_mergeCloudNewItems` incorpora, antes de cada subida, los movimientos de la nube creados
  después de la última sincronización (`orbit_exp_synced_*`). Así no se pisan los de Instinct y no se
  resucita lo borrado. Probado con dos navegadores independientes + Instinct sobre la misma nube.
- `budgets` y `savings_goals` de 002_instinct.sql quedan sin uso.

## Instinct puede accionar todo (6 oct 2026)
- 29 acciones en `api/instinct.js`: gastos (alta, edición, borrado), límites, objetivos, activos (alta,
  edición, archivo), private equity (call, distribución, compromiso, NAV, estado, borrado de movimientos)
  con `recomputePE` portado del cliente, bolsa (compra, venta, precio, edición y borrado de posiciones,
  con tipo BCE de Frankfurter y coste medio), documentos (almacén `wealth-docs` + `documents`, misma ruta
  que `uploadFileToStorage`) y noticias reales de las posiciones vía NewsAPI.
- Borrados y archivos piden `confirm: true`. Búsqueda de activos por palabras del nombre; si hay empate,
  pregunta. Probado con los activos reales del usuario (25 casos) más regresión de gastos (10 casos).

## Incidencia: compras de Instinct invisibles (6 oct 2026)
- Causa 1: en GitHub seguía la primera versión de `api/instinct.js`, que escribía gastos y compras en
  `movements` (tabla que la app no lee). Recuperación: acción `migrate_legacy` (idempotente,
  `request_id: legacy:<id>`, marca lo recuperado como borrado). El historial nuevo de operaciones lleva
  `category: 'cartera'` para no confundirse con lo antiguo.
- Causa 2 probable del patrimonio a 0: la llave de Instinct asociada a un usuario distinto del de la app.
  Pendiente de verificar en Supabase.
- `recent` muestra gastos, compras/ventas y movimientos de private equity.

## API v2 para el asistente (20 oct 2026) — contrato en docs/API.md
- Causa de "puede leer pero no escribir": el último commit editó `instinct.js` en la RAÍZ del repo; Vercel
  solo ejecuta `api/`. En producción seguía una versión antigua. Hay que borrar el `instinct.js` de la raíz.
- Rutas REST vía reescritura en `vercel.json` (`/api/instinct/:path*` → `/api/instinct?route=`): GET month,
  POST expenses/incomes, DELETE expenses/{id}, POST cash-balance, POST trades, POST trades/{id}/fill,
  DELETE trades/{id}. `?_method=POST|DELETE` permite escribir por GET si el entorno no puede hacer POST.
- Idempotencia por `id` en todas las escrituras. Sin `undo` global: se borra por id.
- Efectivo: `extra.applied['item:<id>' | 'trade:<id>' | 'adjust:<id>']` registra lo aplicado (una vez,
  reversible). `extra.balance_date`: lo anterior a esa fecha no mueve el saldo. Misma regla en la app.
- Operaciones: dos de tres (qty, price, amount); órdenes pendientes en `extra.pending_orders` del bloque de
  bolsa; la posición se registra al precio exacto pagado (coste medio con 6 decimales) para revertir exacto.
- Ingresos: la nómina ya no se cuenta dos veces (campo `nomina` + movimiento). Igual en app y servidor.
- Excel: fechas normalizadas (serie, DD/MM, MM/DD); la importación AÑADE sin pisar, deduplica por fecha +
  importe + tipo + concepto, y mueve el efectivo solo por filas nuevas. Antes llamaba a `saveBlock()` (lee el
  formulario) y el ajuste de saldo nunca se guardaba; ahora `saveBlockDB`.
- Pruebas: 26 casos REST, 14 de regresión, importación real con SheetJS y borrado cruzado app → servidor.

## Rediseño premium (20 oct 2026): `app.html`
- Interfaz nueva en un archivo aparte; `index.html` sigue intacta como app clásica y pantalla de login.
  Comparten la sesión de Supabase (clave de almacenamiento por defecto) y los mismos datos.
- Cinco secciones: Inicio, Cartera, Inversiones privadas, Gastos, Noticias. Rutas por hash (#inicio…).
  Barra lateral en escritorio, barra inferior en móvil. Gráficos SVG propios, sin librerías.
- Datos reales: `blocks`, `patrimonio_history`, `user_expense_data`, `user_kv` (límites, objetivos,
  `orbit_instinct_whatsapp`), `movements`, `pe_transactions`, `notifications_sent`, `instinct_tokens`.
  Noticias vía `/api/news` (sin claves en la web). Si falta un dato, se muestra el estado y la acción.
- Una sola recomendación por reglas (prioridad): límite superado → ritmo de gasto → private equity
  incoherente → objetivo retrasado → satélites >10 % → falta cuenta de efectivo → todo en orden.
- Instinct no es un chat: franja de actividad y botones que abren WhatsApp (`wa.me`) con el mensaje preparado.
- Altas y borrados desde la app usan las mismas reglas de efectivo que la API (`extra.applied`, `balance_date`).
- API 2.1: `GET /selftest` y `POST /selftest` para diagnosticar escrituras del asistente.
- Pendiente: endpoint de pagos detectados + app compañera Android; alternativas iPhone; edición en la app nueva.

## Rediseño de index.html (20 oct 2026) — solo diseño
- Petición: mantener TODA la funcionalidad (APIs de noticias, precios, Mentor, private equity…) y cambiar
  solo el aspecto de index.html al estilo de app.html, más denso y con los datos grandes en Hoy.
- Capa `<style id="theme-wealthos">` al final del body: redefine las variables (paleta bosque/salvia/crema/
  lima, Geist para --display, --sans y --mono, radios, sombras, tintes) y reestiliza .sb, .ni, .top, .btn,
  .card, .hero y la barra móvil. Al usar casi todo el HTML esas variables, el cambio llega a todas las pestañas.
- Hoy: `.dash-top` = patrimonio protagonista (tarjeta bosque, gráfico bajo la cifra) + `renderDashTiles()`
  (gastos del mes frente a límites, rentabilidad de inversiones, efectivo, colchón con tope "Más de 24").
  El pulso semanal y "Qué está pasando hoy" pasan debajo. `renderDashBento` ya no pinta esas cifras.
- Ningún cálculo nuevo: las cifras salen de computeInvestmentReturn, computeOrbitScore, loadBudgets,
  expenseData y blocks. Verificado con capturas en Chromium (escritorio, móvil, Cartera, Gastos, Efectivo).

## Tres vías de entrada sin POST desde Instinct (21 oct 2026)
- El entorno de Instinct no puede hacer POST. Sus opciones preferidas: (1) hoja de Google, (2) formulario en la app.
- Hoja: `docs/orbit-sheets.gs` (Apps Script). Empuja cada 5 min las filas nuevas a la API con la llave guardada en
  las propiedades del script; columnas por nombre; añade ID/Estado/Mensaje Orbit; `BORRAR` en Estado elimina;
  `REINTENTAR` en fallos pasajeros. Guía: `docs/HOJA-GOOGLE.md`. Probado con hoja simulada y la API por HTTP real.
- Formulario `#m-mov` en index.html (botón "Movimiento", también el "+" del móvil): Gasto, Ingreso, Compra/venta,
  Saldo. Llama a `/api/instinct?route=…` con el access_token de la sesión; un id por apertura (doble clic no duplica).
- API 2.2: autenticación por sesión (JWT validado en `/auth/v1/user`), origen por petición con AsyncLocalStorage
  (`instinct` | `sheet` | `app`), control de concurrencia optimista en `user_expense_data` y en el saldo de efectivo
  (`updated_at` como versión, reintentos con espera creciente, 409 si se agotan). Probado con 10 escrituras simultáneas.

## Objetivo de ahorro como presupuesto de gasto (21 oct 2026)
- `spendPlan()`: objetivo (p. ej. 85 %) × nómina de referencia ⇒ gasto permitido del mes (15 %), lo que queda, € al día,
  ritmo de hoy (permitido × día/días del mes), proyección a fin de mes y estado (bien / rápido / te has pasado).
- Nómina de referencia en `wealth_nomina_ref_<uid>` (sincronizada vía user_kv): el cálculo no depende de que la nómina
  del mes esté apuntada. Si no hay nómina guardada, usa los ingresos registrados del mes.
- `renderSavingsTarget` rehecho (antes usaba el último mes con datos y los ingresos registrados, que podían ser 0);
  editor admite hasta 95 % y pide la nómina. En Hoy, la primera cifra grande es "Te queda para gastar".
- `feP()`: importes del plan con céntimos (15,50 €) y punto de miles (1.890 €).
- Nómina y "Para ahorrar" ocultas por defecto (`.sec-hidden`, `•••• €`); el ojo (`toggleNominaVisible`) las muestra solo durante la sesión (`window._nominaVisible`).

## Siri y notificaciones (21 oct 2026)
- Siri: `/api/quick-expense` mantiene su formato ({token, amount, category, note}) pero ahora registra al instante vía
  `recordQuickExpense` de instinct.js (efectivo una vez, concurrencia, origen `siri`). Id derivado de contenido + minuto:
  un reenvío inmediato no duplica. Si falla, respaldo en `quick_expenses` (la app lo recoge al abrir). Acepta "45,50".
  El token del atajo pertenecía a la cuenta borrada: hay que generar uno nuevo en Gastos → Siri / Atajos.
- `getOrCreateQuickToken` y `enableDailyPush` ya comprueban el error de Supabase (antes decían "activado" sin guardar).
- `push_subscriptions` no tenía las columnas name, tickers, pref_daily/weekly/alerts que guarda la app y que lee
  send-push: `sql/003_siri_notificaciones.sql` las añade (idempotente). send-push filtra `pref_daily=not.is.false`.
- `/api/health` informa (sin valores) de SUPABASE_SERVICE_ROLE, CRON_SECRET, VAPID_PUBLIC/PRIVATE y NEWS_API_KEY.

## Noticias de la mañana de Instinct = selección de Orbit (21 oct 2026)
- La selección diaria de la app (`loadDailyInsights`, clave `wealthos_insights_<uid>_<fecha UTC>`) se sincroniza con
  user_kv (prefijo añadido a `KV_PREFIXES`).
- `GET /api/instinct/news/today` (acción `news_today`): lee esa selección y la ordena igual que
  `renderComprehensionHero` (`holdingsOf` = getHoldings, `groundOf` = groundInsight). Si no existe o tiene más de 12 h,
  la genera con el mismo método de la app (Finnhub por posición US + generales + forex, misma instrucción a la IA) y la
  guarda con la misma clave; conserva 7 días. Requiere `FINNHUB_KEY` en Vercel. Verificado contra las funciones reales
  de la app: mismas 3 noticias y mismo orden.
- 21 oct 2026: verificado en producción que `/api/instinct/<ruta>` da 404 (la reescritura de vercel.json no se aplica) y que `/api/instinct?route=<ruta>` funciona. Usar siempre `?route=`.
