// Pruebas de la TIR (XIRR) de private equity con números calculados a mano. Datos ficticios.
process.env.SUPABASE_URL = 'https://mock.supabase.co'; process.env.SUPABASE_SERVICE_ROLE = 'service';
const { xirr, peIRR } = await import(new URL('../api/instinct.js', import.meta.url).href);
const results = []; const check = (n, c, d) => results.push({ n, ok: !!c, d });
const pct = (r) => r === null ? 'null' : (r * 100).toFixed(4) + '%';

// 1. −100 el 01/01/2025 y +121 el 01/01/2027 (730 días = 2,0 años de 365): (121/100)^(1/2) − 1 = 10 %
let r = xirr([{ date: '2025-01-01', amount: -100 }, { date: '2027-01-01', amount: 121 }]);
check('−100 → +121 en 2 años = 10,00 %', Math.abs(r - 0.10) < 1e-6, pct(r));

// 2. −1.000 y +1.000 un año después: 0 %
r = xirr([{ date: '2025-03-01', amount: -1000 }, { date: '2026-03-01', amount: 1000 }]);
check('Recuperar lo invertido en un año = 0 %', Math.abs(r) < 1e-6, pct(r));

// 3. Pérdida: −100 y +81 a 2 años = −10 %
r = xirr([{ date: '2025-01-01', amount: -100 }, { date: '2027-01-01', amount: 81 }]);
check('−100 → +81 en 2 años = −10,00 %', Math.abs(r + 0.10) < 1e-6, pct(r));

// 4. Varios flujos: el VAN a la tasa hallada es 0
const flows = [{ date: '2024-06-30', amount: -50000 }, { date: '2025-02-15', amount: -30000 }, { date: '2025-12-01', amount: 12000 }, { date: '2026-11-11', amount: 85000 }];
r = xirr(flows);
const t0 = Date.parse('2024-06-30');
const npv = flows.reduce((s, f) => s + f.amount / Math.pow(1 + r, (Date.parse(f.date) - t0) / 864e5 / 365), 0);
check('Con varios calls y una distribución, el VAN a la TIR es 0', Math.abs(npv) < 0.01, `${pct(r)} · VAN=${npv.toFixed(4)} €`);

// 5. Sin entradas o sin salidas: no hay TIR
check('Solo capital calls (sin valor ni distribuciones): sin TIR', xirr([{ date: '2025-01-01', amount: -100 }, { date: '2026-01-01', amount: -50 }]) === null, '');

// 6. peIRR: posición con valor actual a la fecha del NAV
const b = { type: 'pe', eur_value: 121, extra: { called_base: 0, distributed_base: 0, nav_official: 121, nav_date: '2027-01-01' } };
let x = peIRR(b, [{ kind: 'call', amount: 100, date: '2025-01-01' }, { kind: 'commitment', amount: 500, date: '2024-12-01' }], '2027-06-01');
check('peIRR usa la fecha del NAV oficial e ignora el compromiso', Math.abs(x.irr - 0.10) < 1e-6 && x.value_date === '2027-01-01', JSON.stringify(x));

// 7. peIRR con importes iniciales sin fecha: no se inventa la TIR
x = peIRR({ type: 'pe', eur_value: 1000, extra: { called_base: 800, distributed_base: 0 } }, [{ kind: 'call', amount: 200, date: '2026-01-01' }], '2026-11-11');
check('Con desembolsado inicial sin fecha: TIR no calculable, con el motivo', x.irr === null && /sin fecha/.test(x.reason), x.reason);

// 8. La app (index.html) calcula exactamente lo mismo que el servidor
{
  const fs = await import('node:fs'), vm = await import('node:vm');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const i = html.indexOf('function xirrFlows('); let d = 0, j = html.indexOf('{', i), code = '';
  for (let k = j; k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}' && --d === 0) { code = html.slice(i, k + 1); break; } }
  const ctx = { Date, Math, isFinite }; vm.createContext(ctx); vm.runInContext(code, ctx);
  const a = ctx.xirrFlows(flows), b2 = xirr(flows);
  check('La TIR de la app y la del servidor coinciden', Math.abs(a - b2) < 1e-12, `${pct(a)} = ${pct(b2)}`);
}

for (const t of results) console.log(`${t.ok ? 'PASA ' : 'FALLA'}  ${t.n}${t.d ? '  —  ' + t.d : ''}`);
console.log(`\nTIR de private equity: ${results.filter(t => t.ok).length}/${results.length} correctas`);
if (results.some(t => !t.ok)) process.exitCode = 1;
