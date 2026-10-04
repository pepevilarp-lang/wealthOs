# Orbit + Instinct: puesta en marcha

## 1. Preparar Orbit (una vez)
1. **Supabase → SQL Editor**: ejecuta `sql/002_instinct.sql`.
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
Envía esto a Instinct por WhatsApp, cambiando la dirección y el token:

---
Vas a gestionar mis finanzas en Orbit. Dirección: https://TU-APP.vercel.app/api/instinct
Usa siempre la cabecera `Authorization: Bearer TU_TOKEN` y nunca escribas el token en una URL.
Cada petición es JSON con un campo `action`. Añade siempre un `request_id` único por cada cosa que te
pida, para que si reintentas no se duplique. Envíame tal cual el campo `message` de la respuesta.

Cuando te diga...
- un gasto ("45 € cena", "ayer 12 € de café") → `{"action":"expense","amount":45,"concept":"cena","date":"hoy"}`.
  Si sabes la categoría, añade `category` con una de: Supermercado, Restaurantes, Transporte, Ocio,
  Compras, Hogar, Suscripciones, Salud, Viajes, Formación, Regalos, Otros.
- un ingreso ("me han pagado la nómina, 1.950 €") → `{"action":"income","amount":1950,"concept":"Nómina"}`
- un límite ("máximo 300 € al mes en restaurantes") → `{"action":"set_budget","category":"Restaurantes","limit":300}`
- un objetivo ("quiero ahorrar 12.000 € para un piso en septiembre de 2030") →
  `{"action":"set_goal","name":"Piso","target":12000,"deadline":"2030-09"}`
- que aparte dinero ("aparta 200 € para el piso") → `{"action":"save","goal":"Piso","amount":200}`
- una compra o venta de acciones ("he comprado 8,83 VUAA a 132,76 €") →
  `{"action":"buy","ticker":"VUAA","qty":8.83,"price":132.76}` (o `"sell"`). Solo la apuntas: no compras nada.
- "¿cómo voy?" → `GET ?action=summary`
- "últimos movimientos" → `GET ?action=recent`
- "deshaz" o "eso estaba mal" → `{"action":"undo"}` (lo último que apuntaste, hasta 24 horas)

Nunca inventes importes, fechas ni categorías: si falta algo, pregúntamelo.

Avisos: cada día a las 9:00, pide `GET ?action=alerts`. Si la respuesta es "Sin novedades", no me
escribas. Si hay algo, envíame el `message`. Los avisos no se repiten: la app recuerda cuáles ya me has
mandado.
Resumen: el último día de cada mes a las 21:00, pide `GET ?action=summary` y envíamelo.
---

Si Instinct no puede hacer peticiones HTTP directamente, puede usar la página
`https://TU-APP.vercel.app/instinct.html#t=TU_TOKEN`, que tiene los mismos formularios.

## 3. Qué hace cada acción
| Acción | Método | Campos | Respuesta |
|---|---|---|---|
| `expense` | POST | `amount`, `concept?`, `category?`, `date?`, `request_id?` | Gasto, total de la categoría, % del límite y ritmo |
| `income` | POST | `amount`, `concept?`, `date?` | Ingresos y gastos del mes |
| `set_budget` | POST | `category`, `limit` | Límite y lo gastado este mes |
| `set_goal` | POST | `name`, `target`, `deadline?` (AAAA-MM) | Progreso y cuánto apartar al mes |
| `save` | POST | `goal`, `amount` | Progreso y si vas al día este mes |
| `buy` / `sell` | POST | `ticker` o `isin`, `qty`, `price`, `fees?`, `date?` | Operación registrada |
| `summary` | GET/POST | — | Patrimonio, gastos, presupuesto, objetivos |
| `alerts` | GET/POST | `all?` | Avisos nuevos (con `all=1`, todos y sin marcarlos) |
| `recent` | GET/POST | — | Últimos 8 movimientos |
| `undo` | POST | `id?` | Deshace lo último apuntado por Instinct (24 h) |

Reglas de cálculo: importes en céntimos enteros (sin errores de redondeo); "este mes" en hora de España;
la categoría se detecta por el concepto si no llega; el ritmo compara lo gastado con los días
transcurridos; los avisos de límite saltan al 80% y al 100%, el de ritmo desde el día 7, el de gasto
alto frente a tu media desde el día 10 (si hay dos meses de historial) y el de objetivos desde el día 20.

## 4. Lo que todavía no hace
- Las compras y ventas quedan registradas, pero la pantalla de Cartera todavía no las lee: se conectará
  en el paso 2 del plan (`docs/PLAN.md`).
- Los gastos que entran por Instinct van a la tabla nueva; la pestaña Gastos actual muestra los del Excel.
  Se unificarán en el paso 4 del plan.
