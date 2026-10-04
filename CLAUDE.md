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
