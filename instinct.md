# Orbit + Instinct: puesta en marcha

## 1. Preparar Orbit (una vez)
1. **Supabase → SQL Editor**: ejecuta `sql/002_instinct.sql` y `sql/user_kv.sql` (este último guarda
   tus límites y objetivos en la nube; sin él, Instinct no los ve).
2. **Crea el token de Instinct**: en el mismo editor, ejecuta el bloque comentado al final de ese archivo
   (quita los `--` y cambia `TU_EMAIL` por el email con el que entras en Orbit).
   El resultado es un token largo. **Solo se muestra esta vez**: cópialo para el paso 3.
   No lo pegues en ningún chat que no sea el de Instinct.
3. **Vercel → Settings → Environment Variables**: comprueba que existen `SUPABASE_URL` y
   `SUPABASE_SERVICE_ROLE` (ya se usan para los gastos rápidos). Sube `api/instinct.js` e `instinct.html`.
4. **Prueba**: abre `https://TU-APP.vercel.app/instinct.html#t=TU_TOKEN`. Debe aparecer tu mes.

Revocar el token en cualquier momento:
`update public.instinct_tokens set revoked = true where label = 'Instinct';`

## 2. Qué decirle a Instinct
Envíale este mensaje (cambia la dirección; la llave ya la tiene):

---
Orbit es mi app de finanzas. API: https://TU-APP.vercel.app/api/instinct
Cabecera siempre: "Authorization: Bearer <mi llave>". Nunca pongas la llave en una URL.
Cada petición es un JSON con "action" y un "request_id" único por cada cosa que te pida. Respóndeme con el
campo "message" tal cual. Si la respuesta trae "needs_confirmation": true, pregúntame y, si digo que sí,
repite la petición con "confirm": true. Nunca inventes importes, fechas ni nombres: si falta algo, pregunta.
Para nombrar un activo usa como "asset" cualquier parte de su nombre (por ejemplo "Inveready").

GASTOS E INGRESOS
- expense {amount, concept, date?, category?} · income {amount, concept}
  Categorías: Alimentació, Restaurants, Transport, Esport, Oci, Compres, Subscripcions, Viatge, Personal, Altres
- edit_expense {concept? amount? date? (para encontrarlo), new_amount? new_category? new_concept? new_date?}
- delete_expense {concept? amount? date?} (pide confirmación)
- set_budget {category, limit} · set_goal {name, target, deadline "AAAA-MM"} · save {goal, amount}
- summary · recent · alerts · undo (deshace lo último que apuntaste, 24 h)

ACTIVOS
- assets: lista todo · add_asset {type: efectivo|bolsa|fondos|pe|inmobiliario|crowdfunding|otros, name, value?, committed? (pe)}
- update_asset {asset, value?, new_name?, notes?} · archive_asset {asset} (pide confirmación)

PRIVATE EQUITY
- pe_call {asset, amount, date?} · pe_distribution {asset, amount, date?} · pe_commitment {asset, amount}
- pe_nav {asset, nav, date?} (valor oficial de mi posición según el informe)
- pe_status {asset?} · pe_delete_movement {asset, kind, amount, date} (pide confirmación)

BOLSA
- buy / sell {ticker, qty, price, currency? ("USD"...), name?, isin?, fees?, date?}. Solo lo apuntas: no compras nada.
- positions · set_price {ticker, price} · edit_position {ticker, qty? entry? price?} · delete_position {ticker}

DOCUMENTOS Y NOTICIAS
- upload_document {filename, content_base64 (o url), doc_type: capital_call|distribution|report_pe|extracto|nomina|factura|contrato|otro, asset?, data?}
  Si te mando un PDF de un capital call: súbelo con upload_document y registra también el importe con pe_call.
- news {asset?}: noticias reales de lo que tengo, con fuente y fecha.

AVISOS: cada día a las 9:00 pide alerts; si dice "Sin novedades", no me escribas.
RESUMEN: el último día de cada mes a las 21:00 pide summary y envíamelo.
---

Si Instinct no puede hacer peticiones HTTP directamente, puede usar la página
`https://TU-APP.vercel.app/instinct.html#t=TU_TOKEN` (solo gastos, límites y objetivos).

## 3. Acciones disponibles (29)
| Área | Acciones |
|---|---|
| Gastos e ingresos | `expense`, `income`, `edit_expense`, `delete_expense`, `undo`, `recent` |
| Límites y objetivos | `set_budget`, `set_goal`, `save` |
| Resumen y avisos | `summary`, `alerts` |
| Activos | `assets`, `add_asset`, `update_asset`, `archive_asset` |
| Private equity | `pe_call`, `pe_distribution`, `pe_commitment`, `pe_nav`, `pe_status`, `pe_delete_movement` |
| Bolsa | `buy`, `sell`, `positions`, `set_price`, `edit_position`, `delete_position` |
| Documentos y noticias | `upload_document`, `news` |

Borrar o archivar siempre devuelve primero `needs_confirmation`. En private equity, un movimiento igual a
otro ya registrado (mismo tipo, importe y fecha) también pide confirmación.

Reglas de cálculo: importes en céntimos enteros (sin errores de redondeo); "este mes" en hora de España;
la categoría se detecta por el concepto si no llega; el ritmo compara lo gastado con los días
transcurridos; los avisos de límite saltan al 80% y al 100%, el de ritmo desde el día 7, el de gasto
alto frente a tu media desde el día 10 (si hay dos meses de historial) y el de objetivos desde el día 20.

## 4. Dónde se guarda cada cosa (lo mismo que ve la app)
| Lo que apunta Instinct | Dónde | Lo ves en la app en |
|---|---|---|
| Gastos e ingresos | `user_expense_data` (el mismo sitio que el Excel) | Gastos |
| Límites | `user_kv` · `wealth_budgets_<usuario>` | Gastos → presupuestos |
| Objetivos y lo apartado | `user_kv` · `wealth_goals_legacy_<usuario>` | Objetivos |
| Compras y ventas | `blocks` (posiciones de la cuenta de bolsa) + historial en `movements` | Cartera |
| Activos | `blocks` | Cartera |
| Capital calls, distribuciones, NAV | `pe_transactions` + `blocks` | Private equity |
| Documentos | almacén `wealth-docs` + `documents` | Documentos |

Si tienes la app abierta mientras Instinct apunta algo, al guardar tú cualquier cambio la app incorpora
primero lo nuevo de la nube: no se pierde nada. Al volver a la app tras unos segundos, se refresca sola.

## 5. Lo que todavía no hace
- Los meses se guardan por nombre sin año (herencia del formato del Excel). Hasta septiembre de 2027 no
  hay solapamiento; antes de esa fecha hay que pasar los gastos a un registro con fecha completa (paso 4).
