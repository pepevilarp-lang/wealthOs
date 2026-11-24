// ideas.js — seguimiento de las propuestas de operación (orbit_notes, kind = 'idea').
// Cada día, con las velas diarias de Twelve Data, se mira si el precio tocó el objetivo o la salida
// desde la fecha de la propuesta. Se sigue igual se haya ejecutado o no: así se ve "qué hubiera pasado".
// Reglas (decididas por el usuario el 24 nov 2026): tamaño entre 500 y 1.000 €, una idea con dinero a la vez,
// comisiones de 1 € al comprar y 1 € al vender. El porcentaje es en la moneda del activo (sin efecto divisa).

export const FEES_EUR = 2;
export const SIZE_MIN = 500, SIZE_MAX = 1000;

const r2 = (x) => Math.round(x * 100) / 100;

// idea: { direction, entry_price, target_price, stop_price, expires_on, entry_date, size_eur }
// bars: [{ date: 'YYYY-MM-DD', high, low, close }] en cualquier orden. today: 'YYYY-MM-DD'.
// Devuelve { status, exit_price, closed_on, last_price, last_price_date, result_pct, result_eur }.
export function evaluateIdea(idea, bars, today) {
  const dir = idea.direction === 'bajista' ? -1 : 1;
  const entry = Number(idea.entry_price), target = Number(idea.target_price), stop = Number(idea.stop_price);
  if (!(entry > 0 && target > 0 && stop > 0)) throw new Error('La idea no tiene entrada, objetivo y salida válidos');
  if (dir === 1 && !(stop < entry && entry < target)) throw new Error('Idea alcista: debe cumplirse salida < entrada < objetivo');
  if (dir === -1 && !(target < entry && entry < stop)) throw new Error('Idea bajista: debe cumplirse objetivo < entrada < salida');
  const from = idea.entry_date, until = idea.expires_on || '9999-12-31';
  const seq = bars.filter(b => b.date > from && b.date <= until && b.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const pct = (exit) => r2((exit / entry - 1) * 100 * dir);
  const eur = (p) => idea.size_eur ? r2(Number(idea.size_eur) * p / 100 - FEES_EUR) : null;
  const closed = (status, exit, date) => { const p = pct(exit); return { status, exit_price: exit, closed_on: date, last_price: exit, last_price_date: date, result_pct: p, result_eur: eur(p) }; };

  for (const b of seq) {
    const hitStop = dir === 1 ? b.low <= stop : b.high >= stop;
    const hitTarget = dir === 1 ? b.high >= target : b.low <= target;
    // Si el mismo día toca las dos, se cuenta la salida: con velas diarias no se sabe cuál fue antes.
    if (hitStop) return closed('stop', stop, b.date);
    if (hitTarget) return closed('objetivo', target, b.date);
  }
  const last = seq[seq.length - 1];
  if (idea.expires_on && today > idea.expires_on) {
    if (!last) throw new Error('Caducada sin precios entre la propuesta y la fecha límite');
    return closed('caducada', last.close, last.date);
  }
  if (!last) return { status: 'abierta', exit_price: null, closed_on: null, last_price: null, last_price_date: null, result_pct: null, result_eur: null };
  return { status: 'abierta', exit_price: null, closed_on: null, last_price: last.close, last_price_date: last.date, result_pct: pct(last.close), result_eur: null };
}

// Velas diarias de Twelve Data desde una fecha (incluida).
export async function fetchBars(symbol, from, { key, fetchImpl = fetch }) {
  const u = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&start_date=${from}&outputsize=200&apikey=${encodeURIComponent(key)}`;
  const r = await fetchImpl(u);
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || d.status === 'error' || !Array.isArray(d.values)) throw new Error(`Twelve Data ${symbol}: ${(d && d.message) || 'HTTP ' + r.status}`);
  return d.values.map(v => ({ date: String(v.datetime).slice(0, 10), high: +v.high, low: +v.low, close: +v.close }));
}

// Revisa todas las ideas abiertas con símbolo de precio y guarda el estado. Un fallo en una idea no tumba las demás.
export async function trackIdeas({ SU, SR, key, today, fetchImpl = fetch }) {
  const h = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
  const r = await fetchImpl(`${SU}/rest/v1/orbit_notes?select=id,ticker,price_symbol,direction,entry_price,target_price,stop_price,expires_on,entry_date,size_eur,created_at&kind=eq.idea&status=eq.abierta`, { headers: h });
  const ideas = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(ideas)) throw new Error(`No se pudieron leer las ideas abiertas (HTTP ${r.status})`);
  const out = { checked: 0, closed: 0, errors: [] };
  for (const i of ideas) {
    try {
      if (!i.price_symbol) throw new Error('sin price_symbol: no se puede seguir');
      const idea = { ...i, entry_date: i.entry_date || String(i.created_at).slice(0, 10) };
      const ev = evaluateIdea(idea, await fetchBars(i.price_symbol, idea.entry_date, { key, fetchImpl }), today);
      const p = await fetchImpl(`${SU}/rest/v1/orbit_notes?id=eq.${i.id}`, { method: 'PATCH', headers: { ...h, Prefer: 'return=minimal' },
        body: JSON.stringify({ ...ev, reviewed_at: new Date().toISOString() }) });
      if (!p.ok) throw new Error(`no se pudo guardar (HTTP ${p.status})`);
      out.checked++; if (ev.status !== 'abierta') out.closed++;
    } catch (e) { out.errors.push(`${i.ticker || i.id}: ${String(e.message || e).slice(0, 160)}`); console.error('[ideas]', i.id, e); }
  }
  return out;
}

// Marcador: ideas cerradas, aciertos y resultado acumulado (lo que hubiera pasado con el tamaño indicado).
export function scoreboard(closedIdeas) {
  const c = closedIdeas.filter(i => i.status && i.status !== 'abierta' && i.result_pct != null);
  const wins = c.filter(i => Number(i.result_pct) > 0).length;
  const eur = r2(c.reduce((s, i) => s + (i.result_eur != null ? Number(i.result_eur) : 0), 0));
  return { closed: c.length, wins, hit_rate: c.length ? Math.round(wins / c.length * 100) : null, result_eur: eur };
}
