// Pruebas de divisas y moneda de cotización de la app (index.html), aisladas. Tipos de cambio ficticios.
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function grab(name) {
  const i = html.search(new RegExp(`(async )?function ${name}\\(`));
  if (i < 0) throw new Error('No encuentro ' + name);
  let depth = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) { if (html[k] === '{') depth++; else if (html[k] === '}' && --depth === 0) return html.slice(i, k + 1); }
}
let store = {};
const ctx = { console: { log() {}, warn() {}, error() {} }, Date, JSON, Math, Number, String, Object, Error, AbortSignal,
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
  toast: () => {}, window: {}, fetch: async () => { throw new Error('sin red'); } };
vm.createContext(ctx);
vm.runInContext(`const FX_CACHE_KEY='wealthos_fx_rates'; const FX_TTL=6*3600000; let _fxCache=null;\n` +
  ['ccyFromSymbol', 'getFxRates', '_fxNorm', 'convertFx', 'convertFxSync'].map(grab).join('\n') + `\nfunction _reset(){ _fxCache = null; }`, ctx);
const results = []; const check = (n, c, d) => results.push({ n, ok: !!c, d });
const near = (a, b) => Math.abs(a - b) < 1e-9;

// Monedas por bolsa
check('MSFT → USD', ctx.ccyFromSymbol('MSFT') === 'USD', ctx.ccyFromSymbol('MSFT'));
check('SXR8.DE → EUR', ctx.ccyFromSymbol('SXR8.DE') === 'EUR', ctx.ccyFromSymbol('SXR8.DE'));
check('VUAA.L → desconocida (USD, GBP o GBX según el valor)', ctx.ccyFromSymbol('VUAA.L') === null, ctx.ccyFromSymbol('VUAA.L'));

// Sin red y sin caché: error, nunca tipos inventados
let err = null; try { await ctx.getFxRates(); } catch (e) { err = e.message; }
check('Sin BCE ni caché: error explícito (antes: USD 1,08 inventado)', /Sin tipos de cambio/.test(err || ''), err);

// Sin red pero con caché antigua: se usa con su fecha
store.wealthos_fx_rates = JSON.stringify({ ts: 0, date: '2026-11-06', rates: { EUR: 1, USD: 1.10, GBP: 0.85 } });
vm.runInContext('_reset()', ctx);
const r = await ctx.getFxRates();
check('Sin BCE: usa el último tipo guardado', r.USD === 1.10, JSON.stringify(r));

// Conversiones (1 EUR = 1,10 USD = 0,85 GBP)
check('110 USD = 100 EUR', near(await ctx.convertFx(110, 'USD', 'EUR'), 100), await ctx.convertFx(110, 'USD', 'EUR'));
check('8.500 GBX (peniques) = 85 GBP = 100 EUR', near(await ctx.convertFx(8500, 'GBX', 'EUR'), 100), await ctx.convertFx(8500, 'GBX', 'EUR'));
check('GBp (minúscula) también son peniques', near(await ctx.convertFx(8500, 'GBp', 'EUR'), 100), '');
err = null; try { await ctx.convertFx(100, 'XYZ', 'EUR'); } catch (e) { err = e.message; }
check('Moneda sin tipo: error (antes devolvía el importe sin convertir)', /sin tipo de cambio/i.test(err || ''), err);
vm.runInContext('_reset()', ctx);
check('Conversión síncrona al arrancar usa la caché guardada', near(ctx.convertFxSync(110, 'USD', 'EUR'), 100), ctx.convertFxSync(110, 'USD', 'EUR'));

for (const x of results) console.log(`${x.ok ? 'PASA ' : 'FALLA'}  ${x.n}  —  ${x.d}`);
console.log(`\nDivisas en la app: ${results.filter(x => x.ok).length}/${results.length} correctas`);
if (results.some(x => !x.ok)) process.exitCode = 1;
