// /api/instinct.js — Conexión con Instinct (asistente por WhatsApp)
//
// Instinct lee y escribe en LOS MISMOS almacenes que la app, para que todo se vea en los dos sitios:
//   · gastos e ingresos → user_expense_data (la pestaña Gastos, la misma que se llena con el Excel)
//   · límites           → user_kv, clave wealth_budgets_<usuario>
//   · objetivos         → user_kv, clave wealth_goals_legacy_<usuario>
//   · compras y ventas  → movements
// Autenticación: cabecera  Authorization: Bearer <token>   (nunca en la URL)
// Variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_ROLE
//
// Acciones (POST con JSON { action, ... }; summary, alerts y recent también por GET ?action=):
//   expense { amount, concept?, category?, date?, request_id? }   income { amount, concept?, date?, request_id? }
//   set_budget { category, limit }   set_goal { name, target, deadline? }   save { goal, amount, request_id? }
//   buy | sell { ticker? isin?, qty, price, fees?, date? }   summary   alerts { all? }   undo   recent
// Cada respuesta incluye `message`: texto listo para enviar por WhatsApp.

import crypto from 'crypto';

const SB_URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE;
const TZ = 'Europe/Madrid';

// Categorías de la app (QUICK_CATS y las que asigna al importar el Excel)
export const CATEGORIES = [
  { label: 'Alimentació',   icon: '🛒', color: '#0891B2' },
  { label: 'Restaurants',   icon: '🍽️', color: '#F59E0B' },
  { label: 'Transport',     icon: '⛽', color: '#6B7280' },
  { label: 'Esport',        icon: '🏃', color: 'var(--pos)' },
  { label: 'Oci',           icon: '🎭', color: '#EC4899' },
  { label: 'Compres',       icon: '🛍️', color: '#8B5CF6' },
  { label: 'Subscripcions', icon: '📱', color: 'var(--gold)' },
  { label: 'Viatge',        icon: '✈️', color: '#0EA5E9' },
  { label: 'Personal',      icon: '👤', color: '#64748B' },
  { label: 'Altres',        icon: '📦', color: '#9CA3AF' },
];
const LABELS = CATEGORIES.map(c => c.label);
const catInfo = (label) => CATEGORIES.find(c => c.label === label) || { label, icon: '📦', color: '#9CA3AF' };
// Sinónimos en castellano y catalán → etiqueta de la app
const SYNONYMS = {
  alimentacio:'Alimentació', alimentacion:'Alimentació', supermercado:'Alimentació', super:'Alimentació', mercado:'Alimentació', compra:'Alimentació', comida:'Alimentació',
  restaurants:'Restaurants', restaurante:'Restaurants', restaurantes:'Restaurants', cena:'Restaurants', comer:'Restaurants', bar:'Restaurants', bares:'Restaurants', cafe:'Restaurants', copas:'Restaurants',
  transport:'Transport', transporte:'Transport', taxi:'Transport', gasolina:'Transport', coche:'Transport', metro:'Transport', parking:'Transport',
  esport:'Esport', deporte:'Esport', deportes:'Esport', gimnasio:'Esport', gym:'Esport',
  oci:'Oci', ocio:'Oci', cine:'Oci', concierto:'Oci', fiesta:'Oci',
  compres:'Compres', compras:'Compres', ropa:'Compres', regalo:'Compres', regalos:'Compres', hogar:'Compres', casa:'Compres',
  subscripcions:'Subscripcions', suscripcion:'Subscripcions', suscripciones:'Subscripcions',
  viatge:'Viatge', viaje:'Viatge', viajes:'Viatge', hotel:'Viatge', vuelo:'Viatge',
  personal:'Personal', salud:'Personal', farmacia:'Personal', medico:'Personal', formacion:'Personal', curso:'Personal', peluqueria:'Personal',
  altres:'Altres', otros:'Altres', otro:'Altres',
};
// Palabras clave para clasificar por el concepto cuando no llega categoría
const KEYWORDS = [
  ['Alimentació',   /mercadona|carrefour|lidl|aldi|dia\b|eroski|consum|caprabo|bonpreu|alcampo|condis|ametller|supermerc|super\b|fruteria|carniceria|panaderia/],
  ['Restaurants',   /restaur|cena|comida|almuerzo|desayuno|dinar|sopar|bar\b|cafe|cafeter|forn|tagliatella|vips|burger|mcdonald|kfc|telepizza|domino|glovo|uber ?eats|just ?eat|deliveroo|tapas|sushi/],
  ['Transport',     /uber(?! ?eats)|cabify|bolt|taxi|renfe|metro|bus\b|tmb|gasolin|repsol|cepsa|bp\b|parking|peaje|iryo|ouigo|bicing/],
  ['Subscripcions', /netflix|spotify|hbo|max\b|disney|prime video|apple ?one|icloud|youtube premium|chatgpt|claude|suscrip|subscrip/],
  ['Compres',       /amazon|zara|mango|pull|bershka|primark|el corte ingles|decathlon|fnac|media ?markt|ikea|aliexpress|shein|regalo/],
  ['Esport',        /gimnas|gym|padel|esport|deporte|decathlon/],
  ['Oci',           /cine|concierto|entradas|teatro|museo|fiesta|discoteca|steam|playstation|xbox/],
  ['Viatge',        /hotel|airbnb|booking|vuelo|ryanair|iberia|vueling|viaje|viatge/],
  ['Personal',      /farmacia|medic|dentist|fisio|optica|clinica|peluquer|curso|academia/],
];

// ── utilidades ──────────────────────────────────────────────────────────
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
export function toCents(v) {
  if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) : null;
  if (typeof v !== 'string') return null;
  let t = v.replace(/[^\d,.\-]/g, '');
  if (!t) return null;
  const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
  if (lc > -1 && ld > -1) t = lc > ld ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (lc > -1) { const d = t.length - lc - 1; t = (d > 0 && d <= 2) ? t.replace(',', '.') : t.replace(/,/g, ''); }
  else if (ld > -1) { const d = t.length - ld - 1; if (d === 3) t = t.replace(/\./g, ''); }
  const n = parseFloat(t);
  return isNaN(n) ? null : Math.round(n * 100);
}
// Formato fijo y coherente: punto de miles siempre, coma decimal, decimales solo si los hay
export function eur(cents) {
  const neg = cents < 0, a = Math.abs(Math.round(cents));
  const int = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = a % 100 ? ',' + String(a % 100).padStart(2, '0') : '';
  return `${neg ? '−' : ''}${int}${dec} €`;
}
// Importe en su divisa: "37 €" o "240 USD" (nunca "240 € USD")
function money(cents, ccy) {
  if (!ccy || ccy === 'EUR') return eur(cents);
  return eur(cents).replace(' €', ' ' + ccy);
}
const pct = (a, b) => b > 0 ? Math.round(a / b * 100) : 0;
export function madridToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
const daysInMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const monthStart = (d) => d.slice(0, 7) + '-01';
const monthEnd = (d) => d.slice(0, 7) + '-' + String(daysInMonth(d.slice(0, 7))).padStart(2, '0');
const prevMonth = (ym, n = 1) => { let [y, m] = ym.split('-').map(Number); m -= n; while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; };
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const monthName = (ym) => MESES[Number(ym.slice(5, 7)) - 1];
export function parseDate(v, today) {
  if (!v) return today;
  const t = norm(v);
  if (t === 'hoy') return today;
  if (t === 'ayer') { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/);
  if (m) { const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : today.slice(0, 4); return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
}
export function resolveCategory(category, concept) {
  if (category) {
    const c = norm(category);
    const exact = LABELS.find(x => norm(x) === c);
    if (exact) return exact;
    if (SYNONYMS[c]) return SYNONYMS[c];
  }
  const text = norm(`${category || ''} ${concept || ''}`);
  for (const [cat, re] of KEYWORDS) if (re.test(text)) return cat;
  return 'Altres';
}
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// ── acceso a Supabase (REST, con la clave de servicio, siempre filtrando por usuario) ──
async function sb(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text.slice(0, 200) }; }
  if (!r.ok) { const e = new Error((data && (data.message || data.hint)) || `Supabase ${r.status}`); e.status = r.status; e.code = data && data.code; throw e; }
  return data;
}
const q = encodeURIComponent;

async function authenticate(req) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  const token = (h.startsWith('Bearer ') ? h.slice(7) : '').trim();
  if (!token || token.length < 32) return null;
  const rows = await sb(`instinct_tokens?select=id,user_id&token_hash=eq.${sha256(token)}&revoked=eq.false&limit=1`);
  if (!rows || !rows.length) return null;
  await sb(`instinct_tokens?id=eq.${rows[0].id}`, { method: 'PATCH', body: { last_used_at: new Date().toISOString() } });
  return rows[0].user_id;
}

// ── almacenes de la app ─────────────────────────────────────────────────
const SP = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const CA = ['Gener','Febrer','Març','Abril','Maig','Juny','Juliol','Agost','Setembre','Octubre','Novembre','Desembre'];
const kBudgets = (uid) => `wealth_budgets_${uid}`;
const kGoals   = (uid) => `wealth_goals_legacy_${uid}`;

async function getExpenses(uid) {
  const r = await sb(`user_expense_data?select=data,updated_at&user_id=eq.${uid}&limit=1`);
  return (r && r[0] && r[0].data && typeof r[0].data === 'object') ? r[0].data : {};
}
async function putExpenses(uid, data) {
  await sb('user_expense_data?on_conflict=user_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: { user_id: uid, data, updated_at: new Date().toISOString() } });
}
async function getKV(uid, key, fallback) {
  const r = await sb(`user_kv?select=value,deleted&user_id=eq.${uid}&key=eq.${q(key)}&limit=1`);
  if (!r || !r[0] || r[0].deleted || r[0].value == null) return fallback;
  try { return JSON.parse(r[0].value); } catch { return fallback; }
}
async function putKV(uid, key, obj) {
  await sb('user_kv?on_conflict=user_id,key', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: { user_id: uid, key, value: JSON.stringify(obj), deleted: false, updated_at: new Date().toISOString() } });
}
// La misma regla que la app (applyQuickExpense): mes por nombre, en castellano o catalán
function monthKeyFor(data, date) {
  const mi = Number(date.slice(5, 7)) - 1;
  const found = Object.keys(data).find(k => {
    const nm = String((data[k] && data[k].name) || k).toLowerCase();
    return nm.startsWith(SP[mi].toLowerCase().slice(0, 3)) || nm.startsWith(CA[mi].toLowerCase().slice(0, 3));
  });
  return found || SP[mi];
}
function ensureMonth(data, date) {
  const key = monthKeyFor(data, date), mi = Number(date.slice(5, 7)) - 1;
  if (!data[key]) data[key] = { name: key, num: mi + 1, nomina: 0, extra: 0, totalIncome: 0, totalExpense: 0, savings: 0, target: 0, items: [] };
  if (!Array.isArray(data[key].items)) data[key].items = [];
  return data[key];
}
// Totales recalculados igual que en la app (mergeExpenseMovements)
function recomputeMonth(m) {
  const items = m.items || [];
  m.totalExpense = items.filter(i => !i.isIncome).reduce((a, i) => a + (Number(i.amount) || 0), 0);
  m.totalIncome  = items.filter(i => i.isIncome).reduce((a, i) => a + (Number(i.amount) || 0), 0) + (Number(m.nomina) || 0) + (Number(m.extra) || 0);
  m.totalExpense = Math.round(m.totalExpense * 100) / 100;
  m.totalIncome  = Math.round(m.totalIncome * 100) / 100;
  m.savings = Math.round((m.totalIncome - m.totalExpense) * 100) / 100;
}
const C = (x) => Math.round((Number(x) || 0) * 100);   // a céntimos
function monthView(data, today) {
  const m = data[monthKeyFor(data, today)];
  const items = (m && m.items) || [];
  const byCat = {};
  let spent = 0, incomeItems = 0;
  for (const i of items) {
    if (i.isIncome) { incomeItems += C(i.amount); continue; }
    spent += C(i.amount); byCat[i.category || 'Altres'] = (byCat[i.category || 'Altres'] || 0) + C(i.amount);
  }
  const income = incomeItems + C(m && m.nomina) + C(m && m.extra);
  return { spent, income, byCat, items };
}

function paceLine(spent, limit, today) {
  const ym = today.slice(0, 7), day = Number(today.slice(8, 10)), dim = daysInMonth(ym), left = dim - day;
  if (spent >= limit) return `Has superado el límite de ${eur(limit)} en ${eur(spent - limit)}.`;
  const projected = Math.round(spent / day * dim);
  let s = `Te quedan ${eur(limit - spent)} para ${left} día${left === 1 ? '' : 's'}.`;
  if (day >= 5 && projected > limit) s += ` A este ritmo acabarías el mes en ${eur(projected)}.`;
  return s;
}
function monthsLeftUntil(deadline, today) {
  if (!deadline) return null;
  const d = String(deadline).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(d)) return null;
  const [ty, tm] = today.slice(0, 7).split('-').map(Number), [gy, gm] = d.split('-').map(Number);
  return Math.max(1, (gy - ty) * 12 + (gm - tm) + 1);
}
function goalProgress(g, today) {
  const saved = C(g.current), target = C(g.target);
  const thisMonth = (g.contribs || []).filter(c => String(c.date).slice(0, 7) === today.slice(0, 7)).reduce((a, c) => a + C(c.amount), 0);
  const ml = monthsLeftUntil(g.deadline, today);
  const needMonthly = ml === null ? null : Math.max(0, Math.ceil((target - (saved - thisMonth)) / ml));
  return { saved, target, thisMonth, needMonthly };
}
function findGoal(goals, name) {
  const n = norm(name);
  return goals.find(g => g.id === name) || goals.find(g => norm(g.name) === n) || goals.find(g => n.length >= 3 && norm(g.name).includes(n)) || null;
}

// ── acciones ────────────────────────────────────────────────────────────
async function addMovement(uid, row) {
  try {
    const ins = await sb('movements', { method: 'POST', body: { user_id: uid, source: 'instinct', ...row }, prefer: 'return=representation' });
    return { row: ins[0], duplicate: false };
  } catch (e) {
    if (e.code === '23505' && row.request_id) {   // misma petición repetida: devolver la original
      const ex = await sb(`movements?select=*&user_id=eq.${uid}&request_id=eq.${q(row.request_id)}&limit=1`);
      return { row: ex[0], duplicate: true };
    }
    throw e;
  }
}

async function actItem(uid, b, today, isIncome) {
  const cents = toCents(b.amount);
  if (!cents || cents <= 0 || cents > 10000000) return bad('Necesito un importe válido (por ejemplo, 45 o 45,50).');
  const date = parseDate(b.date, today);
  if (!date) return bad('No entiendo la fecha. Usa "hoy", "ayer" o DD/MM/AAAA.');
  if (date > today) return bad('La fecha es futura. Indica la fecha real.');
  const category = isIncome ? 'Ingressos' : resolveCategory(b.category, b.concept);
  const concept = String(b.concept || '').slice(0, 80) || (isIncome ? 'Ingreso' : category);
  const data = await getExpenses(uid);
  // Misma petición repetida (reintento de Instinct): no se duplica
  if (b.request_id) {
    for (const m of Object.values(data)) {
      const dup = (m.items || []).find(i => i.request_id === b.request_id);
      if (dup) return ok(`Ya lo tenía apuntado: ${eur(C(dup.amount))}${dup.category ? ` en ${dup.category}` : ''}. No lo he duplicado.`, { id: dup.id, duplicate: true });
    }
  }
  const m = ensureMonth(data, date);
  const since = Date.now() - 10 * 60000;
  const looksRepeated = !b.request_id && !isIncome && m.items.some(i => !i.isIncome && C(i.amount) === cents
    && norm(i.concept) === norm(concept) && i.created_at && Date.parse(i.created_at) >= since);
  const info = catInfo(category);
  const item = { id: crypto.randomUUID(), concept, amount: cents / 100, isIncome, category, icon: isIncome ? '💶' : info.icon,
    color: isIncome ? 'var(--pos)' : info.color, date, source: 'instinct', created_at: new Date().toISOString(), request_id: b.request_id || null };
  m.items.push(item);
  recomputeMonth(m);
  await putExpenses(uid, data);
  const v = monthView(data, today), when = date === today ? 'hoy' : date;
  if (isIncome) return ok(`✓ Ingreso apuntado: ${eur(cents)}, ${when}. Este mes: ${eur(v.income)} de ingresos y ${eur(v.spent)} de gastos.`, { id: item.id });
  const budgets = await getKV(uid, kBudgets(uid), {});
  const limit = budgets[category] ? C(budgets[category]) : null;
  const catSpent = date.slice(0, 7) === today.slice(0, 7) ? (v.byCat[category] || 0) : null;
  let msg = `✓ Apuntado: ${eur(cents)} en ${category}${concept && concept !== category ? ` (${concept})` : ''}, ${when}.`;
  if (catSpent !== null && limit) msg += ` Llevas ${eur(catSpent)} de ${eur(limit)} en ${category} este mes (${pct(catSpent, limit)}%). ${paceLine(catSpent, limit, today)}`;
  else if (catSpent !== null) msg += ` ${category} este mes: ${eur(catSpent)}. Total gastado en ${monthName(today.slice(0, 7))}: ${eur(v.spent)}.`;
  if (looksRepeated) msg += ` ⚠ Parece repetido de hace unos minutos: si lo es, dime "deshaz".`;
  return ok(msg, { id: item.id, category, date });
}

async function actSetBudget(uid, b, today) {
  const category = resolveCategory(b.category, '');
  const cents = toCents(b.limit);
  if (!b.category || (category === 'Altres' && !['altres','otros','otro'].includes(norm(b.category))))
    return bad(`Categoría no reconocida. Usa una de: ${LABELS.join(', ')}.`);
  if (!cents || cents <= 0) return bad('Necesito un límite válido en euros.');
  const budgets = await getKV(uid, kBudgets(uid), {});
  budgets[category] = cents / 100;
  await putKV(uid, kBudgets(uid), budgets);
  const v = monthView(await getExpenses(uid), today), spent = v.byCat[category] || 0;
  return ok(`✓ Límite de ${category}: ${eur(cents)} al mes. Llevas ${eur(spent)} este mes (${pct(spent, cents)}%).`, { category, limit: cents / 100 });
}

async function actSetGoal(uid, b, today) {
  const name = String(b.name || '').trim().slice(0, 60);
  const cents = toCents(b.target);
  if (!name) return bad('¿Cómo se llama el objetivo? (por ejemplo, "Piso").');
  if (!cents || cents <= 0) return bad('Necesito el importe objetivo.');
  let deadline = '';
  if (b.deadline) {
    const d = String(b.deadline).match(/^(\d{4})-(\d{1,2})/) || String(b.deadline).match(/^(\d{1,2})[\/.\-](\d{4})$/);
    if (!d) return bad('Fecha límite no válida. Usa AAAA-MM o MM/AAAA.');
    const [y, m] = d[1].length === 4 ? [d[1], d[2]] : [d[2], d[1]];
    deadline = `${y}-${String(m).padStart(2, '0')}-01`;
    if (deadline.slice(0, 7) < today.slice(0, 7)) return bad('La fecha límite ya ha pasado.');
  }
  const goals = await getKV(uid, kGoals(uid), []);
  let g = goals.find(x => norm(x.name) === norm(name));
  if (g) { g.target = cents / 100; if (deadline) g.deadline = deadline; }
  else { g = { id: crypto.randomUUID(), name, type: 'ahorro', target: cents / 100, current: 0, deadline, created: new Date().toISOString() }; goals.push(g); }
  await putKV(uid, kGoals(uid), goals);
  const p = goalProgress(g, today);
  let msg = `✓ Objetivo "${g.name}": ${eur(p.target)}${g.deadline ? ` para ${monthName(g.deadline.slice(0, 7))} de ${g.deadline.slice(0, 4)}` : ''}. Llevas ${eur(p.saved)} (${pct(p.saved, p.target)}%).`;
  if (p.needMonthly !== null) msg += ` Necesitas apartar ${eur(p.needMonthly)} al mes.`;
  return ok(msg, { goal_id: g.id });
}

async function actSave(uid, b, today) {
  const cents = toCents(b.amount);
  if (!cents || cents <= 0) return bad('Necesito un importe válido.');
  const goals = await getKV(uid, kGoals(uid), []);
  const g = b.goal ? findGoal(goals, b.goal) : null;
  if (!g) return bad(goals.length ? `No encuentro ese objetivo. Tienes: ${goals.map(x => x.name).join(', ')}.`
    : 'Aún no tienes objetivos de ahorro. Crea uno primero, por ejemplo: "objetivo Piso, 12.000 € para 09/2030".');
  g.contribs = g.contribs || [];
  if (b.request_id && g.contribs.some(c => c.request_id === b.request_id))
    return ok(`Ya lo tenía apuntado. "${g.name}": ${eur(C(g.current))} de ${eur(C(g.target))}.`, { duplicate: true });
  const date = parseDate(b.date, today) || today;
  g.current = Math.round((Number(g.current) || 0) * 100 + cents) / 100;
  g.contribs.push({ id: crypto.randomUUID(), date, amount: cents / 100, source: 'instinct', created_at: new Date().toISOString(), request_id: b.request_id || null });
  await putKV(uid, kGoals(uid), goals);
  const p = goalProgress(g, today);
  let msg = `✓ ${eur(cents)} apartados para "${g.name}": ${eur(p.saved)} de ${eur(p.target)} (${pct(p.saved, p.target)}%).`;
  if (p.needMonthly !== null) msg += p.thisMonth >= p.needMonthly ? ` Este mes ya cumples lo necesario (${eur(p.needMonthly)}).`
    : ` Para ir al día te faltan ${eur(p.needMonthly - p.thisMonth)} este mes.`;
  return ok(msg, { saved: p.saved / 100, target: p.target / 100 });
}

async function actTrade(uid, b, today, type) {
  const ticker = String(b.ticker || '').toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 16) || null;
  const isin = String(b.isin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!ticker && !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) return bad('Necesito el ticker (p. ej. VUAA) o el ISIN.');
  const qty = Number(String(b.qty ?? '').replace(',', '.'));
  const priceCents = toCents(b.price);
  const feeCents = toCents(b.fees ?? 0) || 0;
  if (!(qty > 0)) return bad('Necesito el número de títulos.');
  if (!priceCents || priceCents <= 0) return bad('Necesito el precio por título.');
  const date = parseDate(b.date, today);
  if (!date || date > today) return bad('Fecha no válida.');
  const gross = Math.round(qty * priceCents);
  const total = type === 'buy' ? gross + feeCents : gross - feeCents;
  const currency = String(b.currency || 'EUR').toUpperCase().slice(0, 3);
  const { duplicate } = await addMovement(uid, { type, date, amount: total / 100, ticker, isin: isin || null, qty,
    price: priceCents / 100, currency, concept: `${type === 'buy' ? 'Compra' : 'Venta'} ${ticker || isin}`, request_id: b.request_id || null });
  const verb = type === 'buy' ? 'Compra' : 'Venta';
  return ok(`${duplicate ? 'Ya la tenía apuntada' : `✓ ${verb} registrada`}: ${qty.toLocaleString('es-ES', { maximumFractionDigits: 6 })} ${ticker || isin} a ${eur(priceCents)}${currency !== 'EUR' ? ` ${currency}` : ''} = ${eur(total)}${feeCents ? ` (comisión ${eur(feeCents)} incluida)` : ''}, ${date === today ? 'hoy' : date}.`, { amount: total / 100 });
}

async function buildSummary(uid, today) {
  const ym = today.slice(0, 7), day = Number(today.slice(8, 10)), dim = daysInMonth(ym);
  const data = await getExpenses(uid);
  const v = monthView(data, today);
  const budgets = await getKV(uid, kBudgets(uid), {});
  const blist = Object.entries(budgets).filter(([, l]) => Number(l) > 0).map(([category, l]) => ({ category, limit: C(l), spent: v.byCat[category] || 0 }));
  const limitTotal = blist.reduce((a, x) => a + x.limit, 0), spentBudgeted = blist.reduce((a, x) => a + x.spent, 0);
  const goals = await getKV(uid, kGoals(uid), []);
  const gl = goals.map(g => ({ name: g.name, ...goalProgress(g, today) }));
  const blocks = await sb(`blocks?select=type,eur_value,value&user_id=eq.${uid}&deleted=eq.false`) || [];
  const LABEL = { bolsa: 'Bolsa', fondos: 'Fondos', pe: 'Private equity', cash: 'Efectivo', inmobiliario: 'Inmobiliario', otros: 'Otros' };
  const byType = {};
  blocks.forEach(x => { byType[x.type] = (byType[x.type] || 0) + C(x.eur_value || x.value); });
  const netWorth = Object.values(byType).reduce((a, c) => a + c, 0);
  const hist = await sb(`patrimonio_history?select=date,total&user_id=eq.${uid}&date=lt.${ym}-01&order=date.desc&limit=1`) || [];
  const prevTotal = hist.length ? C(hist[0].total) : null;
  const mes = monthName(ym);
  const lines = [`*${mes[0].toUpperCase() + mes.slice(1)}* · día ${day} de ${dim}`];
  if (netWorth) lines.push(`Patrimonio: ${eur(netWorth)}${prevTotal ? ` (${netWorth >= prevTotal ? '+' : '−'}${eur(Math.abs(netWorth - prevTotal))} desde fin de ${monthName(prevMonth(ym))})` : ''}`
    + ` · ${Object.entries(byType).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${LABEL[t] || t} ${eur(c)}`).join(' · ')}`);
  lines.push(`Gastos: ${eur(v.spent)}${v.income ? ` · Ingresos: ${eur(v.income)} · Balance: ${v.income >= v.spent ? '+' : ''}${eur(v.income - v.spent)}` : ''}`);
  if (limitTotal) lines.push(`Presupuesto: ${eur(spentBudgeted)} de ${eur(limitTotal)} en categorías con límite (${pct(spentBudgeted, limitTotal)}%)`);
  const top = Object.entries(v.byCat).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length) lines.push(`Donde más: ${top.map(([c, x]) => `${c} ${eur(x)}`).join(' · ')}`);
  for (const x of blist) if (x.spent >= x.limit * 0.8) lines.push(`${x.spent >= x.limit ? '🔴' : '🟠'} ${x.category}: ${eur(x.spent)} de ${eur(x.limit)} (${pct(x.spent, x.limit)}%)`);
  for (const g of gl) {
    let t = `🎯 ${g.name}: ${eur(g.saved)} de ${eur(g.target)} (${pct(g.saved, g.target)}%)`;
    if (g.needMonthly !== null) t += g.thisMonth >= g.needMonthly ? ' · al día este mes' : ` · faltan ${eur(g.needMonthly - g.thisMonth)} este mes`;
    lines.push(t);
  }
  const E = (c) => c / 100;
  return { message: lines.join('\n'), data: { month: ym, day, days_in_month: dim, spent: E(v.spent), income: E(v.income),
    budgets: blist.map(x => ({ category: x.category, limit: E(x.limit), spent: E(x.spent) })),
    by_category: Object.fromEntries(Object.entries(v.byCat).map(([k, x]) => [k, E(x)])),
    net_worth: E(netWorth), net_worth_by_type: Object.fromEntries(Object.entries(byType).map(([k, x]) => [k, E(x)])),
    goals: gl.map(g => ({ name: g.name, saved: E(g.saved), target: E(g.target), needMonthly: g.needMonthly === null ? null : E(g.needMonthly), thisMonth: E(g.thisMonth) })) } };
}

export async function computeAlerts(uid, today) {
  const ym = today.slice(0, 7), day = Number(today.slice(8, 10)), dim = daysInMonth(ym);
  const data = await getExpenses(uid);
  const v = monthView(data, today);
  const out = [];
  const budgets = await getKV(uid, kBudgets(uid), {});
  for (const [cat, l0] of Object.entries(budgets)) {
    const l = C(l0); if (!l) continue;
    const s = v.byCat[cat] || 0;
    if (s >= l) out.push({ key: `budget:${cat}:${ym}:100`, level: 'alta', text: `🔴 Has superado el límite de ${cat}: ${eur(s)} de ${eur(l)}.` });
    else if (s >= l * 0.8) out.push({ key: `budget:${cat}:${ym}:80`, level: 'media', text: `🟠 ${cat} al ${pct(s, l)}%: ${eur(s)} de ${eur(l)}. Te quedan ${eur(l - s)} para ${dim - day} días.` });
    else if (day >= 7 && Math.round(s / day * dim) > l)
      out.push({ key: `pace:${cat}:${ym}`, level: 'baja', text: `${cat}: a este ritmo acabarías el mes en ${eur(Math.round(s / day * dim))}, por encima de tu límite de ${eur(l)}.` });
  }
  // Gasto total frente a la media de los meses anteriores con datos (máximo 3)
  if (day >= 10) {
    const prevTotals = [1, 2, 3].map(n => { const pm = prevMonth(ym, n); return monthView(data, pm + '-15').spent; }).filter(x => x > 0);
    if (prevTotals.length >= 2) {
      const avg = Math.round(prevTotals.reduce((a, x) => a + x, 0) / prevTotals.length);
      const projected = Math.round(v.spent / day * dim);
      if (projected > avg * 1.2) out.push({ key: `spend:${ym}:high`, level: 'media',
        text: `Este mes vas camino de gastar ${eur(projected)}, un ${pct(projected - avg, avg)}% más que tu media (${eur(avg)}).` });
    }
  }
  if (day >= 20) {
    const goals = await getKV(uid, kGoals(uid), []);
    for (const g of goals) {
      const p = goalProgress(g, today);
      if (p.needMonthly && p.thisMonth < p.needMonthly)
        out.push({ key: `goal:${g.id || g.name}:${ym}`, level: 'media', text: `🎯 "${g.name}": este mes llevas ${eur(p.thisMonth)} de ${eur(p.needMonthly)} necesarios. Te faltan ${eur(p.needMonthly - p.thisMonth)}.` });
    }
  }
  return out;
}

async function actAlerts(uid, b, today) {
  const all = await computeAlerts(uid, today);
  let fresh = all;
  if (!b.all) {
    const sent = await sb(`notifications_sent?select=key&user_id=eq.${uid}`) || [];
    const seen = new Set(sent.map(x => x.key));
    fresh = all.filter(a => !seen.has(a.key));
    if (fresh.length) await sb('notifications_sent?on_conflict=user_id,key', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
      body: fresh.map(a => ({ user_id: uid, key: a.key })) });
  }
  return ok(fresh.length ? fresh.map(a => a.text).join('\n') : 'Sin novedades.', { alerts: fresh, total_active: all.length });
}

// Deshace lo último que apuntó Instinct (gasto, ingreso o ahorro) en las últimas 24 h
async function actUndo(uid, b) {
  const since = Date.now() - 24 * 3600000;
  const data = await getExpenses(uid);
  const goals = await getKV(uid, kGoals(uid), []);
  const cands = [];
  for (const [k, m] of Object.entries(data)) (m.items || []).forEach((i, idx) => {
    if (i.source === 'instinct' && i.created_at && Date.parse(i.created_at) >= since && (!b.id || i.id === b.id)) cands.push({ kind: 'item', k, idx, at: Date.parse(i.created_at), x: i });
  });
  goals.forEach(g => (g.contribs || []).forEach((c, idx) => {
    if (c.source === 'instinct' && c.created_at && Date.parse(c.created_at) >= since && (!b.id || c.id === b.id)) cands.push({ kind: 'contrib', g, idx, at: Date.parse(c.created_at), x: c });
  }));
  if (!cands.length) return ok('No hay nada que deshacer de las últimas 24 horas.', {});
  const last = cands.sort((a, z) => z.at - a.at)[0];
  if (last.kind === 'item') {
    data[last.k].items.splice(last.idx, 1); recomputeMonth(data[last.k]); await putExpenses(uid, data);
    return ok(`↩︎ Deshecho: ${eur(C(last.x.amount))}${last.x.isIncome ? ' de ingreso' : ` en ${last.x.category}`}${last.x.concept && last.x.concept !== last.x.category ? ` (${last.x.concept})` : ''} del ${last.x.date}.`, { id: last.x.id });
  }
  last.g.contribs.splice(last.idx, 1);
  last.g.current = Math.round((C(last.g.current) - C(last.x.amount))) / 100;
  await putKV(uid, kGoals(uid), goals);
  return ok(`↩︎ Deshecho: ${eur(C(last.x.amount))} apartados para "${last.g.name}". Ahora llevas ${eur(C(last.g.current))}.`, { id: last.x.id });
}

async function actRecent(uid) {
  const data = await getExpenses(uid);
  const all = [];
  for (const m of Object.values(data)) (m.items || []).forEach(i => all.push(i));
  all.sort((a, z) => String(z.created_at || z.date).localeCompare(String(a.created_at || a.date)));
  const rows = all.slice(0, 8);
  if (!rows.length) return ok('Aún no hay movimientos.', { rows: [] });
  return ok(rows.map(i => `${String(i.date).slice(8, 10)}/${String(i.date).slice(5, 7)} ${i.isIncome ? '+' : '−'}${eur(C(i.amount))} ${i.category || ''}${i.concept && i.concept !== i.category ? ` · ${i.concept}` : ''}`).join('\n'), { rows });
}


// ═══ Activos: efectivo, bolsa, fondos, private equity, inmobiliario, otros ══════════
// Se escriben en `blocks` y `pe_transactions`, con el mismo formato que la app.
const ASSET_TYPES = { cash: 'Efectivo', bolsa: 'Bolsa', fondos: 'Fondos', pe: 'Private equity', inmobiliario: 'Inmobiliario', otros: 'Otros' };
const TYPE_SYNONYMS = { efectivo: 'cash', cash: 'cash', cuenta: 'cash', banco: 'cash', liquidez: 'cash',
  bolsa: 'bolsa', acciones: 'bolsa', etf: 'bolsa', etfs: 'bolsa', broker: 'bolsa', fondos: 'fondos', fondo: 'fondos',
  pe: 'pe', 'private equity': 'pe', capital: 'pe', vc: 'pe', 'venture capital': 'pe', scr: 'pe',
  inmobiliario: 'inmobiliario', 'real estate': 'inmobiliario', crowdfunding: 'inmobiliario', urbanitae: 'inmobiliario', piso: 'inmobiliario',
  otros: 'otros', otro: 'otros', cripto: 'otros' };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function getBlocks(uid) {
  return await sb(`blocks?select=*&user_id=eq.${uid}&deleted=eq.false&order=created_at.asc`) || [];
}
async function saveBlockRow(b) {
  const patch = { name: b.name, value: b.value, eur_value: b.eur_value, currency: b.currency || 'EUR', notes: b.notes || '',
                  extra: b.extra || {}, deleted: !!b.deleted, updated_at: new Date().toISOString() };
  await sb(`blocks?id=eq.${q(b.id)}&user_id=eq.${q(b.user_id)}`, { method: 'PATCH', body: patch });
}
async function getTxs(uid, blockId) {
  return await sb(`pe_transactions?select=*&user_id=eq.${uid}&block_id=eq.${q(blockId)}`) || [];
}
// Busca un activo por nombre aproximado ("Inveready FG II CP" → "Inveready Full Global II Coinversión Plus…")
function findAsset(blocks, query, type) {
  const pool = type ? blocks.filter(b => b.type === type) : blocks;
  if (!query) return pool.length === 1 ? { b: pool[0] } : { many: pool };
  const nq = norm(query).replace(/[^a-z0-9 ]/g, ' ');
  const exact = pool.find(b => norm(b.name) === norm(query) || b.id === query);
  if (exact) return { b: exact };
  const words = nq.split(/\s+/).filter(w => w.length >= 2);
  const scored = pool.map(b => {
    const nb = norm(b.name).replace(/[^a-z0-9 ]/g, ' ');
    return { b, score: words.filter(w => nb.includes(w)).length };
  }).filter(x => x.score > 0).sort((a, z) => z.score - a.score);
  if (!scored.length) return { none: true, pool };
  if (scored.length > 1 && scored[0].score === scored[1].score) return { many: scored.filter(x => x.score === scored[0].score).map(x => x.b) };
  return { b: scored[0].b };
}
function assetNotFound(r, query, blocks) {
  if (r.many && r.many.length) return bad(`Hay varios activos que encajan con "${query || ''}": ${r.many.map(b => b.name).join(' · ')}. ¿Cuál?`);
  return bad(`No encuentro el activo "${query || ''}". Tus activos: ${blocks.map(b => b.name).join(' · ') || 'ninguno'}.`);
}

// ── Private equity: misma lógica que la app (recomputePE) ──
function sumTx(txs, kind, afterDate, uptoDate) {
  return txs.filter(t => t.kind === kind && (!afterDate || t.date > afterDate) && (!uptoDate || t.date <= uptoDate))
            .reduce((a, t) => a + (Number(t.amount) || 0), 0);
}
function dayBefore(iso) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
export function recomputePE(b, txs) {
  if (!b || b.type !== 'pe') return;
  const ex = b.extra = b.extra || {};
  if (ex.called_base === undefined) {   // migración desde totales guardados
    ex.called_base      = Math.max(0, r2((Number(ex.called) || 0)      - sumTx(txs, 'call')));
    ex.distributed_base = Math.max(0, r2((Number(ex.distributed) || 0) - sumTx(txs, 'distribution')));
    ex.committed_base   = Math.max(0, r2((Number(ex.committed) || 0)   - sumTx(txs, 'commitment')));
    if (typeof ex.nav_official !== 'number') {
      ex.nav_official = Math.max(0, r2((Number(b.eur_value || b.value) || 0) - (Number(ex.nav_adjustments) || 0)));
      ex.nav_date = ex.nav_adjusted_since ? dayBefore(ex.nav_adjusted_since) : String(b.updated_at || new Date().toISOString()).slice(0, 10);
    }
    delete ex.nav_adjustments; delete ex.nav_adjusted_since;
  }
  ex.called      = r2(ex.called_base      + sumTx(txs, 'call'));
  ex.distributed = r2(ex.distributed_base + sumTx(txs, 'distribution'));
  ex.committed   = r2(ex.committed_base   + sumTx(txs, 'commitment'));
  if (!b.currency || b.currency === 'EUR') {
    const v = typeof ex.nav_official === 'number'
      ? ex.nav_official + sumTx(txs, 'call', ex.nav_date) - sumTx(txs, 'distribution', ex.nav_date)
      : ex.called - ex.distributed;
    b.value = b.eur_value = Math.max(0, r2(v));
  }
}
function peLine(b) {
  const ex = b.extra || {}, called = C(ex.called), dist = C(ex.distributed), val = C(b.eur_value || b.value), comm = C(ex.committed);
  const m = (x) => called > 0 ? (x / called).toFixed(2).replace('.', ',') + 'x' : '—';
  return { called, dist, val, comm, pending: Math.max(0, comm - called),
    text: `Comprometido ${eur(comm)} · desembolsado ${eur(called)}${comm ? ` (${pct(called, comm)}%)` : ''} · pendiente ${eur(Math.max(0, comm - called))} · distribuido ${eur(dist)} · valor ${eur(val)} · TVPI ${m(dist + val)} · DPI ${m(dist)} · RVPI ${m(val)}` };
}

async function actPeFlow(uid, b0, today, kind) {
  const blocks = await getBlocks(uid);
  const r = findAsset(blocks, b0.asset || b0.fund, 'pe');
  if (!r.b) return assetNotFound(r, b0.asset || b0.fund, blocks.filter(x => x.type === 'pe'));
  const b = r.b;
  const cents = toCents(b0.amount);
  if (!cents || cents <= 0) return bad('Necesito el importe.');
  const date = parseDate(b0.date, today);
  if (!date || date > today) return bad('Fecha no válida. Usa "hoy", "ayer" o DD/MM/AAAA.');
  const amount = cents / 100;
  const txs = await getTxs(uid, b.id);
  recomputePE(b, txs);
  const before = peLine(b);
  const label = kind === 'call' ? 'capital call' : kind === 'distribution' ? 'distribución' : 'ampliación de compromiso';
  if (b0.request_id && txs.some(t => String(t.note || '').includes(`[req:${b0.request_id}]`)))
    return ok(`Ya lo tenía registrado. ${b.name}: ${before.text}.`, { duplicate: true });
  const dup = txs.find(t => t.kind === kind && Math.abs(Number(t.amount) - amount) < 0.01 && t.date === date);
  if (dup && !b0.confirm)
    return ok(`⚠ Ya hay registrado un ${label} de ${eur(cents)} del ${date} en ${b.name}. Si es OTRO distinto, confírmamelo y lo apunto; si es el mismo, no hago nada.`, { needs_confirmation: true });
  const note = `Instinct · ${new Date().toISOString()}${b0.note ? ' · ' + String(b0.note).slice(0, 80) : ''}${b0.request_id ? ` [req:${b0.request_id}]` : ''}`;
  const ins = await sb('pe_transactions', { method: 'POST', prefer: 'return=representation',
    body: { user_id: uid, block_id: b.id, kind, amount, date, note } });
  txs.push(ins && ins[0] ? ins[0] : { kind, amount, date, note });
  recomputePE(b, txs);
  await saveBlockRow(b);
  const after = peLine(b);
  let msg = `✓ ${label[0].toUpperCase() + label.slice(1)} de ${eur(cents)} registrado en ${b.name} (${date}).`;
  if (kind === 'call') msg += ` Desembolsado ${eur(before.called)} → ${eur(after.called)} · pendiente ${eur(before.pending)} → ${eur(after.pending)} · valor ${eur(before.val)} → ${eur(after.val)}.`;
  else if (kind === 'distribution') msg += ` Distribuido ${eur(before.dist)} → ${eur(after.dist)} · valor ${eur(before.val)} → ${eur(after.val)}.`;
  else msg += ` Comprometido ${eur(before.comm)} → ${eur(after.comm)} · pendiente ${eur(after.pending)}.`;
  if (after.comm && after.called > after.comm) msg += ` ⚠ El desembolsado supera el compromiso total: revisa los movimientos.`;
  return ok(msg, { asset: b.name, called: after.called / 100, pending: after.pending / 100, value: after.val / 100 });
}

async function actPeNav(uid, b0, today) {
  const blocks = await getBlocks(uid);
  const r = findAsset(blocks, b0.asset || b0.fund, 'pe');
  if (!r.b) return assetNotFound(r, b0.asset || b0.fund, blocks.filter(x => x.type === 'pe'));
  const b = r.b, cents = toCents(b0.nav ?? b0.value);
  if (cents === null || cents < 0) return bad('Necesito el NAV (valor de tu posición) en euros.');
  const date = parseDate(b0.date, today);
  if (!date || date > today) return bad('Fecha del NAV no válida.');
  const txs = await getTxs(uid, b.id);
  recomputePE(b, txs);
  const before = peLine(b);
  b.extra.nav_official = cents / 100; b.extra.nav_date = date; b.extra.nav_source = 'informe';
  recomputePE(b, txs);
  await saveBlockRow(b);
  const after = peLine(b);
  return ok(`✓ NAV de ${b.name}: ${eur(cents)} a ${date}. Valor ${eur(before.val)} → ${eur(after.val)}. ${after.text}.`, { value: after.val / 100 });
}

async function actPeStatus(uid, b0) {
  const blocks = await getBlocks(uid);
  const pes = blocks.filter(x => x.type === 'pe');
  const target = b0.asset || b0.fund ? findAsset(blocks, b0.asset || b0.fund, 'pe') : null;
  const list = target ? (target.b ? [target.b] : null) : pes;
  if (!list) return assetNotFound(target, b0.asset || b0.fund, pes);
  if (!list.length) return ok('No tienes inversiones de private equity.', {});
  const lines = [];
  for (const b of list) { recomputePE(b, await getTxs(uid, b.id)); lines.push(`*${b.name}*\n${peLine(b).text}`); }
  return ok(lines.join('\n\n'), {});
}

// ── Lista, alta, actualización y archivo de activos ──
async function actAssets(uid) {
  const blocks = await getBlocks(uid);
  if (!blocks.length) return ok('Aún no tienes activos en Orbit.', { assets: [] });
  const total = blocks.reduce((a, b) => a + C(b.eur_value || b.value), 0);
  const lines = [`Patrimonio: ${eur(total)}`];
  for (const b of blocks) {
    let t = `• ${b.name} (${ASSET_TYPES[b.type] || b.type}): ${eur(C(b.eur_value || b.value))}`;
    if (b.type === 'pe') { const ex = b.extra || {}; t += ` · desembolsado ${eur(C(ex.called))} de ${eur(C(ex.committed))}`; }
    if (b.type === 'bolsa') t += ` · ${((b.extra || {}).positions || []).filter(p => !p.deleted).length} posiciones`;
    lines.push(t);
  }
  return ok(lines.join('\n'), { assets: blocks.map(b => ({ id: b.id, name: b.name, type: b.type, value: Number(b.eur_value || b.value) || 0 })) });
}

async function actAddAsset(uid, b0, today) {
  const type = TYPE_SYNONYMS[norm(b0.type)] || (ASSET_TYPES[b0.type] ? b0.type : null);
  if (!type) return bad(`Tipo de activo no válido. Usa: ${Object.values(ASSET_TYPES).join(', ')}.`);
  const name = String(b0.name || '').trim().slice(0, 120);
  if (!name) return bad('¿Qué nombre le pongo al activo?');
  const blocks = await getBlocks(uid);
  if (blocks.some(x => norm(x.name) === norm(name))) return bad(`Ya tienes un activo llamado "${name}". Si quieres cambiar su valor, pídeme que lo actualice.`);
  const valueC = b0.value !== undefined ? toCents(b0.value) : 0;
  if (valueC === null || valueC < 0) return bad('Valor no válido.');
  const currency = String(b0.currency || 'EUR').toUpperCase().slice(0, 3);
  const extra = {};
  if (type === 'pe') {
    const comm = toCents(b0.committed ?? b0.commitment ?? 0) || 0;
    Object.assign(extra, { committed_base: comm / 100, called_base: (toCents(b0.called ?? 0) || 0) / 100, distributed_base: 0,
      gp: String(b0.gp || '').slice(0, 80), vintage: String(b0.vintage || '').slice(0, 10) });
    if (b0.value !== undefined) Object.assign(extra, { nav_official: valueC / 100, nav_date: today, nav_source: 'manual' });
  }
  if (type === 'bolsa') extra.positions = [];
  const row = { user_id: uid, type, name, value: valueC / 100, eur_value: valueC / 100, currency, notes: String(b0.notes || '').slice(0, 500), extra, deleted: false };
  const ins = await sb('blocks', { method: 'POST', prefer: 'return=representation', body: row });
  const b = ins[0];
  if (type === 'pe') { recomputePE(b, []); await saveBlockRow(b); }
  let msg = `✓ Activo creado: ${b.name} (${ASSET_TYPES[type]}), valor ${eur(C(b.eur_value))}.`;
  if (type === 'pe') msg += ` ${peLine(b).text}.`;
  return ok(msg, { id: b.id });
}

async function actUpdateAsset(uid, b0, today) {
  const blocks = await getBlocks(uid);
  const r = findAsset(blocks, b0.asset || b0.name_current || b0.name, null);
  if (!r.b) return assetNotFound(r, b0.asset || b0.name, blocks);
  const b = r.b, changes = [];
  if (b0.new_name) { const nn = String(b0.new_name).trim().slice(0, 120); if (nn) { changes.push(`nombre → ${nn}`); b.name = nn; } }
  if (b0.value !== undefined) {
    const c = toCents(b0.value);
    if (c === null || c < 0) return bad('Valor no válido.');
    if (b.type === 'bolsa' && ((b.extra || {}).positions || []).length)
      return bad(`El valor de ${b.name} sale de sus posiciones. Para cambiarlo, apunta compras, ventas o actualiza precios.`);
    if (b.type === 'pe') {
      const txs = await getTxs(uid, b.id); recomputePE(b, txs);
      b.extra.nav_official = c / 100; b.extra.nav_date = today; b.extra.nav_source = 'manual';
      recomputePE(b, txs);
    } else { b.value = b.eur_value = c / 100; }
    changes.push(`valor → ${eur(c)}`);
  }
  if (b0.notes !== undefined) { b.notes = String(b0.notes).slice(0, 500); changes.push('notas'); }
  // Private equity: corregir los TOTALES reales (como el botón Editar de la app). El saldo inicial se
  // calcula restando los movimientos registrados, para que los futuros capital calls sumen bien.
  if (b.type === 'pe' && (b0.called !== undefined || b0.distributed !== undefined || b0.committed !== undefined)) {
    const txs = await getTxs(uid, b.id); recomputePE(b, txs);
    for (const [k, base, kind, label] of [['called','called_base','call','desembolsado'], ['distributed','distributed_base','distribution','distribuido'], ['committed','committed_base','commitment','comprometido']]) {
      if (b0[k] === undefined) continue;
      const c = toCents(b0[k]); if (c === null || c < 0) return bad(`Importe de ${label} no válido.`);
      b.extra[base] = Math.max(0, r2(c / 100 - sumTx(txs, kind)));
      changes.push(`${label} total → ${eur(c)}`);
    }
    recomputePE(b, txs);
    const pl = peLine(b);
    if (pl.comm && pl.called > pl.comm) changes.push('⚠ el desembolsado supera el compromiso');
  }
  if (!changes.length) return bad('¿Qué quieres cambiar? Puedo actualizar el valor, el nombre, las notas y, en private equity, el desembolsado, distribuido o comprometido total.');
  await saveBlockRow(b);
  return ok(`✓ ${b.name} actualizado: ${changes.join(', ')}.`, { id: b.id });
}

async function actArchiveAsset(uid, b0) {
  const blocks = await getBlocks(uid);
  const r = findAsset(blocks, b0.asset || b0.name, null);
  if (!r.b) return assetNotFound(r, b0.asset || b0.name, blocks);
  if (!b0.confirm) return ok(`⚠ ¿Seguro que quieres archivar ${r.b.name} (${eur(C(r.b.eur_value || r.b.value))})? Dejará de contar en tu patrimonio. Confírmamelo y lo hago.`, { needs_confirmation: true });
  r.b.deleted = true; await saveBlockRow(r.b);
  return ok(`✓ ${r.b.name} archivado. Ya no cuenta en tu patrimonio.`, { id: r.b.id });
}

// ── Bolsa: posiciones dentro de la cuenta (igual que la app) ──
async function fxToEur(currencies) {
  const need = [...new Set(currencies.filter(c => c && c !== 'EUR'))];
  if (!need.length) return { EUR: 1 };
  const r = await fetch(`https://api.frankfurter.app/latest?from=EUR&to=${need.join(',')}`);
  if (!r.ok) throw new Error('No se pudo obtener el tipo de cambio del BCE');
  const j = await r.json(), out = { EUR: 1 };
  for (const c of need) { if (!j.rates || !j.rates[c]) throw new Error(`Sin tipo de cambio para ${c}`); out[c] = 1 / j.rates[c]; }   // 1 unidad de c en euros
  return out;
}
async function recalcBolsa(b) {
  const pos = (b.extra.positions || []).filter(p => !p.deleted);
  const fx = await fxToEur(pos.map(p => p.priceCurrency || p.currency || 'EUR'));
  let total = 0;
  for (const p of pos) {
    if (p.isRoboAdvisor) { total += Number(p.value) || 0; continue; }
    const ccy = p.priceCurrency || p.currency || 'EUR';
    p.valueNative = r2((Number(p.lastPrice) || Number(p.entry) || 0) * (Number(p.qty) || 0));
    p.value = Math.round(p.valueNative * (fx[ccy] || 1));
    total += p.valueNative * (fx[ccy] || 1);
  }
  b.value = b.eur_value = Math.round(total);
  b.currency = 'EUR';
}
function pickBroker(blocks, query) {
  const bolsas = blocks.filter(x => x.type === 'bolsa');
  if (query) return findAsset(blocks, query, 'bolsa');
  return bolsas.length === 1 ? { b: bolsas[0] } : bolsas.length ? { many: bolsas } : { none: true };
}

async function actTradeBolsa(uid, b0, today, type) {
  const blocks = await getBlocks(uid);
  const r = pickBroker(blocks, b0.asset || b0.account);
  if (!r.b) return r.none ? bad('No tienes ninguna cuenta de bolsa. Crea una primero, por ejemplo: "crea un activo de bolsa llamado Revolut".')
                          : assetNotFound(r, b0.asset || b0.account, blocks.filter(x => x.type === 'bolsa'));
  const b = r.b; b.extra = b.extra || {}; b.extra.positions = b.extra.positions || [];
  const ticker = String(b0.ticker || '').toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 16);
  const isin = String(b0.isin || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
  if (!ticker && !isin) return bad('Necesito el ticker (por ejemplo, VUAA) o el ISIN.');
  const qty = Number(String(b0.qty ?? '').replace(',', '.'));
  const priceC = toCents(b0.price), feeC = toCents(b0.fees ?? 0) || 0;
  if (!(qty > 0)) return bad('Necesito el número de títulos.');
  if (!priceC || priceC <= 0) return bad('Necesito el precio por título.');
  const date = parseDate(b0.date, today);
  if (!date || date > today) return bad('Fecha no válida.');
  const price = priceC / 100;
  const p = b.extra.positions.find(x => !x.deleted && ((ticker && String(x.ticker || '').toUpperCase() === ticker) || (isin && String(x.isin || '').toUpperCase() === isin)));
  const ccy = String(b0.currency || (p && (p.priceCurrency || p.currency)) || 'EUR').toUpperCase().slice(0, 3);
  let msg;
  if (type === 'buy') {
    if (p) {
      const q0 = Number(p.qty) || 0, cost0 = q0 * (Number(p.entry) || 0);
      p.qty = Math.round((q0 + qty) * 1e8) / 1e8;
      p.entry = Math.round(((cost0 + qty * price + feeC / 100) / p.qty) * 10000) / 10000;
      if (!p.lastPrice) p.lastPrice = price;
      msg = `✓ Compra de ${qty.toLocaleString('es-ES', { maximumFractionDigits: 6 })} ${p.ticker} a ${money(priceC, ccy)}. Ahora tienes ${p.qty.toLocaleString('es-ES', { maximumFractionDigits: 6 })} títulos, coste medio ${money(Math.round(p.entry * 100), ccy)}.`;
    } else {
      b.extra.positions.push({ ticker: ticker || isin, name: String(b0.name || ticker || isin).slice(0, 80), isin, sector: '',
        qty, entry: Math.round(((qty * price + feeC / 100) / qty) * 10000) / 10000, lastPrice: price, currency: ccy, priceCurrency: ccy,
        type: String(b0.kind || 'EQUITY').toUpperCase() === 'ETF' ? 'ETF' : 'EQUITY' });
      msg = `✓ Nueva posición: ${qty.toLocaleString('es-ES', { maximumFractionDigits: 6 })} ${ticker || isin} a ${money(priceC, ccy)}.`;
    }
  } else {
    if (!p) return bad(`No tienes ${ticker || isin} en ${b.name}.`);
    const q0 = Number(p.qty) || 0;
    if (qty > q0 + 1e-9) return bad(`Solo tienes ${q0.toLocaleString('es-ES', { maximumFractionDigits: 6 })} ${p.ticker}.`);
    const gain = Math.round((price - (Number(p.entry) || 0)) * qty * 100 - feeC);
    p.qty = Math.round((q0 - qty) * 1e8) / 1e8;
    if (p.qty <= 1e-8) b.extra.positions = b.extra.positions.filter(x => x !== p);
    msg = `✓ Venta de ${qty.toLocaleString('es-ES', { maximumFractionDigits: 6 })} ${p.ticker} a ${money(priceC, ccy)}. Resultado aproximado: ${gain >= 0 ? '+' : ''}${money(gain, ccy)} (sobre coste medio; para Hacienda cuenta el orden FIFO).${p.qty > 1e-8 ? ` Te quedan ${p.qty.toLocaleString('es-ES', { maximumFractionDigits: 6 })}.` : ' Posición cerrada.'}`;
  }
  await recalcBolsa(b);
  await saveBlockRow(b);
  try { await addMovement(uid, { type, date, amount: r2((type === 'buy' ? qty * price + feeC / 100 : qty * price - feeC / 100)), ticker: ticker || null, isin, qty, price, currency: ccy,
    concept: `${type === 'buy' ? 'Compra' : 'Venta'} ${ticker || isin}`, request_id: b0.request_id || null }); } catch (e) { console.error('[instinct] historial de operaciones:', e); }
  return ok(`${msg} Valor de ${b.name}: ${eur(C(b.eur_value))}.`, { account: b.name, value: Number(b.eur_value) });
}

async function actSetPrice(uid, b0) {
  const blocks = await getBlocks(uid);
  const r = pickBroker(blocks, b0.asset || b0.account);
  if (!r.b) return assetNotFound(r, b0.asset || b0.account, blocks.filter(x => x.type === 'bolsa'));
  const b = r.b, ticker = String(b0.ticker || '').toUpperCase();
  const p = ((b.extra || {}).positions || []).find(x => !x.deleted && String(x.ticker || '').toUpperCase() === ticker);
  if (!p) return bad(`No tienes ${ticker} en ${b.name}.`);
  const c = toCents(b0.price); if (!c || c <= 0) return bad('Precio no válido.');
  p.lastPrice = c / 100;
  await recalcBolsa(b); await saveBlockRow(b);
  return ok(`✓ Precio de ${ticker}: ${money(c, p.priceCurrency || 'EUR')}. Valor de ${b.name}: ${eur(C(b.eur_value))}.`, {});
}

async function actPositions(uid, b0) {
  const blocks = await getBlocks(uid);
  const list = (b0.asset || b0.account) ? [findAsset(blocks, b0.asset || b0.account, 'bolsa').b].filter(Boolean) : blocks.filter(x => x.type === 'bolsa');
  if (!list.length) return ok('No tienes cuentas de bolsa.', {});
  const lines = [];
  for (const b of list) {
    lines.push(`*${b.name}*: ${eur(C(b.eur_value || b.value))}`);
    for (const p of ((b.extra || {}).positions || []).filter(x => !x.deleted)) {
      const ccy = p.priceCurrency || p.currency || 'EUR', cost = (Number(p.entry) || 0) * (Number(p.qty) || 0), mkt = (Number(p.lastPrice) || 0) * (Number(p.qty) || 0);
      const pl = cost > 0 ? Math.round((mkt / cost - 1) * 1000) / 10 : null;
      lines.push(`• ${p.ticker}: ${(Number(p.qty) || 0).toLocaleString('es-ES', { maximumFractionDigits: 4 })} títulos · ${eur(C(p.value))}${pl !== null ? ` · ${pl >= 0 ? '+' : ''}${String(pl).replace('.', ',')}%${ccy !== 'EUR' ? ` (en ${ccy})` : ''}` : ''}`);
    }
  }
  return ok(lines.join('\n'), {});
}


// ═══ Editar y borrar ═══════════════════════════════════════════════════════
async function actEditPosition(uid, b0) {
  const blocks = await getBlocks(uid);
  const r = pickBroker(blocks, b0.asset || b0.account);
  if (!r.b) return assetNotFound(r, b0.asset || b0.account, blocks.filter(x => x.type === 'bolsa'));
  const b = r.b, ticker = String(b0.ticker || '').toUpperCase();
  const p = ((b.extra || {}).positions || []).find(x => !x.deleted && String(x.ticker || '').toUpperCase() === ticker);
  if (!p) return bad(`No tienes ${ticker} en ${b.name}.`);
  const ch = [];
  if (b0.qty !== undefined) { const q2 = Number(String(b0.qty).replace(',', '.')); if (!(q2 > 0)) return bad('Cantidad no válida.'); p.qty = q2; ch.push(`títulos → ${q2.toLocaleString('es-ES', { maximumFractionDigits: 6 })}`); }
  if (b0.entry !== undefined) { const c = toCents(b0.entry); if (!c || c <= 0) return bad('Coste medio no válido.'); p.entry = c / 100; ch.push(`coste medio → ${eur(c)}`); }
  if (b0.price !== undefined) { const c = toCents(b0.price); if (!c || c <= 0) return bad('Precio no válido.'); p.lastPrice = c / 100; ch.push(`precio → ${eur(c)}`); }
  if (b0.name) { p.name = String(b0.name).slice(0, 80); ch.push('nombre'); }
  if (b0.currency) { p.currency = p.priceCurrency = String(b0.currency).toUpperCase().slice(0, 3); ch.push(`divisa → ${p.currency}`); }
  if (!ch.length) return bad('¿Qué cambio? Puedo editar títulos, coste medio, precio, nombre o divisa.');
  await recalcBolsa(b); await saveBlockRow(b);
  return ok(`✓ ${ticker} actualizado: ${ch.join(', ')}. Valor de ${b.name}: ${eur(C(b.eur_value))}.`, {});
}

async function actDeletePosition(uid, b0) {
  const blocks = await getBlocks(uid);
  const r = pickBroker(blocks, b0.asset || b0.account);
  if (!r.b) return assetNotFound(r, b0.asset || b0.account, blocks.filter(x => x.type === 'bolsa'));
  const b = r.b, ticker = String(b0.ticker || '').toUpperCase();
  const p = ((b.extra || {}).positions || []).find(x => !x.deleted && String(x.ticker || '').toUpperCase() === ticker);
  if (!p) return bad(`No tienes ${ticker} en ${b.name}.`);
  if (!b0.confirm) return ok(`⚠ ¿Seguro que quieres eliminar la posición ${ticker} (${eur(C(p.value))}) de ${b.name}? Si la has vendido, mejor apunta la venta. Confírmamelo y la elimino.`, { needs_confirmation: true });
  b.extra.positions = b.extra.positions.filter(x => x !== p);
  await recalcBolsa(b); await saveBlockRow(b);
  return ok(`✓ Posición ${ticker} eliminada. Valor de ${b.name}: ${eur(C(b.eur_value))}.`, {});
}

// Busca un gasto o ingreso por concepto, importe y/o fecha
function findItems(data, b0) {
  const cents = b0.amount !== undefined ? toCents(b0.amount) : null;
  const date = b0.date ? parseDate(b0.date, madridToday()) : null;
  const nq = norm(b0.concept || '');
  const out = [];
  for (const [k, m] of Object.entries(data)) (m.items || []).forEach((i, idx) => {
    if (cents !== null && C(i.amount) !== cents) return;
    if (date && i.date !== date) return;
    if (nq && !norm(i.concept).includes(nq) && !norm(i.category).includes(nq)) return;
    out.push({ k, idx, i });
  });
  return out.sort((a, z) => String(z.i.date).localeCompare(String(a.i.date)));
}
async function actEditExpense(uid, b0) {
  const data = await getExpenses(uid);
  const f = findItems(data, b0.match || b0);
  if (!f.length) return bad('No encuentro ese movimiento. Dime el concepto, el importe o la fecha.');
  if (f.length > 1) return bad(`Hay ${f.length} que encajan: ${f.slice(0, 4).map(x => `${x.i.date} ${eur(C(x.i.amount))} ${x.i.concept}`).join(' · ')}. Dime cuál (fecha o importe).`);
  const { k, i } = f[0], ch = [];
  if (b0.new_amount !== undefined) { const c = toCents(b0.new_amount); if (!c || c <= 0) return bad('Importe no válido.'); i.amount = c / 100; ch.push(`importe → ${eur(c)}`); }
  if (b0.new_category) { const cat = resolveCategory(b0.new_category, ''); const ci = catInfo(cat); i.category = cat; i.icon = ci.icon; i.color = ci.color; ch.push(`categoría → ${cat}`); }
  if (b0.new_concept) { i.concept = String(b0.new_concept).slice(0, 80); ch.push(`concepto → ${i.concept}`); }
  if (b0.new_date) { const d = parseDate(b0.new_date, madridToday()); if (!d) return bad('Fecha no válida.'); i.date = d; ch.push(`fecha → ${d}`); }
  if (!ch.length) return bad('¿Qué cambio? Puedo editar importe, categoría, concepto o fecha.');
  i.updated_at = new Date().toISOString();
  recomputeMonth(data[k]); await putExpenses(uid, data);
  return ok(`✓ Movimiento editado: ${ch.join(', ')}.`, {});
}
async function actDeleteExpense(uid, b0) {
  const data = await getExpenses(uid);
  const f = findItems(data, b0);
  if (!f.length) return bad('No encuentro ese movimiento. Dime el concepto, el importe o la fecha.');
  if (f.length > 1) return bad(`Hay ${f.length} que encajan: ${f.slice(0, 4).map(x => `${x.i.date} ${eur(C(x.i.amount))} ${x.i.concept}`).join(' · ')}. Dime cuál (fecha o importe).`);
  const { k, idx, i } = f[0];
  if (!b0.confirm) return ok(`⚠ ¿Borro ${eur(C(i.amount))} de ${i.concept} (${i.date})? Confírmamelo.`, { needs_confirmation: true });
  data[k].items.splice(idx, 1); recomputeMonth(data[k]); await putExpenses(uid, data);
  return ok(`✓ Borrado: ${eur(C(i.amount))} de ${i.concept} (${i.date}).`, {});
}

async function actPeDeleteMovement(uid, b0) {
  const blocks = await getBlocks(uid);
  const r = findAsset(blocks, b0.asset || b0.fund, 'pe');
  if (!r.b) return assetNotFound(r, b0.asset || b0.fund, blocks.filter(x => x.type === 'pe'));
  const b = r.b, txs = await getTxs(uid, b.id);
  const kind = b0.kind ? ({ call: 'call', capital_call: 'call', distribucion: 'distribution', distribution: 'distribution', compromiso: 'commitment', commitment: 'commitment' })[norm(b0.kind)] : null;
  const cents = b0.amount !== undefined ? toCents(b0.amount) : null;
  const date = b0.date ? parseDate(b0.date, madridToday()) : null;
  const f = txs.filter(t => (!kind || t.kind === kind) && (cents === null || C(t.amount) === cents) && (!date || t.date === date))
               .sort((a, z) => String(z.date).localeCompare(String(a.date)));
  if (!f.length) return bad(`No encuentro ese movimiento en ${b.name}.`);
  if (f.length > 1 && (cents === null || !date)) return bad(`Hay ${f.length} movimientos que encajan: ${f.slice(0, 5).map(t => `${t.date} ${t.kind} ${eur(C(t.amount))}`).join(' · ')}. Dime fecha e importe.`);
  const t = f[0];
  if (!b0.confirm) return ok(`⚠ ¿Borro el ${t.kind === 'call' ? 'capital call' : t.kind === 'distribution' ? 'reparto' : 'compromiso'} de ${eur(C(t.amount))} del ${t.date} en ${b.name}? Confírmamelo.`, { needs_confirmation: true });
  recomputePE(b, txs); const before = peLine(b);
  await sb(`pe_transactions?id=eq.${q(t.id)}&user_id=eq.${uid}`, { method: 'DELETE' });
  const rest = txs.filter(x => x !== t); recomputePE(b, rest); await saveBlockRow(b);
  const after = peLine(b);
  return ok(`✓ Movimiento borrado. ${b.name}: desembolsado ${eur(before.called)} → ${eur(after.called)} · valor ${eur(before.val)} → ${eur(after.val)}.`, {});
}

// ═══ Documentos ═══════════════════════════════════════════════════════════
// Sube un archivo (base64 o URL) al mismo almacén que la app (wealth-docs) y crea su ficha en `documents`.
const DOC_TYPES = ['report_pe','capital_call','distribution','extracto','boleta','nomina','factura','contrato','otro'];
async function actUploadDocument(uid, b0) {
  const filename = String(b0.filename || '').trim().slice(0, 140);
  if (!filename) return bad('Necesito el nombre del archivo (por ejemplo, capital_call_3.pdf).');
  let bytes, contentType = String(b0.content_type || '').slice(0, 80);
  if (b0.content_base64) {
    try { bytes = Buffer.from(String(b0.content_base64).replace(/^data:[^;]+;base64,/, ''), 'base64'); } catch { return bad('El contenido en base64 no es válido.'); }
  } else if (b0.url && /^https:\/\//.test(b0.url)) {
    const r = await fetch(b0.url);
    if (!r.ok) return bad(`No he podido descargar el archivo (${r.status}).`);
    bytes = Buffer.from(await r.arrayBuffer());
    contentType = contentType || r.headers.get('content-type') || '';
  } else return bad('Envíame el archivo en content_base64 o una URL https.');
  if (!bytes.length) return bad('El archivo está vacío.');
  if (bytes.length > 10 * 1024 * 1024) return bad('El archivo supera 10 MB.');
  if (!contentType) contentType = /\.pdf$/i.test(filename) ? 'application/pdf' : /\.png$/i.test(filename) ? 'image/png' : /\.jpe?g$/i.test(filename) ? 'image/jpeg' : 'application/octet-stream';
  let blockId = null, assetName = null;
  if (b0.asset) {
    const blocks = await getBlocks(uid);
    const r = findAsset(blocks, b0.asset, null);
    if (!r.b) return assetNotFound(r, b0.asset, blocks);
    blockId = r.b.id; assetName = r.b.name;
  }
  const docType = DOC_TYPES.includes(b0.doc_type) ? b0.doc_type : 'otro';
  const path = `${uid}/${Date.now()}_${filename.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
  const up = await fetch(`${SB_URL}/storage/v1/object/wealth-docs/${path}`, { method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': contentType, 'x-upsert': 'false' }, body: bytes });
  if (!up.ok) { const t = await up.text(); return bad(`No he podido guardar el archivo en Orbit (${up.status}): ${t.slice(0, 120)}`); }
  const extracted = (b0.data && typeof b0.data === 'object') ? b0.data : {};
  await sb('documents', { method: 'POST', prefer: 'return=minimal', body: { user_id: uid, filename, doc_type: docType, block_id: blockId,
    extracted_data: { ...extracted, _origen: 'instinct' }, ai_summary: String(b0.summary || '').slice(0, 2000), file_size: bytes.length, storage_path: path } });
  return ok(`✓ Documento guardado en Orbit: ${filename}${assetName ? ` (en ${assetName})` : ''}. Lo verás en Documentos.`, { storage_path: path });
}

// ═══ Noticias de lo que tienes ═══════════════════════════════════════════════
// Solo resultados reales de NewsAPI, con fuente y fecha. Nunca se inventa nada.
const INDEX_NAMES = { VUAA: 'S&P 500', CSPX: 'S&P 500', SXR8: 'S&P 500', SXRT: 'Euro Stoxx 50', EUNM: 'mercados emergentes', IS3N: 'mercados emergentes',
                      WEXE: 'MSCI World', IWDA: 'MSCI World', EUNL: 'MSCI World', '5J50': 'industria de defensa' };
async function actNews(uid, b0) {
  const key = process.env.NEWS_API_KEY;
  if (!key) return bad('Las noticias no están activadas: falta NEWS_API_KEY en Vercel.');
  const blocks = await getBlocks(uid);
  const terms = new Map();   // término de búsqueda → activo
  if (b0.q) terms.set(String(b0.q).slice(0, 80), String(b0.q));
  else {
    for (const b of blocks) {
      if (b.type === 'bolsa') for (const p of ((b.extra || {}).positions || []).filter(x => !x.deleted)) {
        const t = INDEX_NAMES[String(p.ticker || '').toUpperCase()] || String(p.name || p.ticker || '').replace(/\b(inc|corp|corporation|ucits|etf|acc|plc|sa|s\.a\.)\b\.?/gi, '').trim();
        if (t && (!b0.asset || norm(p.ticker) === norm(b0.asset) || norm(t).includes(norm(b0.asset)))) terms.set(t, p.ticker);
      }
      if (b.type === 'pe') { const t = String(b.name).split(/\s+/)[0]; if (t.length > 3 && (!b0.asset || norm(b.name).includes(norm(b0.asset)))) terms.set(t, b.name); }
    }
  }
  if (!terms.size) return ok(b0.asset ? `No encuentro "${b0.asset}" entre tus activos.` : 'No tienes posiciones sobre las que buscar noticias.', { articles: [] });
  const query = [...terms.keys()].slice(0, 8).map(t => `"${t}"`).join(' OR ');
  const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const arts = [];
  for (const lang of ['es', 'en']) {
    const u = new URL('https://newsapi.org/v2/everything');
    u.search = new URLSearchParams({ qInTitle: query, language: lang, from, sortBy: 'publishedAt', pageSize: '10' }).toString();
    const r = await fetch(u, { headers: { 'X-Api-Key': key } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.status === 'error') { console.error('[instinct] NewsAPI', lang, j.code || r.status); continue; }
    for (const a of (j.articles || [])) {
      const title = String(a.title || ''), hit = [...terms.entries()].find(([t]) => norm(title).includes(norm(t)));
      if (hit && a.url && !arts.some(x => x.url === a.url)) arts.push({ title, source: a.source && a.source.name, date: String(a.publishedAt || '').slice(0, 10), url: a.url, about: hit[1] });
    }
  }
  arts.sort((a, z) => z.date.localeCompare(a.date));
  const top = arts.slice(0, Number(b0.limit) > 0 ? Math.min(10, Number(b0.limit)) : 6);
  if (!top.length) return ok('Sin noticias relevantes de tus activos en los últimos 7 días.', { articles: [] });
  return ok(top.map(a => `• [${a.about}] ${a.title} — ${a.source || 'fuente'}, ${a.date.slice(8, 10)}/${a.date.slice(5, 7)}\n  ${a.url}`).join('\n'), { articles: top });
}

const ok = (message, data) => ({ status: 200, body: { ok: true, message: String(message).replace(/(?<!\.)\.\.(?!\.)/g, '.'), data } });
const bad = (message) => ({ status: 400, body: { ok: false, message: String(message).replace(/(?<!\.)\.\.(?!\.)/g, '.') } });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!SB_URL || !SERVICE) return res.status(500).json({ ok: false, message: 'Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE en Vercel.' });
  try {
    const uid = await authenticate(req);
    if (!uid) return res.status(401).json({ ok: false, message: 'Token no válido o revocado.' });
    const body = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})) : (req.query || {});
    const action = String(body.action || '').toLowerCase();
    const today = madridToday();
    const map = {
      expense: () => actItem(uid, body, today, false),
      income: () => actItem(uid, body, today, true),
      set_budget: () => actSetBudget(uid, body, today),
      set_goal: () => actSetGoal(uid, body, today),
      save: () => actSave(uid, body, today),
      buy: () => actTradeBolsa(uid, body, today, 'buy'),
      sell: () => actTradeBolsa(uid, body, today, 'sell'),
      summary: async () => { const s = await buildSummary(uid, today); return ok(s.message, s.data); },
      alerts: () => actAlerts(uid, body, today),
      undo: () => actUndo(uid, body),
      recent: () => actRecent(uid),
      // activos
      assets: () => actAssets(uid),
      add_asset: () => actAddAsset(uid, body, today),
      update_asset: () => actUpdateAsset(uid, body, today),
      archive_asset: () => actArchiveAsset(uid, body),
      // private equity
      pe_call: () => actPeFlow(uid, body, today, 'call'),
      pe_distribution: () => actPeFlow(uid, body, today, 'distribution'),
      pe_commitment: () => actPeFlow(uid, body, today, 'commitment'),
      pe_nav: () => actPeNav(uid, body, today),
      pe_status: () => actPeStatus(uid, body),
      // bolsa
      positions: () => actPositions(uid, body),
      set_price: () => actSetPrice(uid, body),
      edit_position: () => actEditPosition(uid, body),
      delete_position: () => actDeletePosition(uid, body),
      // editar y borrar gastos e ingresos
      edit_expense: () => actEditExpense(uid, body),
      delete_expense: () => actDeleteExpense(uid, body),
      // borrar un movimiento de private equity
      pe_delete_movement: () => actPeDeleteMovement(uid, body),
      // documentos y noticias
      upload_document: () => actUploadDocument(uid, body),
      news: () => actNews(uid, body),
    };
    if (!map[action]) return res.status(400).json({ ok: false, message: `Acción desconocida. Disponibles: ${Object.keys(map).join(', ')}.` });
    if (req.method === 'GET' && !['summary', 'alerts', 'recent', 'assets', 'pe_status', 'positions', 'news'].includes(action)) return res.status(405).json({ ok: false, message: 'Esta acción requiere POST.' });
    const r = await map[action]();
    return res.status(r.status).json(r.body);
  } catch (e) {
    console.error('[instinct]', e);
    return res.status(500).json({ ok: false, message: 'No he podido completarlo por un error del servidor. Antes de repetirlo, pide "últimos movimientos" para comprobar si llegó a guardarse.', error: e.message });
  }
}
