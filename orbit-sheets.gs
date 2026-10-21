/**
 * Orbit ⇄ Hoja de Google
 * Envía a Orbit cada fila nueva de la hoja (gastos, ingresos, compras, ventas, saldos) y escribe el
 * resultado en la misma fila. La llave de Orbit se guarda en las propiedades del script, nunca en la hoja.
 *
 * Instalación: Extensiones → Apps Script → pega este archivo → Guardar → recarga la hoja →
 * menú "Orbit" → "Configurar llave" → "Activar sincronización automática".
 */

const ORBIT_URL = 'https://orbit-it-gamma.vercel.app/api/instinct';
const HOJA = '';            // nombre de la pestaña con los movimientos; vacío = la primera pestaña
const MAX_FILAS_POR_PASADA = 60;

// Nombres de columna admitidos (sin tildes ni mayúsculas)
const COLUMNAS = {
  fecha:    ['fecha', 'date', 'dia'],
  tipo:     ['tipo', 'type', 'operacion', 'movimiento'],
  concepto: ['concepto', 'descripcion', 'comercio', 'detalle', 'concept'],
  importe:  ['importe', 'monto', 'amount', 'total', 'euros', 'importe (€)', 'importe €'],
  categoria:['categoria', 'category'],
  cuenta:   ['cuenta', 'account', 'banco'],
  ticker:   ['ticker', 'simbolo', 'isin'],
  titulos:  ['titulos', 'participaciones', 'acciones', 'qty', 'unidades'],
  precio:   ['precio', 'price', 'precio por titulo'],
  comision: ['comision', 'comisiones', 'fees'],
  cargo:    ['cargo en', 'cuenta de efectivo', 'cash'],
  id:       ['id orbit', 'id'],
  estado:   ['estado orbit', 'estado'],
  mensaje:  ['mensaje orbit', 'mensaje', 'respuesta'],
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Orbit')
    .addItem('Sincronizar ahora', 'sincronizarOrbit')
    .addItem('Configurar llave', 'configurarLlave')
    .addSeparator()
    .addItem('Activar sincronización automática (cada 5 min)', 'activarAutomatico')
    .addItem('Desactivar sincronización automática', 'desactivarAutomatico')
    .addToUi();
}

function configurarLlave() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Llave de Orbit', 'Pega la llave de Orbit. Se guarda en este script, no en la hoja.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const t = r.getResponseText().trim();
  if (t.length < 32) { ui.alert('Esa llave no parece válida.'); return; }
  PropertiesService.getScriptProperties().setProperty('ORBIT_TOKEN', t);
  ui.alert('Llave guardada. Ya puedes sincronizar.');
}

function activarAutomatico() {
  desactivarAutomatico();
  ScriptApp.newTrigger('sincronizarOrbit').timeBased().everyMinutes(5).create();
  SpreadsheetApp.getActive().toast('Sincronización automática activada: cada 5 minutos.', 'Orbit');
}
function desactivarAutomatico() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'sincronizarOrbit').forEach(t => ScriptApp.deleteTrigger(t));
}

// ── utilidades ─────────────────────────────────────────────────────────────
function norm_(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim(); }
function fecha_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, 'Europe/Madrid', 'yyyy-MM-dd');
  return String(v || '').trim();
}
function num_(v) {
  if (v === '' || v === null || v === undefined) return undefined;
  if (typeof v === 'number') return v;
  return String(v).trim();          // Orbit entiende "45,50", "1.250,50" y "45.5"
}
function tipo_(v) {
  const t = norm_(v);
  if (!t) return 'gasto';
  if (/^(gasto|pago|expense|compra tarjeta)/.test(t)) return 'gasto';
  if (/^(ingreso|income|nomina|cobro)/.test(t)) return 'ingreso';
  if (/^(orden de compra|orden compra)/.test(t)) return 'orden_compra';
  if (/^(orden de venta|orden venta)/.test(t)) return 'orden_venta';
  if (/^(compra|buy)/.test(t)) return 'compra';
  if (/^(venta|sell)/.test(t)) return 'venta';
  if (/^(saldo|balance)/.test(t)) return 'saldo';
  if (/^(ajuste|adjust)/.test(t)) return 'ajuste';
  return 'desconocido';
}

// Localiza las columnas por su nombre y crea al final las de control si faltan
function columnas_(sheet) {
  const lastCol = Math.max(1, sheet.getLastColumn());
  const head = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(norm_);
  const idx = {};
  for (const [k, names] of Object.entries(COLUMNAS)) {
    const i = head.findIndex(h => names.includes(h));
    if (i >= 0) idx[k] = i + 1;
  }
  let next = lastCol + 1;
  for (const [k, title] of [['id', 'ID Orbit'], ['estado', 'Estado Orbit'], ['mensaje', 'Mensaje Orbit']]) {
    if (!idx[k]) { sheet.getRange(1, next).setValue(title); idx[k] = next; next++; }
  }
  return idx;
}

function llamar_(method, route, body, token) {
  const url = `${ORBIT_URL}?route=${encodeURIComponent(route)}`;
  const opts = { method, muteHttpExceptions: true, headers: { Authorization: `Bearer ${token}` } };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  let res;
  try { res = UrlFetchApp.fetch(url, opts); }
  catch (e) { return { code: 0, json: { ok: false, message: `Sin conexión con Orbit: ${e.message}` } }; }
  let json = {};
  try { json = JSON.parse(res.getContentText()); } catch (e) { json = { ok: false, message: res.getContentText().slice(0, 200) }; }
  return { code: res.getResponseCode(), json };
}

// Traduce una fila de la hoja en una petición a Orbit
function peticion_(fila, idx, id) {
  const v = (k) => idx[k] ? fila[idx[k] - 1] : '';
  const tipo = tipo_(v('tipo'));
  const comun = { id, date: fecha_(v('fecha')) || undefined, source: 'sheet' };
  const importe = num_(v('importe'));
  const importeAbs = typeof importe === 'number' ? Math.abs(importe) : (importe ? String(importe).replace(/^-/, '') : undefined);
  switch (tipo) {
    case 'gasto':   return { route: 'expenses', body: { ...comun, concept: String(v('concepto') || ''), amount: importeAbs, category: v('categoria') || undefined, account: v('cuenta') || undefined } };
    case 'ingreso': return { route: 'incomes',  body: { ...comun, concept: String(v('concepto') || ''), amount: importeAbs, category: v('categoria') || undefined, account: v('cuenta') || undefined } };
    case 'compra': case 'venta': case 'orden_compra': case 'orden_venta':
      return { route: 'trades', body: { ...comun, side: /compra/.test(tipo) ? 'buy' : 'sell', status: /orden/.test(tipo) ? 'pending' : 'executed',
        ticker: String(v('ticker') || v('concepto') || '').toUpperCase(), qty: num_(v('titulos')), price: num_(v('precio')), amount: importeAbs,
        fees: num_(v('comision')), account: v('cuenta') || undefined, cash_account: v('cargo') || undefined } };
    case 'saldo':   return { route: 'cash-balance', body: { account: v('cuenta'), balance: importe, date: comun.date } };
    case 'ajuste':  return { route: 'cash-balance', body: { account: v('cuenta'), delta: importe, id } };
    default:        return { error: `Tipo "${v('tipo')}" no reconocido. Usa: gasto, ingreso, compra, venta, orden de compra, orden de venta, saldo o ajuste.` };
  }
}

// ── sincronización ─────────────────────────────────────────────────────────
function sincronizarOrbit() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;        // ya hay otra pasada en marcha
  try {
    const token = PropertiesService.getScriptProperties().getProperty('ORBIT_TOKEN');
    const ss = SpreadsheetApp.getActive();
    if (!token) { ss.toast('Falta la llave: menú Orbit → Configurar llave.', 'Orbit'); return; }
    const sheet = HOJA ? ss.getSheetByName(HOJA) : ss.getSheets()[0];
    if (!sheet) { ss.toast(`No encuentro la pestaña "${HOJA}".`, 'Orbit'); return; }
    const idx = columnas_(sheet);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    const datos = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    let hechas = 0, ok = 0, avisos = 0, borradas = 0;
    for (let r = 0; r < datos.length && hechas < MAX_FILAS_POR_PASADA; r++) {
      const fila = datos[r], n = r + 2;
      const estado = norm_(fila[idx.estado - 1]);
      const vacia = ['fecha', 'concepto', 'importe', 'ticker'].every(k => !idx[k] || fila[idx[k] - 1] === '');
      if (vacia) continue;
      const marcar = (est, msg) => { sheet.getRange(n, idx.estado).setValue(est); sheet.getRange(n, idx.mensaje).setValue(String(msg || '').slice(0, 500)); };

      // Borrar: escribe BORRAR en Estado Orbit
      if (estado === 'borrar') {
        const id = String(fila[idx.id - 1] || '');
        if (!id) { marcar('⚠ revisar', 'No hay ID Orbit: esta fila nunca se registró.'); continue; }
        const t = tipo_(idx.tipo ? fila[idx.tipo - 1] : '');
        const route = /compra|venta/.test(t) ? `trades/${id}` : `expenses/${id}`;
        const res = llamar_('delete', route, null, token);
        if (res.code === 401) { ss.toast('La llave de Orbit no es válida. Revísala en Orbit → Configurar llave.', 'Orbit'); return; }
        marcar(res.code === 200 ? 'BORRADO' : (res.code === 400 ? '⚠ revisar' : 'REINTENTAR'), res.json.message);
        if (res.code === 200) borradas++;
        hechas++; continue;
      }
      // Solo filas nuevas o pendientes de reintento
      if (estado && estado !== 'reintentar') continue;

      let id = String(fila[idx.id - 1] || '');
      if (!id) { id = 'sh-' + Utilities.getUuid(); sheet.getRange(n, idx.id).setValue(id); }   // el id se fija ANTES de enviar
      const p = peticion_(fila, idx, id);
      if (p.error) { marcar('⚠ revisar', p.error); avisos++; continue; }
      const res = llamar_('post', p.route, p.body, token);
      hechas++;
      if (res.code === 401) { ss.toast('La llave de Orbit no es válida. Revísala en Orbit → Configurar llave.', 'Orbit'); return; }
      if (res.code === 200) { marcar(res.json.data && res.json.data.duplicate ? '✓ ya estaba' : '✓', res.json.message); ok++; }
      else if (res.code === 400) { marcar('⚠ revisar', res.json.message); avisos++; }
      else marcar('REINTENTAR', res.json.message || `Error ${res.code}: se reintentará en la próxima pasada.`);
    }
    if (hechas || avisos) ss.toast([ok ? `${ok} registrada(s)` : '', borradas ? `${borradas} borrada(s)` : '', avisos ? `${avisos} a revisar` : ''].filter(Boolean).join(' · ') + ' en Orbit.', 'Orbit');
  } finally {
    lock.releaseLock();
  }
}
