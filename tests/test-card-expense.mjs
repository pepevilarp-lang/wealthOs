// Gastos con tarjeta desde Apple Pay (automatización "Transacción/Wallet" de Atajos → /api/quick-expense).
// Datos ficticios: comercios, tarjetas, importes y cuentas inventados.
process.env.SUPABASE_URL = 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE = 'service';
import { db, mockFetch } from './mock-supabase.mjs';
const real = mockFetch;
globalThis.fetch = async (url, opts) => String(url).startsWith('https://api.frankfurter.app')
  ? new Response(JSON.stringify({ date: '2026-01-08', rates: { USD: 1.25, GBP: 0.8 } }), { status: 200 }) : real(url, opts);
const { parseCardAmount } = await import('../api/instinct.js');
const qe = (await import('../api/quick-expense.js')).default;

const results = [];
const check = (n, c, d = '') => results.push({ n, ok: !!c, d });
const call = async (body) => { let o = {}; const res = { setHeader() {}, status(c) { o.status = c; return this; }, json(b) { o.body = b; return this; }, end() { return this; } };
  await qe({ method: 'POST', headers: {}, body }, res); return o; };
const items = () => Object.values(db.user_expense_data[0].data).flatMap(m => m.items || []);
const cash = (id) => db.blocks.find(b => b.id === id);

// Formatos de importe que da Atajos según idioma y moneda
const p = (s) => JSON.stringify(parseCardAmount(s));
check('1. "12,50 €" → 12,5 EUR', p('12,50 €') === JSON.stringify({ value: 12.5, currency: 'EUR' }), p('12,50 €'));
check('2. "€1.234,56" → 1.234,56 EUR', p('€1.234,56') === JSON.stringify({ value: 1234.56, currency: 'EUR' }), p('€1.234,56'));
check('3. "$10.00" → 10 USD', p('$10.00') === JSON.stringify({ value: 10, currency: 'USD' }), p('$10.00'));
check('4. "GBP 8.40" → 8,4 GBP', p('GBP 8.40') === JSON.stringify({ value: 8.4, currency: 'GBP' }), p('GBP 8.40'));
check('5. 7.5 (número) → 7,5 EUR', p(7.5) === JSON.stringify({ value: 7.5, currency: 'EUR' }), p(7.5));
check('6. "" o "0,00 €" → no válido', parseCardAmount('') === null && parseCardAmount('0,00 €') === null);

for (const k of Object.keys(db)) db[k] = [];
db.quick_tokens = []; db.quick_expenses = [];
db.quick_tokens.push({ token: 'tok-ficticio', user_id: 'u1' });
db.blocks.push({ id: 'cA', user_id: 'u1', type: 'cash', name: 'Cuenta Neobanco', value: 1000, eur_value: 1000, extra: {}, deleted: false, updated_at: '2026-01-01T00:00:00Z' });
db.blocks.push({ id: 'cB', user_id: 'u1', type: 'cash', name: 'Banco Tradicional', value: 500, eur_value: 500, extra: {}, deleted: false, updated_at: '2026-01-01T00:00:00Z' });
const today = new Date().toISOString().slice(0, 10);
// Historial: el usuario ya clasificó "Cafetería Ficticia" como Restaurants dos veces y una como Altres
db.user_expense_data.push({ user_id: 'u1', updated_at: '2026-01-01T00:00:00Z', data: { X: { name: 'X', num: 1, year: 2026, items: [
  { id: 'h1', concept: 'Cafetería Ficticia', category: 'Restaurants', amount: 3 }, { id: 'h2', concept: 'CAFETERIA FICTICIA', category: 'Restaurants', amount: 4 },
  { id: 'h3', concept: 'Cafetería Ficticia', category: 'Altres', amount: 2 } ] } } });

// 7. Comercio conocido: categoría aprendida, cuenta por la tarjeta, saldo descontado
let r = await call({ token: 'tok-ficticio', amount: '3,80 €', merchant: 'Cafetería Ficticia', card: 'Neobanco Visa' });
let it = items().find(i => i.amount === 3.8);
check('7. Aprende la categoría del comercio (Restaurants) y descuenta 3,80 € de la cuenta de la tarjeta', r.status === 200 && it && it.category === 'Restaurants' && it.concept === 'Cafetería Ficticia' && it.account_id === 'cA' && cash('cA').value === 996.2, JSON.stringify({ r: r.body, it, v: cash('cA').value }));
check('8. Queda marcado como pago con tarjeta (origen applepay)', it && it.source === 'applepay', JSON.stringify(it));

// 9. Apple manda el mismo pago dos veces: no se duplica ni se descuenta dos veces
r = await call({ token: 'tok-ficticio', amount: '3,80 €', merchant: 'Cafetería Ficticia', card: 'Neobanco Visa' });
check('9. Pago repetido en el mismo minuto: no duplica', items().filter(i => i.amount === 3.8).length === 1 && cash('cA').value === 996.2, JSON.stringify(r.body));

// 10. Comercio nuevo: palabra clave (Mercadona → Alimentació)
r = await call({ token: 'tok-ficticio', amount: '23,45 €', merchant: 'MERCADONA AV. FICTICIA', card: 'Neobanco Visa' });
it = items().find(i => i.amount === 23.45);
check('10. Comercio sin historial: palabra clave (Alimentació)', it && it.category === 'Alimentació', JSON.stringify(it));

// 11. Otra moneda: 10 USD con 1 € = 1,25 USD → 8 €; el concepto guarda el original
r = await call({ token: 'tok-ficticio', amount: '$10.00', merchant: 'Shop Abroad', card: 'Neobanco Visa' });
it = items().find(i => /Shop Abroad/.test(i.concept));
check('11. 10 USD → 8,00 € al tipo del BCE, con el original en el concepto', it && it.amount === 8 && /10,00 USD/.test(it.concept), JSON.stringify(it));

// 12. Tarjeta que no encaja con ninguna cuenta y hay dos: se apunta sin mover saldo y se avisa
r = await call({ token: 'tok-ficticio', amount: '5,00 €', merchant: 'Tienda Desconocida', card: 'Tarjeta Rara' });
it = items().find(i => /Tienda Desconocida/.test(i.concept));
check('12. Tarjeta sin cuenta: se apunta (Altres) sin tocar saldos y lo dice', r.status === 200 && it && it.category === 'Altres' && !it.account_id && cash('cB').value === 500 && /indica la cuenta/.test(r.body.message), JSON.stringify(r.body));

// 13. El disparador a veces llega vacío: error claro, nada apuntado
const n0 = items().length;
r = await call({ token: 'tok-ficticio', amount: '', merchant: ' ', card: 'Neobanco Visa' });
check('13. Transacción vacía de Wallet: 400 con motivo, no apunta nada', r.status === 400 && /importe/i.test(r.body.error) && items().length === n0, JSON.stringify(r.body));

// 14. El formato antiguo de Siri sigue funcionando
r = await call({ token: 'tok-ficticio', amount: '12', category: 'Oci' });
check('14. Atajo de Siri antiguo ({amount, category}) sigue igual', r.status === 200 && items().some(i => i.amount === 12 && i.category === 'Oci'), JSON.stringify(r.body));

for (const x of results) console.log(`${x.ok ? 'PASA ' : 'FALLA'}  ${x.n}${x.d && !x.ok ? '  —  ' + x.d.slice(0, 400) : ''}`);
console.log(`\nGastos con tarjeta (Apple Pay): ${results.filter(x => x.ok).length}/${results.length} correctas`);
if (results.some(x => !x.ok)) process.exitCode = 1;
