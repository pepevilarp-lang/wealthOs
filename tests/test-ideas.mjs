// Seguimiento de propuestas de operación: evaluación con velas diarias, tarea diaria y avisos por Instinct.
// Datos 100 % ficticios (tickers e importes inventados).
process.env.SUPABASE_URL = 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE = 'service';
import crypto from 'node:crypto';
import { db, mockFetch } from './mock-supabase.mjs';
import { evaluateIdea, trackIdeas, scoreboard } from '../api/_lib/ideas.js';

const results = [];
const check = (n, c, d = '') => results.push({ n, ok: !!c, d });
const bar = (date, low, high, close) => ({ date, low, high, close });
const up = { direction: 'alcista', entry_price: 100, target_price: 110, stop_price: 95, entry_date: '2026-01-05', expires_on: '2026-02-27', size_eur: 1000 };

// 1. Alcista: el 3.er día el máximo llega a 111 → objetivo a 110: +10 % → 1.000 × 10 % − 2 € = 98 €
let e = evaluateIdea(up, [bar('2026-01-06', 99, 102, 101), bar('2026-01-07', 100, 104, 103), bar('2026-01-08', 103, 111, 109)], '2026-01-20');
check('1. Alcista toca objetivo: +10 %, 98 € con comisiones', e.status === 'objetivo' && e.result_pct === 10 && e.result_eur === 98 && e.closed_on === '2026-01-08', JSON.stringify(e));

// 2. El mismo día toca 94 y 111: con velas diarias no se sabe el orden → cuenta la salida: −5 % → −52 €
e = evaluateIdea(up, [bar('2026-01-06', 94, 111, 100)], '2026-01-20');
check('2. Toca objetivo y salida el mismo día: se cuenta la salida (−5 %, −52 €)', e.status === 'stop' && e.result_pct === -5 && e.result_eur === -52, JSON.stringify(e));

// 3. No toca nada y pasa la fecha límite → cierra al último cierre antes de caducar (103 → +3 % → 28 €)
e = evaluateIdea(up, [bar('2026-02-26', 101, 104, 103), bar('2026-03-02', 90, 120, 115)], '2026-03-03');
check('3. Caducada: cierra al precio del último día válido (+3 %, 28 €), ignora velas posteriores', e.status === 'caducada' && e.exit_price === 103 && e.result_pct === 3 && e.result_eur === 28, JSON.stringify(e));

// 4. Bajista: entrada 50, objetivo 45, salida 53; mínimo 44,5 → objetivo: +10 %
const down = { direction: 'bajista', entry_price: 50, target_price: 45, stop_price: 53, entry_date: '2026-01-05', expires_on: '2026-03-01', size_eur: 500 };
e = evaluateIdea(down, [bar('2026-01-06', 48, 51, 49), bar('2026-01-07', 44.5, 49, 45.5)], '2026-01-20');
check('4. Bajista toca objetivo: +10 % → 500 × 10 % − 2 = 48 €', e.status === 'objetivo' && e.result_pct === 10 && e.result_eur === 48, JSON.stringify(e));

// 5. Sigue abierta: último cierre 104 → +4 % latente, sin resultado en € todavía
e = evaluateIdea(up, [bar('2026-01-06', 99, 102, 101), bar('2026-01-07', 101, 105, 104)], '2026-01-08');
check('5. Abierta: muestra precio y +4 % latente, sin cerrar', e.status === 'abierta' && e.last_price === 104 && e.result_pct === 4 && e.result_eur === null, JSON.stringify(e));

// 6. Las velas del día de la propuesta o anteriores no cuentan (el máximo 120 del día 5 no cierra la idea)
e = evaluateIdea(up, [bar('2026-01-02', 80, 130, 100), bar('2026-01-05', 99, 120, 100), bar('2026-01-06', 99, 102, 101)], '2026-01-07');
check('6. Ignora velas anteriores o del mismo día de la propuesta', e.status === 'abierta' && e.last_price === 101, JSON.stringify(e));

// 7. Una idea mal planteada se rechaza (alcista con salida por encima de la entrada)
let threw = false; try { evaluateIdea({ ...up, stop_price: 105 }, [], '2026-01-07'); } catch { threw = true; }
check('7. Rechaza una idea alcista con salida por encima de la entrada', threw);

// 8–9. Tarea diaria contra Supabase simulado y Twelve Data simulado
for (const k of Object.keys(db)) db[k] = [];
db.orbit_notes = [
  { id: 'i1', user_id: 'u1', kind: 'idea', ticker: 'ACME', price_symbol: 'ACME', title: 'ACME alcista', summary: 's', status: 'abierta', ...up, created_at: '2026-01-05T09:00:00Z' },
  { id: 'i2', user_id: 'u1', kind: 'idea', ticker: 'GLBX', price_symbol: 'GLBX', title: 'GLBX alcista', summary: 's', status: 'abierta', ...up, created_at: '2026-01-05T09:00:00Z' },
  { id: 'i3', user_id: 'u1', kind: 'idea', ticker: 'NOSY', title: 'Sin símbolo', summary: 's', status: 'abierta', ...up, created_at: '2026-01-05T09:00:00Z' },
];
const td = async (url, opts) => {
  if (String(url).startsWith('https://api.twelvedata.com/')) {
    const sym = new URL(url).searchParams.get('symbol');
    if (sym === 'GLBX') return new Response(JSON.stringify({ status: 'error', message: 'symbol not found' }), { status: 200 });
    return new Response(JSON.stringify({ values: [{ datetime: '2026-01-07', high: '111', low: '100', close: '109' }, { datetime: '2026-01-06', high: '102', low: '99', close: '101' }] }), { status: 200 });
  }
  return mockFetch(url, opts);
};
const out = await trackIdeas({ SU: process.env.SUPABASE_URL, SR: 'service', key: 'td', today: '2026-01-20', fetchImpl: td });
const i1 = db.orbit_notes.find(x => x.id === 'i1'), i2 = db.orbit_notes.find(x => x.id === 'i2');
check('8. La tarea cierra ACME en objetivo y guarda +10 % / 98 €', i1.status === 'objetivo' && Number(i1.result_eur) === 98 && out.closed === 1, JSON.stringify({ i1, out }));
check('9. Un fallo de precio (GLBX) o sin símbolo se informa y no toca la idea', i2.status === 'abierta' && out.errors.length === 2 && out.errors.some(x => /GLBX/.test(x)) && out.errors.some(x => /price_symbol/.test(x)), JSON.stringify(out.errors));

// 10. Marcador: 2 cerradas (+10 % y −5 %), 1 abierta → 1 de 2, 50 %, 98 − 52 = 46 €
const sc = scoreboard([{ status: 'objetivo', result_pct: 10, result_eur: 98 }, { status: 'stop', result_pct: -5, result_eur: -52 }, { status: 'abierta', result_pct: 4 }]);
check('10. Marcador: 1 de 2 aciertos (50 %), +46 € acumulados', sc.closed === 2 && sc.wins === 1 && sc.hit_rate === 50 && sc.result_eur === 46, JSON.stringify(sc));

// 11–12. Aviso por Instinct al cerrar, una sola vez
globalThis.fetch = mockFetch;
const inst = (await import('../api/instinct.js')).default;
const TOKEN = 'z'.repeat(40), sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
db.instinct_tokens = [{ id: 't1', user_id: 'u1', token_hash: sha(TOKEN), revoked: false }];
const today = new Date().toISOString().slice(0, 10);
i1.closed_on = today; i1.executed = false; i1.size_eur = 1000;
const call = async (route, query = {}) => { let o = {}; const res = { setHeader() {}, status(c) { o.status = c; return this; }, json(b) { o.body = b; return this; }, end() { return this; } };
  await inst({ method: 'GET', headers: { authorization: 'Bearer ' + TOKEN }, query: { route, ...query }, body: {} }, res); return o; };
let a = await call('alerts');
check('11. Aviso al cerrar: estado, resultado en % y €, y que era una propuesta', /✅ Objetivo alcanzado · ACME alcista/.test(a.body.message) && /\+10 % \(\+98,00 € sobre 1\.000 €/.test(a.body.message) && /lo que hubiera pasado/.test(a.body.message), a.body.message);
a = await call('alerts');
check('12. El aviso de cierre no se repite', !/Objetivo alcanzado/.test(a.body.message || ''), a.body.message);
a = await call('notes');
check('13. /notes incluye el marcador de propuestas', /Marcador de propuestas: 1 de 1 con ganancia \(100 %\)/.test(a.body.message), a.body.message);

for (const x of results) console.log(`${x.ok ? 'PASA ' : 'FALLA'}  ${x.n}${x.d && !x.ok ? '  —  ' + x.d.slice(0, 300) : ''}`);
console.log(`\nSeguimiento de propuestas: ${results.filter(x => x.ok).length}/${results.length} correctas`);
if (results.some(x => !x.ok)) process.exitCode = 1;
