// Precios desde el servidor: resolución por ISIN, moneda, peniques, respaldo de Twelve Data y aplicación a la posición.
// Respuestas de Yahoo y Twelve Data simuladas; ISIN, tickers e importes ficticios.
process.env.SUPABASE_URL = 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE = 'service';
import { pickSymbol, normalizeCcy, resolveYahoo, yahooQuote, quotePositions, applyQuote } from '../api/_lib/quotes.js';

const results = [];
const check = (n, c, d = '') => results.push({ n, ok: !!c, d });
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const day = (s) => Math.floor(Date.parse(s + 'T16:30:00Z') / 1000);
const chart = (ccy, closes, exch = 'XETRA') => ({ chart: { result: [{ meta: { currency: ccy, exchangeName: exch },
  timestamp: closes.map((_, i) => day(`2026-01-0${i + 5}`)), indicators: { quote: [{ close: closes }] } }] } });
const SEARCH = { quotes: [
  { symbol: 'TSTA.L', quoteType: 'ETF', exchange: 'LSE' }, { symbol: 'TSTA.MI', quoteType: 'ETF', exchange: 'MIL' },
  { symbol: 'TSTA.DE', quoteType: 'ETF', exchange: 'GER' }, { symbol: 'TSTA', quoteType: 'ETF', exchange: 'PCX' } ] };
let calls = [];
const fake = async (url) => {
  calls.push(String(url));
  const u = new URL(url);
  if (u.pathname.includes('/v1/finance/search')) {
    const q = u.searchParams.get('q');
    return q === 'XX0000000001' ? J(SEARCH) : q === 'XX0000000002' ? J({ quotes: [] }) : J({ quotes: [{ symbol: 'NOPE.DE', quoteType: 'ETF' }] });
  }
  if (u.pathname.includes('/v8/finance/chart/')) {
    const s = decodeURIComponent(u.pathname.split('/').pop());
    if (s === 'TSTA.DE') return J(chart('EUR', [100, 101, null, 102]));
    if (s === 'PENC.L') return J(chart('GBp', [1000, 1050], 'LSE'));
    if (s === 'USX') return J({ chart: { result: null, error: { description: 'Not Found' } } }, 404);
    if (s === 'ACME') return J(chart('USD', [50, 55], 'NasdaqGS'));
    return J({ chart: { result: null, error: { description: 'No data found' } } }, 404);
  }
  if (u.hostname === 'api.twelvedata.com') {
    const s = u.searchParams.get('symbol');
    return s === 'USX' ? J({ close: '20.5', currency: 'USD', datetime: '2026-01-08', percent_change: '1.25', exchange: 'NYSE' }) : J({ status: 'error', message: 'symbol not found' });
  }
  return J({}, 404);
};

// 1. Elige Xetra para una posición en EUR aunque Yahoo devuelva primero Londres
check('1. ETF en EUR: elige la línea de Xetra (.DE)', pickSymbol(SEARCH.quotes, 'EUR') === 'TSTA.DE');
check('2. Posición en USD: elige el símbolo sin sufijo', pickSymbol(SEARCH.quotes, 'USD') === 'TSTA');
check('3. Peniques: 1.050 GBp = 10,50 GBP', JSON.stringify(normalizeCcy(1050, 'GBp')) === JSON.stringify({ price: 10.5, currency: 'GBP' }));

// 4. Resolución por ISIN y símbolo guardado (no vuelve a buscar)
calls = [];
let sym = await resolveYahoo({ ticker: 'TSTA', isin: 'XX0000000001', currency: 'EUR' }, { fetchImpl: fake });
check('4. Resuelve por ISIN a TSTA.DE', sym === 'TSTA.DE' && calls.length === 1, sym);
calls = [];
sym = await resolveYahoo({ ticker: 'TSTA', isin: 'XX0000000001', currency: 'EUR', quote_symbol: 'TSTA.DE' }, { fetchImpl: fake });
check('5. Con el símbolo ya guardado no hace ninguna búsqueda', sym === 'TSTA.DE' && calls.length === 0);

// 6. Cotización: ignora huecos (null), fecha del último dato y variación frente al anterior (102/101 − 1 = +0,99 %)
let q = await yahooQuote('TSTA.DE', { fetchImpl: fake });
check('6. Último precio 102 EUR del 8 ene, +0,99 % frente a 101', q.price === 102 && q.currency === 'EUR' && q.date === '2026-01-08' && q.change_pct === 0.99 && q.source === 'Yahoo Finance', JSON.stringify(q));
q = await yahooQuote('PENC.L', { fetchImpl: fake });
check('7. Londres en peniques: 1.050 GBp → 10,50 GBP, +5 %', q.price === 10.5 && q.currency === 'GBP' && q.change_pct === 5, JSON.stringify(q));

// 8–10. Lote: Yahoo, respaldo de Twelve Data para EE. UU. y error explícito
const out = await quotePositions([
  { ticker: 'TSTA', isin: 'XX0000000001', currency: 'EUR' },
  { ticker: 'USX', currency: 'USD' },
  { ticker: 'ACME', currency: 'USD' },
  { ticker: 'ZZZ', isin: 'XX0000000002', currency: 'EUR' },
], { tdKey: 'td', fetchImpl: fake });
check('8. Yahoo cotiza el ETF europeo y la acción de EE. UU.', out[0].ok && out[0].symbol === 'TSTA.DE' && out[2].ok && out[2].price === 55 && out[2].change_pct === 10, JSON.stringify([out[0], out[2]]));
check('9. Si Yahoo falla en EE. UU., Twelve Data responde (20,50 USD)', out[1].ok && out[1].source === 'Twelve Data' && out[1].price === 20.5, JSON.stringify(out[1]));
check('10. ISIN que no existe: error claro que lo nombra, sin precio inventado', !out[3].ok && /el ISIN XX0000000002 no aparece/.test(out[3].error), JSON.stringify(out[3]));

// 11. Aplicar: 10 participaciones × 102 EUR = 1.020 €; 5 acciones × 55 USD con 1 USD = 0,9 € → 247,50 €
const pe = { ticker: 'TSTA', qty: 10 }, pu = { ticker: 'ACME', qty: 5 };
applyQuote(pe, out[0], { EUR: 1, USD: 0.9 }); applyQuote(pu, out[2], { EUR: 1, USD: 0.9 });
check('11. Valor en euros con el tipo del BCE: 1.020 € y 247,50 €', pe.value === 1020 && pu.value === 247.5 && pu.valueNative === 275 && pu.quote_symbol === 'ACME' && pu.day_change_pct === 10, JSON.stringify([pe, pu]));
// 12. Fallo: conserva el último precio y lo marca como antiguo
const old = { ticker: 'ZZZ', qty: 3, lastPrice: 40, value: 120 };
applyQuote(old, out[3], { EUR: 1 });
check('12. Si falla, conserva 40 / 120 € y lo marca como antiguo con el motivo', old.lastPrice === 40 && old.value === 120 && old.price_stale === true && /ISIN/.test(old.price_error));
// 13. Sin tipo de cambio: no se suma en otra moneda
const nofx = { ticker: 'ACME', qty: 5 };
check('13. Sin tipo del BCE para USD no se calcula el valor', applyQuote(nofx, out[2], { EUR: 1 }) === false && nofx.price_stale === true && nofx.value === undefined);

// 17. Yahoo deja vacío el último cierre en Europa y lo da en meta: se usa el de meta con su fecha, frente al cierre anterior
const metaLast = { chart: { result: [{ meta: { currency: 'EUR', exchangeName: 'GER', regularMarketPrice: 105, regularMarketTime: day('2026-01-08') },
  timestamp: [day('2026-01-06'), day('2026-01-07'), day('2026-01-08')], indicators: { quote: [{ close: [100, 102, null] }] } }] } };
q = await yahooQuote('MLST.DE', { fetchImpl: async () => J(metaLast) });
check('17. Último cierre vacío: usa 105 EUR del 8 ene (meta), +2,94 % frente a 102', q.price === 105 && q.date === '2026-01-08' && q.change_pct === 2.94, JSON.stringify(q));
// 18. Si meta no es más reciente que la última vela, manda la vela
const metaOld = { chart: { result: [{ meta: { currency: 'EUR', regularMarketPrice: 99, regularMarketTime: day('2026-01-06') },
  timestamp: [day('2026-01-06'), day('2026-01-07')], indicators: { quote: [{ close: [100, 102] }] } }] } };
q = await yahooQuote('MOLD.DE', { fetchImpl: async () => J(metaOld) });
check('18. Meta más antiguo que la última vela: manda la vela (102 del 7 ene)', q.price === 102 && q.date === '2026-01-07', JSON.stringify(q));

// 19. El ISIN solo devuelve Londres (en USD) pero la posición es en EUR: prueba TICKER.DE y se queda con Xetra
const onlyLondon = async (url) => {
  const u = new URL(url);
  if (u.pathname.includes('/v1/finance/search')) return J({ quotes: [{ symbol: 'LNDN.L', quoteType: 'ETF', exchange: 'LSE' }] });
  const s = decodeURIComponent(u.pathname.split('/').pop());
  if (s === 'LNDN.DE') return J({ chart: { result: null, error: { description: 'No data found' } } }, 404);
  if (s === 'XTRA.DE') return J(chart('EUR', [50, 51]));
  return J(chart('USD', [60, 61], 'LSE'));
};
sym = await resolveYahoo({ ticker: 'XTRA', isin: 'XX0000000009', currency: 'EUR' }, { fetchImpl: onlyLondon });
check('19. ISIN solo en Londres y posición en EUR: elige XTRA.DE (Xetra, EUR)', sym === 'XTRA.DE', sym);
// 20. Si tampoco existe en ninguna bolsa en EUR, se queda con la del ISIN (el valor en euros sigue siendo correcto)
sym = await resolveYahoo({ ticker: 'LNDN', isin: 'XX0000000009', currency: 'EUR' }, { fetchImpl: async (url) => {
  const u = new URL(url); if (u.pathname.includes('/v1/finance/search')) return J({ quotes: [{ symbol: 'LNDN.L', quoteType: 'ETF' }] });
  return J({ chart: { result: null, error: { description: 'No data found' } } }, 404); } });
check('20. Sin línea en EUR en ninguna bolsa: se queda con la del ISIN (LNDN.L)', sym === 'LNDN.L', sym);

// 14. El endpoint exige sesión
const prices = (await import('../api/prices.js')).default;
let o = {}; const res = { setHeader() {}, status(c) { o.status = c; return this; }, json(b) { o.body = b; return this; } };
await prices({ method: 'POST', headers: {}, body: { positions: [{ ticker: 'ACME' }] } }, res);
check('14. /api/prices sin sesión → 401', o.status === 401, JSON.stringify(o));

// 15–16. Tarea diaria: actualiza la cuenta, convierte con el BCE y respeta una edición simultánea desde la app
const { db, mockFetch } = await import('./mock-supabase.mjs');
const { refreshBolsaBlocks } = await import('../api/_lib/quotes.js');
for (const k of Object.keys(db)) db[k] = [];
db.blocks = [
  { id: 'b1', user_id: 'u1', type: 'bolsa', deleted: false, value: 0, updated_at: '2026-01-01T00:00:00.000Z', extra: { broker: 'Test', positions: [
    { ticker: 'TSTA', isin: 'XX0000000001', currency: 'EUR', qty: 10, value: 900 },
    { ticker: 'ACME', currency: 'USD', qty: 5, value: 200 },
    { ticker: 'ROBO', isRoboAdvisor: true, value: 300 } ] } },
  { id: 'b2', user_id: 'u2', type: 'bolsa', deleted: false, value: 0, updated_at: '2026-01-01T00:00:00.000Z', extra: { positions: [{ ticker: 'ACME', currency: 'USD', qty: 1, value: 40 }] } },
];
const both = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://mock.supabase.co')) {
    // b2 cambia en la app entre la lectura y el guardado: el PATCH con su updated_at antiguo no debe aplicar
    if ((opts && opts.method) === 'PATCH' && u.includes('id=eq.b2')) db.blocks[1].updated_at = '2026-01-02T00:00:00.000Z';
    return mockFetch(url, opts);
  }
  if (u.startsWith('https://api.frankfurter.app')) return J({ date: '2026-01-08', rates: { USD: 1.25 } });   // 1 USD = 0,80 €
  return fake(url);
};
const rep = await refreshBolsaBlocks({ SU: 'https://mock.supabase.co', SR: 'service', tdKey: 'td', fetchImpl: both });
const b1 = db.blocks[0];
check('15. Cuenta actualizada: 10 × 102 € + 5 × 55 USD × 0,80 + robo 300 € = 1.540 €', b1.value === 1540 && b1.extra.positions[0].quote_symbol === 'TSTA.DE' && b1.extra.positions[1].value === 220 && b1.extra.broker === 'Test' && rep.updated === 3, JSON.stringify({ v: b1.value, rep }));
check('16. Si la app cambió la cuenta mientras tanto, no se pisa y se informa', db.blocks[1].extra.positions[0].value === 40 && rep.skipped.length === 1, JSON.stringify(rep));

for (const x of results) console.log(`${x.ok ? 'PASA ' : 'FALLA'}  ${x.n}${x.d && !x.ok ? '  —  ' + x.d.slice(0, 300) : ''}`);
console.log(`\nPrecios desde el servidor: ${results.filter(x => x.ok).length}/${results.length} correctas`);
if (results.some(x => !x.ok)) process.exitCode = 1;
