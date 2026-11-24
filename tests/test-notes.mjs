// Análisis guardados en Orbit (orbit_notes): entrega por Instinct sin repetir y listado de ideas abiertas. Datos ficticios.
process.env.SUPABASE_URL = 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE = 'service';
import crypto from 'node:crypto';
import { db, mockFetch, failNext } from './mock-supabase.mjs';
globalThis.fetch = mockFetch;
const inst = (await import('../api/instinct.js')).default;
const results = []; const check = (n, c, d = '') => results.push({ n, ok: !!c, d });
const TOKEN = 'y'.repeat(40), sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
for (const k of Object.keys(db)) db[k] = [];
db.instinct_tokens.push({ id: 't1', user_id: 'u1', token_hash: sha(TOKEN), revoked: false });
const now = new Date().toISOString();
db.orbit_notes = [
  { id: 'n1', user_id: 'u1', kind: 'cartera', title: 'Revisión semanal de la cartera', summary: 'El S&P 500 sigue por debajo de su peso objetivo.', doc_url: 'https://claude.example/doc', created_at: now },
  { id: 'n2', user_id: 'u1', kind: 'idea', ticker: 'ACME', title: 'Idea: ACME alcista a 1-3 meses', summary: 'Consenso de compra y resultados el mes que viene.',
    direction: 'alcista', entry_price: 100, target_price: 115, stop_price: 92, currency: 'USD', expires_on: '2099-01-01', status: 'abierta', created_at: now },
  { id: 'n3', user_id: 'otro', kind: 'idea', ticker: 'GLBX', title: 'De otro usuario', summary: 'No debe salir.', status: 'abierta', created_at: now },
];
const call = async (route, query = {}) => { let o = {}; const res = { setHeader() {}, status(c) { o.status = c; return this; }, json(b) { o.body = b; return this; }, end() { return this; } };
  await inst({ method: 'GET', headers: { authorization: 'Bearer ' + TOKEN }, query: { route, ...query }, body: {} }, res); return o; };
let a = await call('alerts');
const notes = a.body.data.alerts.filter(x => x.key.startsWith('note:'));
check('1. /alerts entrega los 2 análisis del usuario (y no el de otro)', notes.length === 2 && !a.body.message.includes('De otro usuario'), a.body.message);
check('2. El aviso lleva icono, resumen y enlace al análisis completo', /📊 Revisión semanal/.test(a.body.message) && /Análisis completo: https:\/\/claude\.example\/doc/.test(a.body.message));
a = await call('alerts');
check('3. La segunda consulta no los repite', a.body.data.alerts.filter(x => x.key.startsWith('note:')).length === 0);
a = await call('notes');
check('4. /notes lista los análisis y las ideas abiertas con entrada, objetivo y salida', a.status === 200 && a.body.data.open_ideas.length === 1 && /entrada 100 USD · objetivo 115 USD · salida 92 USD/.test(a.body.message), a.body.message);
failNext.table = 'orbit_notes'; failNext.method = 'GET';
a = await call('alerts', { all: '1' });
check('5. Si la tabla falla, /alerts sigue y lo avisa', a.status === 200 && a.body.data.alerts.some(x => x.key.startsWith('note:error:')));
for (const x of results) console.log(`${x.ok ? 'PASA ' : 'FALLA'}  ${x.n}${x.d ? '  —  ' + x.d.slice(0, 200) : ''}`);
console.log(`\nAnálisis en Orbit: ${results.filter(x => x.ok).length}/${results.length} correctas`);
if (results.some(x => !x.ok)) process.exitCode = 1;
