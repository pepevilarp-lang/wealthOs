// Pruebas del atajo de Siri (/api/quick-expense) contra Supabase simulado. Datos ficticios.
process.env.SUPABASE_URL = 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE = 'service';
import { db, mockFetch } from './mock-supabase.mjs';
globalThis.fetch = mockFetch;
const { default: handler } = await import(new URL('../api/quick-expense.js', import.meta.url).href);
const U = 'user-1';
for (const k of Object.keys(db)) db[k] = [];
db.quick_tokens = [{ user_id: U, token: 'tok-siri-ficticio' }];
db.blocks.push({ id: 'c1', user_id: U, type: 'cash', name: 'Cuenta Test', value: 500, eur_value: 500, extra: {}, deleted: false, updated_at: '2026-01-01T00:00:00Z' });
async function call(body) {
  const out = {}; const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; }, end() { return this; } };
  await handler({ method: 'POST', headers: {}, body }, res); return out;
}
const results = []; const check = (n, c, d) => results.push({ n, ok: !!c, d });
let r = await call({ token: 'tok-siri-ficticio', amount: '12,50', category: 'Restaurants', note: 'Menú' });
const items = () => Object.values((db.user_expense_data[0] || { data: {} }).data).flatMap(m => m.items || []);
check('Siri registra el gasto al instante', r.status === 200 && items().length === 1, `status=${r.status} items=${items().length}`);
check('Siri descuenta el efectivo', db.blocks[0].eur_value === 487.5, `saldo=${db.blocks[0].eur_value}`);
r = await call({ token: 'tok-siri-ficticio', amount: '12,50', category: 'Restaurants', note: 'Menú' });
check('Reenvío inmediato no duplica', items().length === 1 && db.blocks[0].eur_value === 487.5, `items=${items().length} saldo=${db.blocks[0].eur_value}`);
r = await call({ token: 'otro', amount: 5, category: 'Oci' });
check('Token inválido → 401', r.status === 401, r.status);
for (const x of results) console.log(`${x.ok ? 'PASA ' : 'FALLA'}  ${x.n}  —  ${x.d}`);
console.log(`\n/api/quick-expense: ${results.filter(x => x.ok).length}/${results.length} correctas`);
if (results.some(x => !x.ok)) process.exitCode = 1;
