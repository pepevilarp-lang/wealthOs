// Extracción de documentos de PE a ciegas + comparación en código (docBlockChecks). Datos ficticios.
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function grab(name) {
  const i = html.search(new RegExp(`(async )?function ${name}\\(`));
  let d = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1); }
}
const ctx = {}; vm.createContext(ctx); vm.runInContext(grab('docBlockChecks'), ctx);
const chk = (a, b) => vm.runInContext('docBlockChecks', ctx)(a, b);
const results = []; const check = (n, c, d = '') => results.push({ n, ok: !!c, d });
const blk = { name: 'Fondo Test', currency: 'EUR', extra: { committed: 10000, called: 4000 } };

let w = chk({ doc_class: 'capital_call', amounts: { main: { value: 7000, currency: 'EUR' } } }, blk);
check('Llamada de 7.000 con 6.000 pendientes (10.000 − 4.000) → aviso alto', w.length === 1 && w[0].severity === 'high' && /6\.000/.test(w[0].message), w.map(x => x.message).join(' | '));
w = chk({ doc_class: 'capital_call', amounts: { main: { value: '1.500,00', currency: 'EUR' } } }, blk);
check('Llamada de "1.500,00" con 6.000 pendientes → sin avisos', w.length === 0, JSON.stringify(w));
w = chk({ doc_class: 'capital_call', amounts: { main: { value: '6000.00', currency: 'EUR' } } }, blk);
check('Llamada exacta de "6000.00" (todo lo pendiente) → sin avisos', w.length === 0, JSON.stringify(w));
w = chk({ doc_class: 'capital_call', amounts: { main: { value: 1000, currency: 'USD' } } }, blk);
check('Importe en USD sobre activo en EUR → aviso de divisa, sin comparar cifras', w.length === 1 && /USD/.test(w[0].message), w.map(x => x.message).join(' | '));
w = chk({ doc_class: 'distribution', amounts: { main: { value: 50000, currency: 'EUR' } } }, blk);
check('Distribución de 50.000 con 4.000 desembolsados → aviso (¿es del fondo entero?)', w.length === 1, w.map(x => x.message).join(' | '));
w = chk({ doc_class: 'quarterly_report', amounts: { main: null }, fund_metrics: { commitment: 2000000 } }, blk);
check('Informe con compromiso del fondo de 2.000.000 → sin avisos', w.length === 0, JSON.stringify(w));
w = chk({ doc_class: 'quarterly_report', fund_metrics: { commitment: 5000 } }, blk);
check('Compromiso "del fondo" de 5.000 < tu compromiso de 10.000 → aviso', w.length === 1, w.map(x => x.message).join(' | '));
check('Sin activo vinculado → sin avisos', chk({ doc_class: 'capital_call', amounts: { main: { value: 1 } } }, null).length === 0);

// A ciegas: el texto que se envía al modelo no incluye cifras del registro
const fn = grab('deepAnalyzeDocument');
const ctxBlock = fn.slice(fn.indexOf('let blockContext'), fn.indexOf('const prompt'));
check('El contexto del modelo no incluye valor, comprometido ni desembolsado',
  !/eur_value|committed|called|Valor actual|Pendiente/.test(ctxBlock), '');
const up = html.slice(html.indexOf("const prompt = `${prompts[docType]||prompts.otro}"), html.indexOf('=== DOCUMENTO ==='));
check('El aviso de subida de documentos no incluye el valor actual', !/valor actual|eur_value/.test(up), '');

for (const x of results) console.log(`${x.ok ? 'PASA ' : 'FALLA'}  ${x.n}${x.d ? '  —  ' + x.d : ''}`);
console.log(`\nDocumentos de PE: ${results.filter(x => x.ok).length}/${results.length} correctas`);
if (results.some(x => !x.ok)) process.exitCode = 1;
