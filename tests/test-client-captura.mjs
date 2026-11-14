// Pruebas de la captura de extractos (mergeExpenseMovements) aislada. Datos ficticios.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function grab(name) {
  const i = html.search(new RegExp(`(async )?function ${name}\\(`));
  if (i < 0) throw new Error('No encuentro ' + name);
  let d = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1); }
}
const consts = html.slice(html.indexOf('const EXP_SP ='), html.indexOf('function expMonthNum('));
const code = [consts, ...['expMonthNum', 'expMonthYear', 'expMonthKeyFor', 'expNewMonth', 'localISODate', 'cleanText', '_recalcMonth', 'mergeExpenseMovements'].map(grab)].join('\n');
const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Map, Set, JSON, Object, String, Number, Math, Array, RegExp, crypto,
  pushUndo() {}, saveExpenseData: async () => true, _quickCat: (c) => ({ label: c || 'Altres', icon: '•', color: '#999' }) };
vm.createContext(ctx);
vm.runInContext(code + '\nvar expenseData = {};', ctx);
const results = []; const check = (n, c, d) => results.push({ n, ok: !!c, d });
const y = new Date().getFullYear(), mm = String(new Date().getMonth() + 1).padStart(2, '0');
const hoy = `${y}-${mm}-01`;
const movs = [
  { date: hoy, concept: 'Supermercado Test', amount: 42.3, type: 'gasto', category: 'Alimentació' },
  { date: hoy, concept: 'NOMINA EMPRESA TEST', amount: 2000, type: 'ingreso' },
  { date: hoy, concept: 'Devolución tienda', amount: 15, type: 'ingreso' },
];
let r = await vm.runInContext('mergeExpenseMovements', ctx)(movs, { name: 'Cuenta Test' });
const items = () => vm.runInContext('Object.values(expenseData).flatMap(m => m.items)', ctx);
const nom = items().find(i => /NOMINA/.test(i.concept));
check('La nómina de una captura se guarda como ingreso (antes: gasto)', nom && nom.isIncome === true && nom.category === 'Nómina', JSON.stringify(nom && { isIncome: nom.isIncome, category: nom.category }));
check('Una devolución se guarda como ingreso', items().find(i => /Devoluci/.test(i.concept)).isIncome === true, '');
const m = vm.runInContext('Object.values(expenseData)[0]', ctx);
check('Totales del mes: 42,30 € de gasto y 2.015 € de ingresos', Math.abs(m.totalExpense - 42.3) < 1e-9 && Math.abs(m.totalIncome - 2015) < 1e-9, `gasto=${m.totalExpense} ingresos=${m.totalIncome}`);
check('Cada fila lleva id, año y created_at', items().every(i => i.id && i.created_at) && m.year === y, '');
r = await vm.runInContext('mergeExpenseMovements', ctx)(movs, { name: 'Cuenta Test' });
check('Subir la misma captura otra vez no duplica', r.added === 0 && r.skipped === 3 && items().length === 3, JSON.stringify(r));
const fut = `${y}-12-31`;
if (fut > vm.runInContext('localISODate()', ctx)) {
  await vm.runInContext('mergeExpenseMovements', ctx)([{ date: fut, concept: 'Cena Test', amount: 30, type: 'gasto', category: 'Restaurants' }], { name: 'Cuenta Test' });
  check('Una fecha futura (sin año en la captura) se toma del año anterior', items().some(i => i.date === `${y - 1}-12-31`), items().map(i => i.date).join(','));
}
for (const x of results) console.log(`${x.ok ? 'PASA ' : 'FALLA'}  ${x.n}${x.d ? '  —  ' + x.d : ''}`);
console.log(`\nCaptura de extractos: ${results.filter(x => x.ok).length}/${results.length} correctas`);
if (results.some(x => !x.ok)) process.exitCode = 1;
