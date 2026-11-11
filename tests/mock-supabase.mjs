// Supabase/PostgREST simulado en memoria para probar api/instinct.js sin tocar datos reales.
export const db = { blocks: [], user_expense_data: [], user_kv: [], movements: [], pe_transactions: [],
  notifications_sent: [], documents: [], instinct_tokens: [], profiles: [] };
export const log = [];
let seq = 0;
const uid = () => 'id-' + (++seq);

function parseFilters(sp) {
  const f = [];
  for (const [k, v] of sp) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
    const m = v.match(/^(eq|neq|lt|lte|gt|gte|is|like)\.(.*)$/s);
    if (m) f.push([k, m[1], decodeURIComponent(m[2])]);
  }
  return f;
}
const val = (r, k) => r[k];
function match(r, f) {
  return f.every(([k, op, v]) => {
    const x = val(r, k);
    if (op === 'is') return v === 'null' ? x == null : String(x) === v;
    if (op === 'eq') return String(x) === v;
    if (op === 'neq') return String(x) !== v;
    if (op === 'lt') return String(x) < v;
    if (op === 'lte') return String(x) <= v;
    if (op === 'gt') return String(x) > v;
    if (op === 'gte') return String(x) >= v;
    if (op === 'like') return new RegExp('^' + v.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(String(x));
    return true;
  });
}
const json = (status, body) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const failNext = { table: null, method: null };

export async function mockFetch(url, opts = {}) {
  const u = new URL(String(url));
  const method = (opts.method || 'GET').toUpperCase();
  if (u.hostname.includes('frankfurter')) return json(200, { base: 'EUR', rates: { USD: 1.10, GBP: 0.85 } });
  if (u.pathname === '/auth/v1/user') return json(200, { id: 'user-jwt' });
  const m = u.pathname.match(/\/rest\/v1\/(\w+)/);
  if (!m) return json(404, { message: 'no mock for ' + url });
  const t = m[1]; db[t] = db[t] || [];
  if (failNext.table === t && failNext.method === method) { failNext.table = null; return json(500, { message: 'fallo simulado' }); }
  const f = parseFilters(u.searchParams);
  const body = opts.body ? JSON.parse(opts.body) : null;
  const prefer = (opts.headers && opts.headers.Prefer) || '';
  log.push(`${method} ${t}`);
  if (method === 'GET') {
    let rows = db[t].filter(r => match(r, f));
    const lim = u.searchParams.get('limit'); if (lim) rows = rows.slice(0, +lim);
    return json(200, JSON.parse(JSON.stringify(rows)));
  }
  if (method === 'POST') {
    const arr = Array.isArray(body) ? body : [body];
    const conflict = u.searchParams.get('on_conflict');
    const out = [];
    for (const b of arr) {
      if (conflict) {
        const keys = conflict.split(',');
        const ex = db[t].find(r => keys.every(k => String(r[k]) === String(b[k])));
        if (ex) { if (prefer.includes('ignore-duplicates')) continue; Object.assign(ex, b); out.push(ex); continue; }
      }
      if (t === 'movements' && b.request_id && db[t].some(r => r.user_id === b.user_id && r.request_id === b.request_id))
        return json(409, { code: '23505', message: 'duplicate key' });
      if (t === 'user_expense_data' && db[t].some(r => r.user_id === b.user_id)) return json(409, { code: '23505', message: 'dup' });
      const row = { id: b.id || uid(), created_at: new Date().toISOString(), deleted: false, ...b };
      if (t === 'blocks') row.updated_at = row.updated_at || new Date().toISOString();
      db[t].push(row); out.push(row);
    }
    return json(201, prefer.includes('representation') ? JSON.parse(JSON.stringify(out)) : undefined);
  }
  if (method === 'PATCH') {
    const rows = db[t].filter(r => match(r, f));
    rows.forEach(r => Object.assign(r, JSON.parse(JSON.stringify(body))));
    if (t === 'blocks' && !body.updated_at) rows.forEach(r => r.updated_at = new Date(Date.now() + (++seq)).toISOString());
    return json(200, prefer.includes('representation') ? JSON.parse(JSON.stringify(rows)) : undefined);
  }
  if (method === 'DELETE') { db[t] = db[t].filter(r => !match(r, f)); return json(204); }
  return json(405, {});
}
