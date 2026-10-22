# Orbit · API para el asistente (v2.2)

**Base:** `https://orbit-it-gamma.vercel.app/api/instinct`

> **Importante:** en este despliegue la ruta va siempre como parámetro: `…/api/instinct?route=<ruta>`
> (por ejemplo `?route=news/today` o `?route=expenses`). La forma con barras (`…/api/instinct/news/today`) da 404.

## Autenticación
Todas las peticiones llevan la cabecera:

```
Authorization: Bearer <token>
```

El token nunca va en la URL. Sin cabecera o con un token revocado: `401`.

Desde la app, el formulario "Movimiento" usa esta misma API con la sesión del usuario (`Authorization: Bearer
<access_token de Supabase>`). El servidor la valida contra Supabase Auth.

## Vías de entrada (todas pasan por las mismas reglas)
| Vía | Cómo se autentica | Origen guardado |
|---|---|---|
| Instinct por API | llave en la cabecera | `instinct` |
| Hoja de Google (`docs/orbit-sheets.gs`) | llave guardada en el script, `source: "sheet"` | `sheet` |
| Formulario de la app | sesión de Supabase | `app` |

## Respuestas
Siempre JSON: `{ "ok": true|false, "message": "texto para el usuario", "data": { ... } }`.
Códigos: `200` correcto · `400` datos inválidos (el `message` dice qué falta) · `401` token · `404` ruta · `409` se estaban guardando otros movimientos a la vez: reenviar con el mismo `id` · `500` error del servidor (consultar `GET /month` antes de repetir).

## Idempotencia
Toda escritura lleva un **`id` único** generado por el asistente (por ejemplo un UUID). Repetir la misma
petición con el mismo `id` no vuelve a apuntar ni a mover dinero: responde `"duplicate": true`.

## Regla del efectivo
- `POST /cash-balance` con `balance` fija el saldo real de una cuenta a una fecha (por defecto hoy).
- Un gasto o ingreso **de esa fecha o posterior** mueve el saldo **una sola vez**.
- Uno **anterior** a esa fecha se registra, pero no mueve el saldo: ya está incluido en él.
- Borrar un movimiento por `id` revierte exactamente lo que movió.

## Primer paso: autodiagnóstico
- `GET /selftest`: comprueba cada tabla, hace una escritura real de prueba (y la borra) y lista tus cuentas.
- `POST /selftest` con cualquier cuerpo JSON: confirma que **tu entorno** puede enviar escrituras. No escribe nada.
  Si falla, usa la vía GET con `?_method=POST` (ver más abajo) y repite: `GET /selftest?_method=POST&x=1`.

## Rutas

### `GET /month?month=AAAA-MM`
Gastos, ingresos, operaciones, órdenes pendientes y saldos del mes (por defecto el actual), cada uno con su `id`.

### `POST /expenses` · `POST /incomes`
```json
{ "id": "uuid", "date": "2026-10-20", "concept": "Cena", "amount": 45.50,
  "category": "Restaurants", "account": "Cash Openbank", "affect_cash": true }
```
- `amount` en euros, positivo. `date`: `AAAA-MM-DD`, `DD/MM/AAAA`, `hoy` o `ayer`. No se admiten fechas futuras.
- `category` (gastos): Alimentació, Restaurants, Transport, Esport, Oci, Compres, Subscripcions, Viatge, Personal, Altres.
  Si falta, se deduce del concepto.
- `account`: cuenta de efectivo (basta parte del nombre). Si solo hay una, es opcional.
- `affect_cash: false` registra el movimiento sin tocar ningún saldo.

### `DELETE /expenses/{id}` · `DELETE /incomes/{id}`
Borra ese movimiento concreto y revierte su efecto en el saldo. No existe un "deshacer" global.

### `POST /cash-balance`
Fijar el saldo exacto:
```json
{ "account": "Cash Openbank", "balance": 2800, "date": "2026-10-20" }
```
Ajustar sumando o restando (requiere `id`):
```json
{ "account": "Cash Openbank", "delta": -12.40, "id": "uuid" }
```

### `POST /trades`
```json
{ "id": "uuid", "side": "buy", "ticker": "VUAA", "qty": 8.8311, "price": 132.76,
  "amount": 1173.42, "fees": 1, "currency": "EUR", "date": "2026-10-20",
  "account": "Revolut", "cash_account": "Cash Openbank", "status": "executed",
  "name": "Vanguard S&P 500", "kind": "ETF" }
```
- `side`: `buy` o `sell`.
- Bastan **dos de tres**: `qty`, `price`, `amount`. Se calcula el tercero. Si llegan los tres y no cuadran
  (tolerancia 0,5 %), responde `400`.
- `amount` = total cargado en una compra (comisión incluida) o total recibido en una venta (comisión descontada).
- `cash_account` (opcional): mueve ese efectivo una sola vez.
- `status: "pending"` registra una **orden pendiente**: no toca la cartera ni el efectivo. Basta `amount` o `qty`.

### `POST /trades/{id}/fill`
Ejecuta una orden pendiente con los datos reales: `{ "price": 57.95 }` (o `qty`, o `amount`; `fees`, `date` opcionales).

### `DELETE /trades/{id}`
Cancela una orden pendiente, o deshace una operación ejecutada (posición, coste medio y efectivo exactos).
Solo se puede deshacer la última operación de cada ticker.

### `GET /news/today`
Las noticias que más afectan hoy a la cartera: **la misma selección y el mismo orden** que "Qué está pasando hoy" en
Orbit (por número de posiciones afectadas). Devuelve un `message` listo para WhatsApp con el título, a qué posición
afecta y su peso, por qué importa, qué vigilar y el enlace. `?limit=5` para más de tres; `?refresh=1` para regenerarla.
Si la app aún no la ha preparado hoy, el servidor la genera con el mismo método (requiere `FINNHUB_KEY` en Vercel) y
la guarda para que la app muestre exactamente la misma.

### Lectura
`GET /assets` · `GET /positions` · `GET /summary` · `GET /alerts`

## Si el entorno solo permite GET
Cada escritura admite la misma ruta por GET con `_method`, el token en la cabecera y los datos en la URL:

```
GET /api/instinct?route=expenses&_method=POST&id=uuid&date=2026-10-20&concept=Café&amount=2.30&account=Openbank
GET /api/instinct?route=expenses/{id}&_method=DELETE
```

## Por qué `?route=`
La forma con barras depende de una regla de reescritura de `vercel.json` que en este despliegue no se aplica (404).
`?route=` llega directamente a la función y funciona siempre. Las rutas siguen llamándose igual: en todo este
documento, `GET /month` significa `GET /api/instinct?route=month`.

## Ejemplo
```bash
curl -X POST "https://orbit-it-gamma.vercel.app/api/instinct?route=expenses" \
  -H "Authorization: Bearer $ORBIT_TOKEN" -H "Content-Type: application/json" \
  -d '{"id":"7f3c…","date":"2026-10-20","concept":"Cena","amount":45.5,"category":"Restaurants","account":"Openbank"}'
```

## Interfaz anterior por acciones
Sigue disponible `POST /api/instinct` con `{ "action": ... }` (`expense`, `income`, `trade`, `set_balance`,
`delete_item`, `fill_order`, `delete_trade`, `month`, `pe_call`, `add_asset`…). `undo` y `delete_expense`
se han eliminado: borrar siempre por `id`.
