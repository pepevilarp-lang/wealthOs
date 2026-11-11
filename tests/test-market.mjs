// Pruebas del proxy /api/market: la clave nunca sale del servidor y sin sesión no responde.
process.env.SUPABASE_URL = 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE = 'service';
process.env.TWELVEDATA_KEY = 'TDKEY'; process.env.FINNHUB_KEY = 'FHKEY'; process.env.FMP_KEY = 'FMPKEY';
const calls = [];
globalThis.fetch = async (u) => {
  u = String(u);
  if (u.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u1' }), { status: 200 });
  calls.push(u);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
const { default: handler } = await import(new URL('../api/market.js', import.meta.url).href);
const JWT = 'a.b.c';
async function call(query, auth = true) {
  const out = {}; const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; }, send(b) { out.body = b; return this; } };
  await handler({ method: 'GET', headers: auth ? { authorization: 'Bearer ' + JWT } : {}, query }, res);
  return out;
}
// Simula cómo Vercel parsea '/api/market?p=td&u=/quote?symbol=VUAA&apikey=servidor'
const parse = (s) => Object.fromEntries(new URLSearchParams(s.split('?').slice(1).join('?')));
const results = [];
const check = (n, c, d) => results.push({ n, ok: !!c, d });

let r = await call(parse('/api/market?p=td&u=/quote?symbol=VUAA&apikey=servidor'));
check('Twelve Data: clave del servidor y no la del navegador', r.status === 200 && calls.at(-1) === 'https://api.twelvedata.com/quote?symbol=VUAA&apikey=TDKEY', calls.at(-1));
r = await call(parse('/api/market?p=fh&u=/company-news?symbol=MSFT&from=2026-11-01&to=2026-11-11&token=servidor'));
check('Finnhub: conserva parámetros y usa token del servidor', calls.at(-1) === 'https://finnhub.io/api/v1/company-news?symbol=MSFT&from=2026-11-01&to=2026-11-11&token=FHKEY', calls.at(-1));
r = await call(parse('/api/market?p=fmp&u=/quote/VUAA.L?apikey=servidor'));
check('FMP: ruta con símbolo', calls.at(-1) === 'https://financialmodelingprep.com/api/v3/quote/VUAA.L?apikey=FMPKEY', calls.at(-1));
r = await call(parse('/api/market?p=td&u=/time_series?symbol=SPY&interval=1week&start_date=2026-01-01&end_date=2026-11-01&apikey=servidor&format=JSON'));
check('Twelve Data: varios parámetros fuera de u', /interval=1week/.test(calls.at(-1)) && /format=JSON/.test(calls.at(-1)) && /apikey=TDKEY/.test(calls.at(-1)), calls.at(-1));
r = await call(parse('/api/market?p=td&u=/quote?symbol=VUAA'), false);
check('Sin sesión → 401', r.status === 401, r.status);
const before = calls.length;
r = await call(parse('/api/market?p=fh&u=/admin/keys'));
check('Ruta no permitida → 400 y no llama al proveedor', r.status === 400 && calls.length === before, r.status);
r = await call({ p: 'x', u: '/quote' });
check('Proveedor desconocido → 400', r.status === 400, r.status);

for (const x of results) console.log(`${x.ok ? 'PASA ' : 'FALLA'}  ${x.n}  —  ${x.d}`);
console.log(`\n/api/market: ${results.filter(x => x.ok).length}/${results.length} correctas`);
if (results.some(x => !x.ok)) process.exitCode = 1;
