// Radar de empresas: reglas, consulta a Finnhub (simulada), tarea diaria e integración con Instinct.
// Datos 100 % ficticios: tickers, nombres e importes inventados.
process.env.SUPABASE_URL = 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE = 'service';
process.env.FINNHUB_KEY = 'fh-test';
process.env.CRON_SECRET = 'cron-test';
import crypto from 'node:crypto';
import { db, mockFetch, failNext } from './mock-supabase.mjs';
import { stockTickers, insiderEvents, recommendationEvents, filingEvents, newsEvents, scanTicker, addDays, madridDay } from '../api/_lib/radar.js';

const results = [];
const check = (n, c, d = '') => results.push({ n, ok: !!c, d });
const today = madridDay();
const ts = (ymd) => Math.floor(Date.parse(ymd + 'T10:00:00Z') / 1000);

// ── 1. Qué acciones vigila ─────────────────────────────────────────────
const blocks = [
  { type: 'bolsa', deleted: false, extra: { positions: [
    { ticker: 'ACME', name: 'Acme Corp', type: 'EQUITY' },
    { ticker: 'GLBX', name: 'Globex Inc' },
    { ticker: 'TSTE', name: 'iShares Test UCITS ETF', type: 'ETF' },
    { ticker: 'BTC', name: 'Bitcoin' },
    { ticker: 'ROBO', name: 'Cartera robo', isRoboAdvisor: true },
    { ticker: 'XYZ.DE', name: 'Empresa alemana' } ] } },
  { type: 'bolsa', deleted: true, extra: { positions: [{ ticker: 'OLDX', name: 'Borrada' }] } },
  { type: 'cash', extra: {} },
];
check('1. Solo vigila acciones de EE. UU. vivas (no ETF, cripto, robo ni borradas)', JSON.stringify(stockTickers(blocks)) === '["ACME","GLBX"]', JSON.stringify(stockTickers(blocks)));

// ── 2. Directivos ──────────────────────────────────────────────────────
const since = addDays(today, -14);
const ins = insiderEvents('ACME', [
  { name: 'Ana Ficticia', change: -10000, transactionPrice: 150, transactionCode: 'S', transactionDate: today },   // 1,5 M USD
  { name: 'Ana Ficticia', change: -1000, transactionPrice: 150, transactionCode: 'S', transactionDate: today },    // 150.000 USD
  { name: 'Luis Inventado', change: 500, transactionPrice: 120, transactionCode: 'P', transactionDate: today },    // 60.000 USD
  { name: 'Luis Inventado', change: 9000, transactionPrice: 120, transactionCode: 'M', transactionDate: today },   // ejercicio de opciones
  { name: 'Viejo', change: -50000, transactionPrice: 150, transactionCode: 'S', transactionDate: addDays(today, -30) },
], since);
check('2a. Venta de 1,5 M USD → aviso; venta de 150.000 USD → no', ins.filter(e => e.text.includes('vendido')).length === 1, ins.map(e => e.text).join(' | '));
check('2b. Compra de 60.000 USD → aviso de nivel medio', ins.some(e => e.text.includes('comprado') && e.level === 'media'));
check('2c. Ejercicios de opciones y operaciones de hace 30 días se ignoran', ins.length === 2, `avisos=${ins.length}`);
check('2d. El aviso cita la fuente', ins.every(e => /formulario 4/.test(e.text)));

// ── 3. Analistas ───────────────────────────────────────────────────────
const recUp = recommendationEvents('ACME', [
  { period: '2026-10-01', strongBuy: 5, buy: 15, hold: 8, sell: 2, strongSell: 0 },   // compra 66,7 %
  { period: '2026-11-01', strongBuy: 8, buy: 18, hold: 4, sell: 0, strongSell: 0 },   // compra 86,7 %
]);
check('3a. Compra del 67 % al 87 % → aviso de mejora', recUp.length === 1 && recUp[0].text.includes('mejoran') && recUp[0].text.includes('87 %'), recUp[0] && recUp[0].text);
const recFlat = recommendationEvents('ACME', [
  { period: '2026-11-01', strongBuy: 5, buy: 15, hold: 8, sell: 2, strongSell: 0 },
  { period: '2026-10-01', strongBuy: 5, buy: 14, hold: 9, sell: 2, strongSell: 0 },
]);
check('3b. Cambio pequeño → sin aviso', recFlat.length === 0);
const recSell = recommendationEvents('ACME', [
  { period: '2026-11-01', strongBuy: 5, buy: 14, hold: 6, sell: 4, strongSell: 1 },
  { period: '2026-10-01', strongBuy: 5, buy: 15, hold: 8, sell: 2, strongSell: 0 },
]);
check('3c. Tres recomendaciones de venta más → aviso de empeora', recSell.length === 1 && recSell[0].text.includes('empeoran'), recSell[0] && recSell[0].text);

// ── 4. Hechos relevantes y noticias ────────────────────────────────────
const fil = filingEvents('ACME', [
  { form: '8-K', filedDate: today + ' 16:05:00', accessNumber: 'A-1', reportUrl: 'https://sec.example/a1' },
  { form: '10-Q', filedDate: today, accessNumber: 'A-2' },
], since);
check('4a. 8-K → aviso con enlace; 10-Q → no', fil.length === 1 && fil[0].url === 'https://sec.example/a1');
const nw = newsEvents('ACME', [
  { id: 1, headline: 'Acme CEO steps down after board review', datetime: ts(today), source: 'Diario Test', url: 'https://n/1' },
  { id: 2, headline: 'Acme stock rises 2% in quiet trading', datetime: ts(today) },
  { id: 3, headline: 'Acme CEO steps down after board review', datetime: ts(today) },
  { id: 4, headline: 'Acme faces antitrust probe', datetime: ts(today) },
  { id: 5, headline: 'Acme announces buyback', datetime: ts(today) },
  { id: 6, headline: 'Acme lawsuit filed by investors', datetime: ts(today) },
], addDays(today, -3));
check('4b. Noticias: solo materiales, sin duplicados, máximo 3', nw.length === 3 && !nw.some(e => e.text.includes('rises')), nw.map(e => e.text).join(' | '));

// ── 5. Consulta a Finnhub: una fuente caída no tumba las demás ─────────
const fhMock = (fail) => async (url, opts) => {
  const u = new URL(url);
  const j = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  if (fail && u.pathname.includes(fail)) return j({ error: 'no access' }, 403);
  if (u.pathname.endsWith('/stock/insider-transactions')) return j({ data: [{ name: 'Ana Ficticia', change: -20000, transactionPrice: 100, transactionCode: 'S', transactionDate: today }] });
  if (u.pathname.endsWith('/stock/recommendation')) return j([]);
  if (u.pathname.endsWith('/stock/filings')) return j([{ form: '8-K', filedDate: today, accessNumber: 'F-9', reportUrl: 'https://sec.example/f9' }]);
  if (u.pathname.endsWith('/company-news')) return j([{ id: 9, headline: 'Globex names new CFO', datetime: ts(today), url: 'https://n/9' }]);
  return mockFetch(url, opts);
};
const sc = await scanTicker('GLBX', { key: 'k', today, fetchImpl: fhMock('/stock/insider-transactions') });
check('5a. Si "directivos" da 403, se anota el error y llegan el 8-K y la noticia', sc.errors.length === 1 && /403/.test(sc.errors[0]) && sc.events.length === 2, JSON.stringify(sc));

// ── 6. Tarea diaria: autorización y guardado por usuario ───────────────
globalThis.fetch = fhMock(null);
for (const k of Object.keys(db)) db[k] = [];
db.blocks.push({ id: 'b1', user_id: 'u1', type: 'bolsa', deleted: false, extra: { positions: [{ ticker: 'GLBX', name: 'Globex Inc' }] } });
db.blocks.push({ id: 'b2', user_id: 'u2', type: 'bolsa', deleted: false, extra: { positions: [{ ticker: 'TSTE', name: 'iShares Test ETF', type: 'ETF' }] } });
const cron = (await import('../api/radar.js')).default;
const run = async (auth) => { let o = {}; const res = { status(c) { o.status = c; return this; }, json(b) { o.body = b; return this; } };
  await cron({ headers: auth ? { authorization: auth } : {} }, res); return o; };
let r = await run(null);
check('6a. Sin CRON_SECRET → 401', r.status === 401);
r = await run('Bearer cron-test');
const u1 = (db.radar_events || []).filter(e => e.user_id === 'u1');
check('6b. Guarda los avisos del usuario con acciones (3: directivo, 8-K, noticia)', r.status === 200 && u1.length === 3, JSON.stringify(r.body));
check('6c. El usuario que solo tiene ETF no recibe avisos', !(db.radar_events || []).some(e => e.user_id === 'u2'));
await run('Bearer cron-test');
check('6d. Ejecutarla dos veces no duplica', (db.radar_events || []).filter(e => e.user_id === 'u1').length === 3);

// ── 7. Instinct: los avisos salen en /alerts una sola vez ──────────────
const inst = (await import('../api/instinct.js')).default;
const TOKEN = 'x'.repeat(40), sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
db.instinct_tokens = [{ id: 't1', user_id: 'u1', token_hash: sha(TOKEN), revoked: false }];
const call = async (route, query = {}) => { let o = {}; const res = { setHeader() {}, status(c) { o.status = c; return this; }, json(b) { o.body = b; return this; }, end() { return this; } };
  await inst({ method: 'GET', headers: { authorization: 'Bearer ' + TOKEN }, query: { route, ...query }, body: {} }, res); return o; };
let a = await call('alerts');
check('7a. /alerts incluye los 3 avisos del radar', a.status === 200 && a.body.data.alerts.filter(x => x.key.startsWith('radar:')).length === 3, a.body && a.body.message);
a = await call('alerts');
check('7b. La segunda consulta no los repite', a.body.data.alerts.filter(x => x.key.startsWith('radar:')).length === 0, a.body.message);
a = await call('radar');
check('7c. /radar lista lo de los últimos 14 días', a.status === 200 && a.body.data.events.length === 3);
db.radar_events = [];
a = await call('radar', { refresh: '1' });
check('7d. /radar?refresh=1 consulta y guarda en el momento', a.status === 200 && a.body.data.scanned.found === 3 && db.radar_events.length === 3, JSON.stringify(a.body.data.scanned));
failNext.table = 'radar_events'; failNext.method = 'GET';
a = await call('alerts', { all: '1' });
check('7e. Si el radar falla, /alerts sigue funcionando y lo avisa', a.status === 200 && a.body.data.alerts.some(x => x.key.startsWith('radar:error:')), a.body && a.body.message);

for (const x of results) console.log(`${x.ok ? 'PASA ' : 'FALLA'}  ${x.n}${x.d ? '  —  ' + x.d : ''}`);
console.log(`\nRadar de empresas: ${results.filter(x => x.ok).length}/${results.length} correctas`);
if (results.some(x => !x.ok)) process.exitCode = 1;
