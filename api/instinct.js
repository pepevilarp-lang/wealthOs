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

const ok = (message, data) => ({ status: 200, body: { ok: true, message, data } });
const bad = (message) => ({ status: 400, body: { ok: false, message } });

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
      buy: () => actTrade(uid, body, today, 'buy'),
      sell: () => actTrade(uid, body, today, 'sell'),
      summary: async () => { const s = await buildSummary(uid, today); return ok(s.message, s.data); },
      alerts: () => actAlerts(uid, body, today),
      undo: () => actUndo(uid, body),
      recent: () => actRecent(uid),
    };
    if (!map[action]) return res.status(400).json({ ok: false, message: `Acción desconocida. Disponibles: ${Object.keys(map).join(', ')}.` });
    if (req.method === 'GET' && !['summary', 'alerts', 'recent'].includes(action)) return res.status(405).json({ ok: false, message: 'Esta acción requiere POST.' });
    const r = await map[action]();
    return res.status(r.status).json(r.body);
  } catch (e) {
    console.error('[instinct]', e);
    return res.status(500).json({ ok: false, message: 'No he podido completarlo por un error del servidor. Antes de repetirlo, pide "últimos movimientos" para comprobar si llegó a guardarse.', error: e.message });
  }
}
