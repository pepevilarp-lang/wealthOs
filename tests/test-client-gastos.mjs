// Pruebas de la lógica de gastos de la app (index.html), extraída y ejecutada aislada. Datos ficticios.
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function grab(name) {
  const i = html.indexOf(`function ${name}(`);
  if (i < 0) throw new Error('No encuentro ' + name);
  let depth = 0, j = html.indexOf('{', i);
  for (let k = j; k < html.length; k++) { if (html[k] === '{') depth++; else if (html[k] === '}' && --depth === 0) return html.slice(i, k + 1); }
}
const consts = html.slice(html.indexOf('const EXP_SP ='), html.indexOf('function expMonthNum('));
const code = [consts, ...['expMonthNum', 'expMonthYear', 'expMonthOrder', 'expMonthKeyFor', 'expNewMonth', 'localISODate', '_recalcMonth', '_mergeCloudNewItems'].map(grab)].join('\n');
const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Map, Set, JSON, Object, String, Number, Math, Array, RegExp };
vm.createContext(ctx);
vm.runInContext(code + '\nvar expenseData = {}; var _since = 0; function _expSyncedAt(){ return _since; }', ctx);
const run = (js) => vm.runInContext(js, ctx);
const results = []; const check = (n, c, d) => results.push({ n, ok: !!c, d });

// 1. Mes y año
run(`expenseData = { Noviembre: { name:'Noviembre', num:11, items:[{id:'a', date:'2026-11-03', amount:10}] } }`);
check('Busca noviembre de 2026', run(`expMonthKeyFor(expenseData, 2026, 10)`) === 'Noviembre', run(`expMonthKeyFor(expenseData, 2026, 10)`));
check('Noviembre de 2027 no existe todavía', run(`expMonthKeyFor(expenseData, 2027, 10)`) === null, run(`expMonthKeyFor(expenseData, 2027, 10)`));
check('Se crea como "Noviembre 2027" con su año', run(`(function(){ const k = expNewMonth(expenseData, 2027, 10); return k + '|' + expenseData[k].year; })()`) === 'Noviembre 2027|2027', '');
check('Orden: nov 2026 antes que ene 2027', run(`expMonthOrder({name:'Noviembre', num:11, year:2026}) < expMonthOrder({name:'Enero', num:1, year:2027})`), '');
check('Mes en catalán reconocido', run(`expMonthNum({name:'Març'})`) === 3, run(`expMonthNum({name:'Març'})`));

// 2. Borrado en otro sitio: se quita de la copia local
run(`expenseData = { Octubre: { name:'Octubre', num:10, items:[{id:'x', date:'2026-10-02', amount:5},{id:'y', date:'2026-10-03', amount:7}] } }`);
run(`_mergeCloudNewItems(null, { x: '2026-11-01' })`);
check('Un gasto borrado en Instinct desaparece de la app', run(`expenseData.Octubre.items.map(i=>i.id).join(',')`) === 'y' && run(`expenseData.Octubre.totalExpense`) === 7, run(`JSON.stringify(expenseData.Octubre.items)`));

// 3. Edición en la nube posterior a la última sincronización: se aplica, y cambia de mes si cambió la fecha
run(`_since = Date.parse('2026-11-01T00:00:00Z'); expenseData = { Octubre: { name:'Octubre', num:10, items:[{id:'e', date:'2026-10-20', amount:30, concept:'Libro'}] } }`);
run(`_mergeCloudNewItems({ Noviembre: { name:'Noviembre', num:11, items:[{id:'e', date:'2026-11-02', amount:25, concept:'Libro', updated_at:'2026-11-05T10:00:00Z'}] } }, {})`);
check('La edición hecha en Instinct llega a la app y cambia de mes', run(`(expenseData.Octubre.items.length===0) && expenseData.Noviembre && expenseData.Noviembre.items[0].amount===25`), run(`JSON.stringify(expenseData)`).slice(0, 200));

// 4. Alta nueva en la nube: se añade una sola vez
run(`_since = Date.parse('2026-11-01T00:00:00Z'); expenseData = {}`);
const nube = `{ Noviembre: { name:'Noviembre', num:11, items:[{id:'n', date:'2026-11-04', amount:3, created_at:'2026-11-04T09:00:00Z'}] } }`;
run(`_mergeCloudNewItems(${nube}, {}); _mergeCloudNewItems(${nube}, {})`);
check('Un gasto nuevo de Instinct se añade una sola vez', run(`expenseData.Noviembre.items.length`) === 1, run(`expenseData.Noviembre.items.length`));

// 5. Un gasto local más reciente que la nube NO se pisa con la versión vieja
run(`_since = Date.parse('2026-11-06T00:00:00Z'); expenseData = { Noviembre: { name:'Noviembre', num:11, items:[{id:'l', date:'2026-11-04', amount:99}] } }`);
run(`_mergeCloudNewItems({ Noviembre: { name:'Noviembre', num:11, items:[{id:'l', date:'2026-11-04', amount:50, updated_at:'2026-11-05T00:00:00Z'}] } }, {})`);
check('Una edición local posterior no se pisa con la de la nube anterior', run(`expenseData.Noviembre.items[0].amount`) === 99, run(`expenseData.Noviembre.items[0].amount`));

for (const x of results) console.log(`${x.ok ? 'PASA ' : 'FALLA'}  ${x.n}${x.d ? '  —  ' + x.d : ''}`);
console.log(`\nGastos en la app: ${results.filter(x => x.ok).length}/${results.length} correctas`);
if (results.some(x => !x.ok)) process.exitCode = 1;
