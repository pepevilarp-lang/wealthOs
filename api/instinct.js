// /api/instinct.js — Conexión con Instinct (asistente por WhatsApp)
//
// Autenticación: cabecera  Authorization: Bearer <token>   (nunca en la URL)
// Variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_ROLE
//
// Acciones (POST con JSON { action, ... }; summary y alerts también por GET ?action=):
//   expense     { amount, concept?, category?, date?, request_id? }
//   income      { amount, concept?, date?, request_id? }
//   set_budget  { category, limit }
//   set_goal    { name, target, deadline? }
//   save        { goal, amount, date? }           aparta dinero para un objetivo
//   buy | sell  { ticker? isin?, qty, price, fees?, date?, currency? }
//   summary     {}                                 resumen del mes
//   alerts      { all? }                           avisos nuevos (no repite los ya enviados)
//   undo        { id? }                            deshace lo último apuntado por Instinct (24 h)
//   recent      {}                                 últimos movimientos
// Cada respuesta incluye `message`: texto listo para enviar por WhatsApp.

import crypto from 'crypto';

const SB_URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE;
const TZ = 'Europe/Madrid';

export const CATEGORIES = ['Supermercado','Restaurantes','Transporte','Ocio','Compras','Hogar',
  'Suscripciones','Salud','Viajes','Formación','Regalos','Otros'];
const SYNONYMS = {
  supermercado:'Supermercado', super:'Supermercado', mercado:'Supermercado', alimentacion:'Supermercado', compra:'Supermercado',
  restaurante:'Restaurantes', restaurantes:'Restaurantes', comida:'Restaurantes', cena:'Restaurantes', comer:'Restaurantes',
  bar:'Restaurantes', bares:'Restaurantes', cafe:'Restaurantes', copas:'Restaurantes', delivery:'Restaurantes',
  transporte:'Transporte', taxi:'Transporte', gasolina:'Transporte', coche:'Transporte', metro:'Transporte', parking:'Transporte',
  ocio:'Ocio', cine:'Ocio', concierto:'Ocio', fiesta:'Ocio', deporte:'Ocio', gimnasio:'Salud', gym:'Salud',
  compras:'Compras', ropa:'Compras', tecnologia:'Compras', amazon:'Compras',
  hogar:'Hogar', casa:'Hogar', alquiler:'Hogar', luz:'Hogar', agua:'Hogar', internet:'Hogar', movil:'Hogar',
  suscripcion:'Suscripciones', suscripciones:'Suscripciones', netflix:'Suscripciones', spotify:'Suscripciones',
  salud:'Salud', farmacia:'Salud', medico:'Salud', dentista:'Salud',
  viaje:'Viajes', viajes:'Viajes', hotel:'Viajes', vuelo:'Viajes', avion:'Viajes',
  formacion:'Formación', curso:'Formación', libro:'Formación', libros:'Formación',
  regalo:'Regalos', regalos:'Regalos', otros:'Otros', otro:'Otros',
};
// Palabras clave para clasificar por el concepto cuando no llega categoría
const KEYWORDS = [
  ['Supermercado', /mercadona|carrefour|lidl|aldi|dia\b|eroski|consum|caprabo|bonpreu|alcampo|condis|ametller|supermerc/],
  ['Restaurantes', /restaur|cena|comida|almuerzo|desayuno|bar\b|cafe|cafeter|tagliatella|vips|burger|mcdonald|kfc|telepizza|domino|glovo|uber ?eats|just ?eat|deliveroo|tapas|sushi/],
  ['Transporte',   /uber(?! ?eats)|cabify|bolt|taxi|renfe|metro|bus\b|tmb|gasolin|repsol|cepsa|bp\b|parking|peaje|vueling|iryo|ouigo/],
  ['Suscripciones',/netflix|spotify|hbo|max\b|disney|prime video|apple ?one|icloud|youtube premium|chatgpt|claude|suscrip/],
  ['Compras',      /amazon|zara|mango|pull|bershka|primark|el corte ingles|decathlon|fnac|media ?markt|ikea|aliexpress|shein/],
  ['Hogar',        /alquiler|endesa|iberdrola|naturgy|aguas|movistar|vodafone|orange|digi|comunidad/],
  ['Salud',        /farmacia|medic|dentist|fisio|gimnas|gym|optica|clinica|hospital/],
  ['Ocio',         /cine|concierto|entradas|teatro|museo|fiesta|discoteca|steam|playstation|xbox/],
  ['Viajes',       /hotel|airbnb|booking|vuelo|ryanair|iberia|viaje/],
  ['Formación',    /curso|udemy|coursera|libro|academia|master/],
  ['Regalos',      /regalo/],
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
    const exact = CATEGORIES.find(x => norm(x) === c);
    if (exact) return exact;
    if (SYNONYMS[c]) return SYNONYMS[c];
  }
  const text = norm(`${category || ''} ${concept || ''}`);
  for (const [cat, re] of KEYWORDS) if (re.test(text)) return cat;
  return 'Otros';
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

// ── cálculos ────────────────────────────────────────────────────────────
async function monthMovements(uid, ym) {
  const from = `${ym}-01`, to = `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}`;
  return sb(`movements?select=id,date,type,amount,category,concept,goal_id,source,created_at&user_id=eq.${uid}&deleted_at=is.null&date=gte.${from}&date=lte.${to}&order=date.asc`) || [];
}
const sumCents = (rows, pred) => rows.filter(pred).reduce((a, r) => a + Math.round(Number(r.amount) * 100), 0);

async function categoryStatus(uid, category, today) {
  const ym = today.slice(0, 7);
  const rows = await monthMovements(uid, ym);
  const spent = sumCents(rows, r => r.type === 'expense' && r.category === category);
  const total = sumCents(rows, r => r.type === 'expense');
  const b = await sb(`budgets?select=monthly_limit&user_id=eq.${uid}&category=eq.${q(category)}&limit=1`);
  const limit = b && b.length ? Math.round(Number(b[0].monthly_limit) * 100) : null;
  return { ym, spent, total, limit };
}

function paceLine(spent, limit, today) {
  const ym = today.slice(0, 7), day = Number(today.slice(8, 10)), dim = daysInMonth(ym), left = dim - day;
  if (spent >= limit) return `Has superado el límite de ${eur(limit)} en ${eur(spent - limit)}.`;
  const projected = Math.round(spent / day * dim);
  const remain = limit - spent;
  let s = `Te quedan ${eur(remain)} para ${left} día${left === 1 ? '' : 's'}.`;
  if (day >= 5 && projected > limit) s += ` A este ritmo acabarías el mes en ${eur(projected)}.`;
  return s;
}

async function goalProgress(uid, goal, today) {
  const rows = await sb(`movements?select=amount,date&user_id=eq.${uid}&deleted_at=is.null&type=eq.saving&goal_id=eq.${goal.id}`) || [];
  const saved = sumCents(rows, () => true);
  const thisMonth = sumCents(rows, r => r.date.slice(0, 7) === today.slice(0, 7));
  const target = Math.round(Number(goal.target) * 100);
  let needMonthly = null, monthsLeft = null;
  if (goal.deadline) {
    const [ty, tm] = today.slice(0, 7).split('-').map(Number), [gy, gm] = goal.deadline.slice(0, 7).split('-').map(Number);
    monthsLeft = Math.max(1, (gy - ty) * 12 + (gm - tm) + 1);   // incluye el mes en curso
    needMonthly = Math.max(0, Math.ceil((target - (saved - thisMonth)) / monthsLeft));
  }
  return { saved, target, thisMonth, needMonthly, monthsLeft };
}

async function findGoal(uid, nameOrId) {
  const all = await sb(`savings_goals?select=id,name,target,deadline&user_id=eq.${uid}&archived=eq.false`) || [];
  const n = norm(nameOrId);
  return all.find(g => g.id === nameOrId) || all.find(g => norm(g.name) === n) || all.find(g => norm(g.name).includes(n) && n.length >= 3) || null;
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

async function actExpense(uid, b, today) {
  const cents = toCents(b.amount);
  if (!cents || cents <= 0 || cents > 10000000) return bad('Necesito un importe válido (por ejemplo, 45 o 45,50).');
  const date = parseDate(b.date, today);
  if (!date) return bad('No entiendo la fecha. Usa "hoy", "ayer" o DD/MM/AAAA.');
  if (date > today) return bad('La fecha es futura. ¿Seguro? Indica la fecha real del gasto.');
  const category = resolveCategory(b.category, b.concept);
  const concept = String(b.concept || '').slice(0, 140) || null;
  // Aviso de posible repetido (mismo importe y concepto en los últimos 10 minutos)
  const since = new Date(Date.now() - 10 * 60000).toISOString();
  const recent = await sb(`movements?select=id,concept&user_id=eq.${uid}&type=eq.expense&deleted_at=is.null&amount=eq.${cents / 100}&created_at=gte.${q(since)}`) || [];
  const looksRepeated = !b.request_id && recent.some(r => norm(r.concept) === norm(concept));
  const { row, duplicate } = await addMovement(uid, { type: 'expense', date, amount: cents / 100, category, concept, request_id: b.request_id || null });
  let st = null;
  try { st = await categoryStatus(uid, category, today); } catch (e) { console.error('[instinct] estado de categoría:', e); }
  const when = date === today ? 'hoy' : date;
  let msg = `✓ Apuntado: ${eur(cents)} en ${category}${concept ? ` (${concept})` : ''}, ${when}.`;
  if (duplicate) msg = `Ya lo tenía apuntado: ${eur(cents)} en ${category}. No lo he duplicado.`;
  if (!st) msg += ' (Guardado. No he podido calcular el total del mes ahora mismo.)';
  else if (st.limit) msg += ` Llevas ${eur(st.spent)} de ${eur(st.limit)} en ${category} este mes (${pct(st.spent, st.limit)}%). ${paceLine(st.spent, st.limit, today)}`;
  else msg += ` ${category} este mes: ${eur(st.spent)}. Total gastado en ${monthName(st.ym)}: ${eur(st.total)}.`;
  if (looksRepeated) msg += ` ⚠ Parece repetido de hace unos minutos: si lo es, dime "deshaz".`;
  return ok(msg, { id: row.id, category, date, month_category_spent: st ? st.spent / 100 : null, month_total_spent: st ? st.total / 100 : null, limit: st && st.limit ? st.limit / 100 : null });
}

async function actIncome(uid, b, today) {
  const cents = toCents(b.amount);
  if (!cents || cents <= 0) return bad('Necesito un importe válido.');
  const date = parseDate(b.date, today);
  if (!date || date > today) return bad('Fecha no válida.');
  const { row, duplicate } = await addMovement(uid, { type: 'income', date, amount: cents / 100, category: 'Ingresos', concept: String(b.concept || '').slice(0, 140) || null, request_id: b.request_id || null });
  const rows = await monthMovements(uid, today.slice(0, 7));
  const inc = sumCents(rows, r => r.type === 'income'), exp = sumCents(rows, r => r.type === 'expense');
  return ok(`${duplicate ? 'Ya lo tenía apuntado' : '✓ Ingreso apuntado'}: ${eur(cents)}. Este mes: ${eur(inc)} de ingresos y ${eur(exp)} de gastos.`, { id: row.id });
}

async function actSetBudget(uid, b, today) {
  const category = resolveCategory(b.category, '');
  const cents = toCents(b.limit);
  if (!b.category || category === 'Otros' && norm(b.category) !== 'otros') return bad(`Categoría no reconocida. Usa una de: ${CATEGORIES.join(', ')}.`);
  if (!cents || cents <= 0) return bad('Necesito un límite válido en euros.');
  await sb('budgets?on_conflict=user_id,category', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: { user_id: uid, category, monthly_limit: cents / 100, updated_at: new Date().toISOString() } });
  const st = await categoryStatus(uid, category, today);
  return ok(`✓ Límite de ${category}: ${eur(cents)} al mes. Llevas ${eur(st.spent)} este mes (${pct(st.spent, cents)}%).`, { category, limit: cents / 100 });
}

async function actSetGoal(uid, b, today) {
  const name = String(b.name || '').trim().slice(0, 60);
  const cents = toCents(b.target);
  if (!name) return bad('¿Cómo se llama el objetivo? (por ejemplo, "Piso").');
  if (!cents || cents <= 0) return bad('Necesito el importe objetivo.');
  let deadline = null;
  if (b.deadline) {
    const d = String(b.deadline).match(/^(\d{4})-(\d{1,2})/) || String(b.deadline).match(/^(\d{1,2})[\/.\-](\d{4})$/);
    if (!d) return bad('Fecha límite no válida. Usa AAAA-MM o MM/AAAA.');
    const [y, m] = d[1].length === 4 ? [d[1], d[2]] : [d[2], d[1]];
    deadline = `${y}-${String(m).padStart(2, '0')}-01`;
    if (deadline.slice(0, 7) < today.slice(0, 7)) return bad('La fecha límite ya ha pasado.');
  }
  const existing = await findGoal(uid, name);
  if (existing && norm(existing.name) === norm(name)) {
    await sb(`savings_goals?id=eq.${existing.id}`, { method: 'PATCH', body: { target: cents / 100, deadline } });
  } else {
    await sb('savings_goals', { method: 'POST', body: { user_id: uid, name, target: cents / 100, deadline }, prefer: 'return=minimal' });
  }
  const g = await findGoal(uid, name);
  const p = await goalProgress(uid, g, today);
  let msg = `✓ Objetivo "${g.name}": ${eur(p.target)}${deadline ? ` para ${monthName(deadline.slice(0, 7))} de ${deadline.slice(0, 4)}` : ''}. Llevas ${eur(p.saved)} (${pct(p.saved, p.target)}%).`;
  if (p.needMonthly !== null) msg += ` Necesitas apartar ${eur(p.needMonthly)} al mes.`;
  return ok(msg, { goal_id: g.id });
}

async function actSave(uid, b, today) {
  const cents = toCents(b.amount);
  if (!cents || cents <= 0) return bad('Necesito un importe válido.');
  const g = b.goal ? await findGoal(uid, b.goal) : null;
  if (!g) {
    const all = await sb(`savings_goals?select=name&user_id=eq.${uid}&archived=eq.false`) || [];
    return bad(all.length ? `No encuentro ese objetivo. Tienes: ${all.map(x => x.name).join(', ')}.` : 'Aún no tienes objetivos de ahorro. Crea uno primero, por ejemplo: "objetivo Piso, 12.000 € para 09/2030".');
  }
  const date = parseDate(b.date, today) || today;
  await addMovement(uid, { type: 'saving', date, amount: cents / 100, goal_id: g.id, concept: `Ahorro: ${g.name}`, request_id: b.request_id || null });
  const p = await goalProgress(uid, g, today);
  let msg = `✓ ${eur(cents)} apartados para "${g.name}": ${eur(p.saved)} de ${eur(p.target)} (${pct(p.saved, p.target)}%).`;
  if (p.needMonthly !== null) msg += p.thisMonth >= p.needMonthly
    ? ` Este mes ya cumples lo necesario (${eur(p.needMonthly)}).`
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
  const rows = await monthMovements(uid, ym);
  const spent = sumCents(rows, r => r.type === 'expense');
  const income = sumCents(rows, r => r.type === 'income');
  const byCat = {};
  rows.filter(r => r.type === 'expense').forEach(r => { byCat[r.category] = (byCat[r.category] || 0) + Math.round(Number(r.amount) * 100); });
  const budgets = await sb(`budgets?select=category,monthly_limit&user_id=eq.${uid}`) || [];
  const limitTotal = budgets.reduce((a, x) => a + Math.round(Number(x.monthly_limit) * 100), 0);
  // Solo se compara con el presupuesto lo gastado en categorías que tienen límite
  const spentBudgeted = budgets.reduce((a, x) => a + (byCat[x.category] || 0), 0);
  const goals = await sb(`savings_goals?select=id,name,target,deadline&user_id=eq.${uid}&archived=eq.false`) || [];
  const goalLines = [];
  for (const g of goals) {
    const p = await goalProgress(uid, g, today);
    goalLines.push({ name: g.name, saved: p.saved, target: p.target, needMonthly: p.needMonthly, thisMonth: p.thisMonth });
  }
  // Patrimonio a partir de los activos de Orbit
  const blocks = await sb(`blocks?select=type,eur_value,value&user_id=eq.${uid}&deleted=eq.false`) || [];
  const LABEL = { bolsa: 'Bolsa', fondos: 'Fondos', pe: 'Private equity', cash: 'Efectivo', inmobiliario: 'Inmobiliario', otros: 'Otros' };
  const byType = {};
  blocks.forEach(x => { const c = Math.round(Number(x.eur_value || x.value || 0) * 100); byType[x.type] = (byType[x.type] || 0) + c; });
  const netWorth = Object.values(byType).reduce((a, c) => a + c, 0);
  const hist = await sb(`patrimonio_history?select=date,total&user_id=eq.${uid}&date=lt.${ym}-01&order=date.desc&limit=1`) || [];
  const prevTotal = hist.length ? Math.round(Number(hist[0].total) * 100) : null;

  const lines = [`*${monthName(ym)[0].toUpperCase() + monthName(ym).slice(1)}* · día ${day} de ${dim}`];
  if (netWorth) lines.push(`Patrimonio: ${eur(netWorth)}${prevTotal ? ` (${netWorth >= prevTotal ? '+' : '−'}${eur(Math.abs(netWorth - prevTotal))} desde fin de ${monthName(prevMonth(ym))})` : ''}`
    + ` · ${Object.entries(byType).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${LABEL[t] || t} ${eur(c)}`).join(' · ')}`);
  lines.push(`Gastos: ${eur(spent)}${income ? ` · Ingresos: ${eur(income)} · Balance: ${income >= spent ? '+' : ''}${eur(income - spent)}` : ''}`);
  if (limitTotal) lines.push(`Presupuesto: ${eur(spentBudgeted)} de ${eur(limitTotal)} en categorías con límite (${pct(spentBudgeted, limitTotal)}%)`);
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length) lines.push(`Donde más: ${top.map(([c, v]) => `${c} ${eur(v)}`).join(' · ')}`);
  for (const bdg of budgets) {
    const s = byCat[bdg.category] || 0, l = Math.round(Number(bdg.monthly_limit) * 100);
    if (s >= l * 0.8) lines.push(`${s >= l ? '🔴' : '🟠'} ${bdg.category}: ${eur(s)} de ${eur(l)} (${pct(s, l)}%)`);
  }
  for (const g of goalLines) {
    let t = `🎯 ${g.name}: ${eur(g.saved)} de ${eur(g.target)} (${pct(g.saved, g.target)}%)`;
    if (g.needMonthly !== null) t += g.thisMonth >= g.needMonthly ? ' · al día este mes' : ` · faltan ${eur(g.needMonthly - g.thisMonth)} este mes`;
    lines.push(t);
  }
  return { message: lines.join('\n'), data: { month: ym, day, days_in_month: dim, spent: spent / 100, income: income / 100,
    budgets: budgets.map(x => ({ category: x.category, limit: Number(x.monthly_limit), spent: (byCat[x.category] || 0) / 100 })), by_category: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, v / 100])),
    net_worth: netWorth / 100, net_worth_by_type: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v / 100])),
    goals: goalLines.map(g => ({ ...g, saved: g.saved / 100, target: g.target / 100, needMonthly: g.needMonthly === null ? null : g.needMonthly / 100, thisMonth: g.thisMonth / 100 })) } };
}

export async function computeAlerts(uid, today) {
  const ym = today.slice(0, 7), day = Number(today.slice(8, 10)), dim = daysInMonth(ym);
  const rows = await monthMovements(uid, ym);
  const byCat = {};
  rows.filter(r => r.type === 'expense').forEach(r => { byCat[r.category] = (byCat[r.category] || 0) + Math.round(Number(r.amount) * 100); });
  const out = [];
  const budgets = await sb(`budgets?select=category,monthly_limit&user_id=eq.${uid}`) || [];
  for (const b of budgets) {
    const s = byCat[b.category] || 0, l = Math.round(Number(b.monthly_limit) * 100);
    if (s >= l) out.push({ key: `budget:${b.category}:${ym}:100`, level: 'alta', text: `🔴 Has superado el límite de ${b.category}: ${eur(s)} de ${eur(l)}.` });
    else if (s >= l * 0.8) out.push({ key: `budget:${b.category}:${ym}:80`, level: 'media', text: `🟠 ${b.category} al ${pct(s, l)}%: ${eur(s)} de ${eur(l)}. Te quedan ${eur(l - s)} para ${dim - day} días.` });
    else if (day >= 7 && Math.round(s / day * dim) > l)
      out.push({ key: `pace:${b.category}:${ym}`, level: 'baja', text: `${b.category}: a este ritmo acabarías el mes en ${eur(Math.round(s / day * dim))}, por encima de tu límite de ${eur(l)}.` });
  }
  // Gasto total del mes frente a la media de los tres anteriores
  if (day >= 10) {
    const spent = Object.values(byCat).reduce((a, c) => a + c, 0);
    const prev = await sb(`movements?select=amount,date&user_id=eq.${uid}&deleted_at=is.null&type=eq.expense&date=gte.${prevMonth(ym, 3)}-01&date=lt.${ym}-01`) || [];
    const months = new Set(prev.map(r => r.date.slice(0, 7)));
    if (months.size >= 2) {
      const avg = Math.round(sumCents(prev, () => true) / months.size);
      const projected = Math.round(spent / day * dim);
      if (projected > avg * 1.2) out.push({ key: `spend:${ym}:high`, level: 'media',
        text: `Este mes vas camino de gastar ${eur(projected)}, un ${pct(projected - avg, avg)}% más que tu media (${eur(avg)}).` });
    }
  }
  // Objetivos de ahorro retrasados (a partir del día 20)
  if (day >= 20) {
    const goals = await sb(`savings_goals?select=id,name,target,deadline&user_id=eq.${uid}&archived=eq.false`) || [];
    for (const g of goals) {
      const p = await goalProgress(uid, g, today);
      if (p.needMonthly && p.thisMonth < p.needMonthly)
        out.push({ key: `goal:${g.id}:${ym}`, level: 'media', text: `🎯 "${g.name}": este mes llevas ${eur(p.thisMonth)} de ${eur(p.needMonthly)} necesarios. Te faltan ${eur(p.needMonthly - p.thisMonth)}.` });
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

async function actUndo(uid, b) {
  const since = new Date(Date.now() - 24 * 3600000).toISOString();
  let path = `movements?select=id,type,amount,category,concept,date&user_id=eq.${uid}&source=eq.instinct&deleted_at=is.null&created_at=gte.${q(since)}&order=created_at.desc&limit=1`;
  if (b.id) path = `movements?select=id,type,amount,category,concept,date&user_id=eq.${uid}&id=eq.${q(b.id)}&source=eq.instinct&deleted_at=is.null&created_at=gte.${q(since)}&limit=1`;
  const rows = await sb(path) || [];
  if (!rows.length) return ok('No hay nada que deshacer de las últimas 24 horas.', {});
  const r = rows[0];
  await sb(`movements?id=eq.${r.id}&user_id=eq.${uid}`, { method: 'PATCH', body: { deleted_at: new Date().toISOString() } });
  return ok(`↩︎ Deshecho: ${eur(Math.round(Number(r.amount) * 100))}${r.category ? ` en ${r.category}` : ''}${r.concept ? ` (${r.concept})` : ''} del ${r.date}.`, { id: r.id });
}

async function actRecent(uid) {
  const rows = await sb(`movements?select=date,type,amount,category,concept&user_id=eq.${uid}&deleted_at=is.null&order=created_at.desc&limit=8`) || [];
  if (!rows.length) return ok('Aún no hay movimientos.', { rows: [] });
  const T = { expense: '−', income: '+', saving: '🎯', buy: 'Compra', sell: 'Venta' };
  return ok(rows.map(r => `${r.date.slice(8, 10)}/${r.date.slice(5, 7)} ${T[r.type] || ''} ${eur(Math.round(Number(r.amount) * 100))} ${r.category || ''}${r.concept ? ` · ${r.concept}` : ''}`).join('\n'), { rows });
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
      expense: () => actExpense(uid, body, today),
      income: () => actIncome(uid, body, today),
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
