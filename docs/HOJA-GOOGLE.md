# Conectar la hoja de Google con Orbit

La hoja envía sola a Orbit cada fila nueva y escribe en la misma fila el resultado. La llave de Orbit se
guarda dentro del script, en tu cuenta de Google: nunca en una celda ni en una URL.

## Instalación (una vez, unos 5 minutos)
1. Abre la hoja donde Instinct apunta los movimientos.
2. Menú **Extensiones → Apps Script**. Se abre un editor.
3. Borra lo que haya, pega el contenido de `docs/orbit-sheets.gs` y pulsa **Guardar** (icono del disquete).
4. Si los movimientos no están en la primera pestaña, escribe su nombre en `const HOJA = '';` (por ejemplo `'Gastos'`) y guarda.
5. Vuelve a la hoja y **recárgala**. Aparece un menú nuevo, **Orbit**.
6. **Orbit → Configurar llave**: pega la llave de Instinct. La primera vez Google pide permisos; acéptalos
   (el script solo lee y escribe en esta hoja y habla con Orbit).
7. **Orbit → Sincronizar ahora** para probar. Después, **Orbit → Activar sincronización automática**: a partir de
   ahí se revisa sola cada 5 minutos.

## Columnas
El script reconoce las columnas por su nombre (con o sin tildes). No hace falta que estén todas ni en orden:

| Columna | Para qué | Ejemplo |
|---|---|---|
| Fecha | Día del movimiento | 20/10/2026 |
| Tipo | gasto, ingreso, compra, venta, orden de compra, orden de venta, saldo o ajuste. Vacío = gasto | Gasto |
| Concepto | Descripción | Cena con amigos |
| Importe | Euros, en positivo. En compras y ventas, el total (opcional) | 45,50 |
| Categoría | Alimentació, Restaurants, Transport, Esport, Oci, Compres, Subscripcions, Viatge, Personal, Altres | Restaurants |
| Cuenta | Cuenta de efectivo (o de bolsa en compras y ventas) | Openbank |
| Ticker, Títulos, Precio, Comisión | Solo compras y ventas. Bastan dos de títulos, precio e importe | VUAA · 2 · 132,76 |
| Cargo en | Cuenta de efectivo de la que sale el dinero de una compra (opcional) | Openbank |

El script añade al final tres columnas propias. **No las borres:**
- **ID Orbit**: identificador de la fila. Garantiza que nada se registre dos veces.
- **Estado Orbit**: `✓` registrado · `✓ ya estaba` · `⚠ revisar` (hay que corregir algo) · `REINTENTAR` (fallo pasajero, se reintenta solo) · `BORRADO`.
- **Mensaje Orbit**: la respuesta de Orbit, con el saldo resultante o lo que falta.

## Día a día
- **Apuntar**: escribe la fila. En 5 minutos aparece `✓` y el mensaje.
- **Corregir una fila con ⚠ revisar**: arregla el dato y **vacía su Estado Orbit**. Se reenvía con el mismo ID.
- **Borrar algo ya registrado**: escribe `BORRAR` en su Estado Orbit. Orbit lo elimina y devuelve el saldo.
- Una fila con `✓` no se vuelve a enviar aunque la edites: para cambiarla, bórrala con `BORRAR` y escríbela de nuevo.

## Qué decirle a Instinct
"Apunta cada movimiento como una fila nueva en la hoja, con Fecha, Tipo, Concepto, Importe, Categoría y Cuenta
(en compras y ventas: Ticker, Títulos y Precio). No toques las columnas ID Orbit, Estado Orbit ni Mensaje Orbit,
salvo para escribir BORRAR cuando te pida borrar algo. Revisa el Estado Orbit: si pone ⚠ revisar, lee el mensaje,
corrige la fila y vacía el estado."
