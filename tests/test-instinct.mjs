// Pruebas de auditoría de api/instinct.js contra Supabase simulado. Datos 100 % ficticios.
process.env.SUPABASE_URL = 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE = 'service';
import crypto from 'node:crypto';
import { db, mockFetch, failNext } from './mock-supabase.mjs';
globalThis.fetch = mockFetch;
const API = process.argv[2] ? new URL(process.argv[2], 'file://' + process.cwd() + '/').href : new URL('../api/instinct.js', import.meta.url).href;
const mod = await import(API);
const handler = mod.default;

const TOKEN = 'x'.repeat(40);
const U = 'user-1';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function reset() {
  for (const k of Object.keys(db)) db[k] = [];
  db.instinct_tokens.push({ id: 't1', user_id: U, token_hash: sha(TOKEN), revoked: false });
}
async function call(method, route, body = {}, query = {}) {
  const req = { method, headers: { authorization: 'Bearer ' + TOKEN }, query: { ...(route ? { route } : {}), ...query }, body };
  let out = { status: 0, body: null };
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; }, end() { return this; } };
  await handler(req, res);
  return out;
}
const results = [];
function check(name, cond, detail) { results.push({ name, ok: !!cond, detail }); }
const cash = () => db.blocks.find(b => b.type === 'cash');
const today = mod.madridToday();
const ym = today.slice(0, 7), lastYear = String(Number(ym.slice(0, 4)) - 1) + ym.slice(4);

// ── 1. Mezcla de años en el resumen del mes ─────────────────────────────
reset();
const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const mName = MONTHS[Number(ym.slice(5, 7)) - 1];
db.user_expense_data.push({ user_id: U, updated_at: '2026-01-01T00:00:00Z', data: { [mName]: { name: mName, items: [
  { id: 'old', concept: 'Gasto del año pasado', amount: 500, isIncome: false, category: 'Compres', date: `${lastYear}-05` } ] } } });
await call('POST', 'expenses', { id: 'e1', amount: 20, concept: 'Café', category: 'Restaurants', affect_cash: false });
let s = await call('GET', 'summary');
check('1. El resumen del mes NO suma gastos del mismo mes del año pasado', s.body.data.spent === 20, `gastado según API: ${s.body.data.spent} € (esperado 20 €)`);
let mo = await call('GET', 'month');
check('1b. GET /month filtra bien por año', mo.body.data.totals.spent === 20, `month.spent=${mo.body.data.totals.spent}`);

// ── 2. Editar el importe de un gasto que ya movió el efectivo ───────────
reset();
db.blocks.push({ id: 'c1', user_id: U, type: 'cash', name: 'Cuenta Test', value: 1000, eur_value: 1000, extra: {}, deleted: false, updated_at: '2026-01-01T00:00:00Z' });
await call('POST', 'expenses', { id: 'e2', amount: 100, concept: 'Cena', category: 'Restaurants' });
check('2a. Gasto descuenta el efectivo una vez', cash().eur_value === 900, `saldo=${cash().eur_value}`);
await call('POST', 'expenses', { id: 'e2', amount: 100, concept: 'Cena', category: 'Restaurants' });
check('2b. Reenviar el mismo id no descuenta dos veces', cash().eur_value === 900, `saldo=${cash().eur_value}`);
await call('POST', '', { action: 'edit_expense', concept: 'Cena', new_amount: 60 });
check('2c. Editar el importe (100→60) corrige el efectivo', cash().eur_value === 940, `saldo tras editar=${cash().eur_value} (esperado 940)`);
await call('DELETE', 'expenses/e2');
check('2d. Borrar tras editar deja el saldo inicial', cash().eur_value === 1000, `saldo tras borrar=${cash().eur_value} (esperado 1000)`);

// ── 3. Cambiar la fecha a otro mes ──────────────────────────────────────
reset();
const prevYm = (() => { let [y, m] = ym.split('-').map(Number); m--; if (!m) { m = 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; })();
await call('POST', 'expenses', { id: 'e3', amount: 30, concept: 'Libro', category: 'Compres', affect_cash: false });
await call('POST', '', { action: 'edit_expense', concept: 'Libro', new_date: `${prevYm}-10` });
mo = await call('GET', 'month', {}, { month: prevYm });
check('3. Un gasto movido al mes anterior aparece en ese mes', mo.body.data.expenses.length === 1, `gastos en ${prevYm}: ${mo.body.data.expenses.length}`);

// ── 4. Fechas imposibles ───────────────────────────────────────────────
reset();
let r = await call('POST', 'expenses', { id: 'e4', amount: 10, date: '31/02/2026', affect_cash: false });
check('4a. Rechaza 31/02/2026', r.status === 400, `status=${r.status} ${r.body.message.slice(0, 80)}`);
r = await call('POST', 'expenses', { id: 'e5', amount: 10, date: '05/13/2026', affect_cash: false });
check('4b. Rechaza mes 13', r.status === 400, `status=${r.status} ${r.body.message.slice(0, 80)}`);

// ── 5. Valor de bolsa con céntimos y divisas ───────────────────────────
reset();
db.blocks.push({ id: 'b1', user_id: U, type: 'bolsa', name: 'Broker Test', value: 0, eur_value: 0, extra: { positions: [] }, deleted: false, updated_at: '2026-01-01T00:00:00Z' });
await call('POST', 'trades', { id: 't1', side: 'buy', ticker: 'AAA', qty: 3, price: 10.45 });
const bk = () => db.blocks.find(b => b.id === 'b1');
check('5a. Valor de la cuenta con céntimos (3 × 10,45 = 31,35)', Math.abs(bk().eur_value - 31.35) < 0.001, `valor=${bk().eur_value}`);
await call('POST', 'trades', { id: 't2', side: 'buy', ticker: 'USX', qty: 10, price: 110, currency: 'USD', fees: 5 });
const usx = bk().extra.positions.find(p => p.ticker === 'USX');
check('5b. Comisión en EUR convertida antes de sumarla al coste en USD', Math.abs(usx.entry - (1100 + 5 * 1.10) / 10) < 0.01, `coste medio=${usx.entry} USD (esperado ${(1100 + 5.5) / 10})`);

// ── 6. Idempotencia de operaciones si falla el historial ────────────────
reset();
db.blocks.push({ id: 'b1', user_id: U, type: 'bolsa', name: 'Broker Test', value: 0, eur_value: 0, extra: { positions: [] }, deleted: false, updated_at: '2026-01-01T00:00:00Z' });
failNext.table = 'movements'; failNext.method = 'POST';
await call('POST', 'trades', { id: 't9', side: 'buy', ticker: 'AAA', qty: 5, price: 10 });
await call('POST', 'trades', { id: 't9', side: 'buy', ticker: 'AAA', qty: 5, price: 10 });
const aaa = bk().extra.positions.find(p => p.ticker === 'AAA');
check('6. Reenviar una compra tras un fallo del historial no la duplica', aaa && aaa.qty === 5, `títulos=${aaa && aaa.qty} (esperado 5)`);

// ── 7. Efectivo + escritura simultánea de la app (sin control de versión) ─
reset();
db.user_expense_data.push({ user_id: U, updated_at: '2026-01-01T00:00:00Z', data: {} });
await call('POST', 'expenses', { id: 'k1', amount: 10, concept: 'A', affect_cash: false });
await call('POST', 'expenses', { id: 'k2', amount: 10, concept: 'Bocadillo', affect_cash: false });
// edit_expense lee, la app escribe en medio, edit_expense guarda sin versión
const origFetch = globalThis.fetch; let injected = false;
globalThis.fetch = async (u, o = {}) => {
  const res = await origFetch(u, o);
  if (!injected && String(u).includes('user_expense_data') && (o.method || 'GET') === 'GET') {
    injected = true;
    const row = db.user_expense_data[0];
    const k = Object.keys(row.data)[0];
    row.data[k].items.push({ id: 'from-app', concept: 'Gasto desde la app', amount: 7, isIncome: false, category: 'Altres', date: today });
    row.updated_at = new Date().toISOString();
  }
  return res;
};
await call('POST', '', { action: 'edit_expense', concept: 'Bocadillo', new_amount: 12 });
globalThis.fetch = origFetch;
const allItems = Object.values(db.user_expense_data[0].data).flatMap(m => m.items);
check('7. Editar desde Instinct no borra un gasto guardado a la vez desde la app', allItems.some(i => i.id === 'from-app'), `items=${allItems.map(i => i.id).join(',')}`);

// ── 8. PE: valor tras call y NAV ────────────────────────────────────────
reset();
db.blocks.push({ id: 'p1', user_id: U, type: 'pe', name: 'Fondo Ficticio I', value: 0, eur_value: 0, currency: 'EUR', extra: { committed: 100000, called: 0, distributed: 0 }, deleted: false });
await call('POST', '', { action: 'pe_call', fund: 'Ficticio', amount: 20000, date: '2026-03-01' });
await call('POST', '', { action: 'pe_nav', fund: 'Ficticio', nav: 21000, date: '2026-06-30' });
await call('POST', '', { action: 'pe_call', fund: 'Ficticio', amount: 10000, date: '2026-07-15' });
const pe = db.blocks.find(b => b.id === 'p1');
check('8. PE: valor = NAV + calls posteriores (21.000 + 10.000)', pe.eur_value === 31000 && pe.extra.called === 30000, `valor=${pe.eur_value} desembolsado=${pe.extra.called}`);

// ── 9. Alta duplicada por request_id en PE ──────────────────────────────
await call('POST', '', { action: 'pe_call', fund: 'Ficticio', amount: 5000, date: '2026-08-01', request_id: 'r-1' });
await call('POST', '', { action: 'pe_call', fund: 'Ficticio', amount: 5000, date: '2026-08-01', request_id: 'r-1' });
check('9. PE: mismo request_id no duplica el call', db.pe_transactions.filter(t => t.amount === 5000).length === 1, `calls de 5.000: ${db.pe_transactions.filter(t => t.amount === 5000).length}`);

// ── 10. Token: sin cabecera → 401 ───────────────────────────────────────
{
  let out = {}; const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; }, end() { return this; } };
  await handler({ method: 'GET', headers: {}, query: { route: 'month' } }, res);
  check('10. Sin token → 401', out.status === 401, `status=${out.status}`);
}

for (const x of results) console.log(`${x.ok ? 'PASA ' : 'FALLA'}  ${x.name}  —  ${x.detail}`);
console.log(`\n${results.filter(x => x.ok).length}/${results.length} correctas`);
if (results.some(x => !x.ok)) process.exitCode = 1;
