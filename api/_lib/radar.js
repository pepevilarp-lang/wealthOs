// Radar de empresas: "lo que se cuece" en las acciones que tiene el usuario.
// Solo información pública (Finnhub, plan gratuito): compras y ventas de directivos (formulario 4),
// cambios de recomendación de analistas, hechos relevantes (8-K) y noticias con palabras clave materiales.
// Cada aviso lleva fecha y fuente. Nada se inventa: si una fuente falla, se anota el error y se sigue.

const FB = 'https://finnhub.io/api/v1';
const ETF_RX = /\b(etf|ucits|etp)\b|ishares|vanguard|amundi|xtrackers|spdr|lyxor|invesco|wisdomtree/i;
const CRYPTO_RX = /^(BTC|ETH|SOL|ADA|XRP|DOGE|BNB|DOT|AVAX|MATIC)$/;
// Umbrales (USD). Las compras de directivos son raras y dicen más que las ventas (muchas son planes 10b5-1).
export const INSIDER_BUY_MIN = 50_000;
export const INSIDER_SELL_MIN = 1_000_000;
export const NEWS_PER_TICKER = 3;
const NEWS_RX = /\b(ceo|cfo|chief executive|resign|steps? down|appoint|names? new|acqui|merger|takeover|buyout|spin-?off|investigat|probe|subpoena|lawsuit|sues|sued|class action|sec\b|doj\b|ftc\b|antitrust|guidance|forecast cut|raises? (its )?(outlook|forecast)|downgrad|upgrad|recall|layoffs?|job cuts|restructur|bankrupt|default|buyback|repurchase|dividend|fda|export (ban|curbs|controls)|sanction)/i;

const dayStr = (d) => d.toISOString().slice(0, 10);
export const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return dayStr(d); };
const usd = (v) => Math.abs(v) >= 1e6 ? `${(v / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 1 })} M USD`
  : `${Math.round(v).toLocaleString('es-ES')} USD`;
const nInt = (v) => Math.round(Math.abs(v)).toLocaleString('es-ES');

// Acciones (no ETF, no cripto, no robo-advisor) de los bloques de bolsa, con formato de ticker de EE. UU.
export function stockTickers(blocks) {
  const out = new Set();
  for (const b of blocks || []) {
    if (b.deleted || b.type !== 'bolsa') continue;
    for (const p of (b.extra && b.extra.positions) || []) {
      if (!p || !p.ticker || p.isRoboAdvisor) continue;
      const tk = String(p.ticker).toUpperCase().trim();
      const type = String(p.type || '').toUpperCase();
      if (CRYPTO_RX.test(tk) || type === 'ETF' || type === 'CRYPTO' || ETF_RX.test(p.name || '')) continue;
      if (!/^[A-Z]{1,5}$/.test(tk)) continue;
      out.add(tk);
    }
  }
  return [...out].sort();
}

// ── Reglas puras (probadas con datos ficticios) ──────────────────────────────────────────
export function insiderEvents(tk, rows, since) {
  const ev = [];
  for (const r of rows || []) {
    const code = String(r.transactionCode || '').toUpperCase();
    if (code !== 'P' && code !== 'S') continue;                  // solo compras y ventas en mercado
    const date = String(r.transactionDate || r.filingDate || '').slice(0, 10);
    if (!date || date < since) continue;
    const qty = Number(r.change) || 0, px = Number(r.transactionPrice) || 0;
    const value = Math.abs(qty) * px;
    const buy = code === 'P';
    if (!px || value < (buy ? INSIDER_BUY_MIN : INSIDER_SELL_MIN)) continue;
    ev.push({
      key: `insider:${tk}:${r.name || 'x'}:${date}:${code}:${Math.round(Math.abs(qty))}`,
      ticker: tk, kind: 'insider', event_date: date,
      level: buy ? 'media' : (value >= 10_000_000 ? 'media' : 'baja'),
      text: `${buy ? '🟢' : '🔻'} ${tk} · ${r.name || 'Un directivo'} ha ${buy ? 'comprado' : 'vendido'} ${nInt(qty)} acciones a ${px.toLocaleString('es-ES', { maximumFractionDigits: 2 })} USD (≈ ${usd(value)}) el ${date}.${buy ? '' : ' Muchas ventas de directivos son planes programados: compruébalo antes de sacar conclusiones.'} Fuente: formulario 4 de la SEC vía Finnhub.`,
      url: null,
    });
  }
  return ev;
}

export function recommendationEvents(tk, rows) {
  const s = [...(rows || [])].sort((a, z) => String(z.period).localeCompare(String(a.period)));
  if (s.length < 2) return [];
  const [now, prev] = s;
  const tot = (r) => (r.strongBuy || 0) + (r.buy || 0) + (r.hold || 0) + (r.sell || 0) + (r.strongSell || 0);
  const tn = tot(now), tp = tot(prev);
  if (!tn || !tp) return [];
  const buyNow = ((now.strongBuy || 0) + (now.buy || 0)) / tn, buyPrev = ((prev.strongBuy || 0) + (prev.buy || 0)) / tp;
  const sellNow = (now.sell || 0) + (now.strongSell || 0), sellPrev = (prev.sell || 0) + (prev.strongSell || 0);
  const dBuy = buyNow - buyPrev;
  if (Math.abs(dBuy) < 0.10 && sellNow - sellPrev < 2) return [];
  const pc = (x) => `${Math.round(x * 100)} %`;
  const up = dBuy > 0 && sellNow <= sellPrev;
  return [{
    key: `reco:${tk}:${now.period}`, ticker: tk, kind: 'analistas', event_date: String(now.period).slice(0, 10),
    level: 'media',
    text: `${up ? '📈' : '📉'} ${tk} · Los analistas ${up ? 'mejoran' : 'empeoran'} su opinión: recomiendan comprar el ${pc(buyNow)} (antes ${pc(buyPrev)}) y vender ${sellNow} (antes ${sellPrev}). Periodo ${now.period} frente a ${prev.period}. Fuente: consenso de analistas vía Finnhub.`,
    url: null,
  }];
}

export function filingEvents(tk, rows, since) {
  const ev = [];
  for (const r of rows || []) {
    if (String(r.form || '').toUpperCase() !== '8-K') continue;
    const date = String(r.filedDate || r.acceptedDate || '').slice(0, 10);
    if (!date || date < since) continue;
    ev.push({
      key: `filing:${tk}:${r.accessNumber || date}`, ticker: tk, kind: 'hecho_relevante', event_date: date, level: 'media',
      text: `📄 ${tk} · Ha presentado un hecho relevante (8-K) a la SEC el ${date}. Suelen anunciar resultados, cambios de directivos, acuerdos u operaciones. Fuente: SEC vía Finnhub.`,
      url: r.reportUrl || r.filingUrl || null,
    });
  }
  return ev;
}

export function newsEvents(tk, rows, since) {
  const seen = new Set(), ev = [];
  const list = [...(rows || [])].sort((a, z) => (z.datetime || 0) - (a.datetime || 0));
  for (const a of list) {
    if (!a || !a.headline) continue;
    const date = a.datetime ? new Date(a.datetime * 1000).toISOString().slice(0, 10) : '';
    if (!date || date < since) continue;
    if (!NEWS_RX.test(`${a.headline} ${a.summary || ''}`)) continue;
    const norm = a.headline.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 60);
    if (seen.has(norm)) continue; seen.add(norm);
    ev.push({
      key: `news:${tk}:${a.id || norm}`, ticker: tk, kind: 'noticia', event_date: date, level: 'baja',
      text: `📰 ${tk} · ${a.headline} (${a.source || 'prensa'}, ${date}).`,
      url: a.url || null,
    });
    if (ev.length >= NEWS_PER_TICKER) break;
  }
  return ev;
}

// ── Consulta de un ticker ──────────────────────────────────────────────────────────────
export async function scanTicker(tk, { key, today, fetchImpl = fetch } = {}) {
  const errors = [];
  const get = async (path, tag) => {
    try {
      const r = await fetchImpl(`${FB}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(key)}`,
        { signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
      if (!r.ok) { errors.push(`${tk} ${tag}: HTTP ${r.status}`); return null; }
      return await r.json();
    } catch (e) { errors.push(`${tk} ${tag}: ${e && e.message || e}`); return null; }
  };
  const since14 = addDays(today, -14), since3 = addDays(today, -3);
  const [ins, rec, fil, news] = await Promise.all([
    get(`/stock/insider-transactions?symbol=${tk}&from=${since14}&to=${today}`, 'directivos'),
    get(`/stock/recommendation?symbol=${tk}`, 'analistas'),
    get(`/stock/filings?symbol=${tk}&from=${since14}&to=${today}`, 'hechos relevantes'),
    get(`/company-news?symbol=${tk}&from=${since3}&to=${today}`, 'noticias'),
  ]);
  const events = [
    ...insiderEvents(tk, ins && ins.data, since14),
    ...recommendationEvents(tk, Array.isArray(rec) ? rec : []),
    ...filingEvents(tk, Array.isArray(fil) ? fil : [], since14),
    ...newsEvents(tk, Array.isArray(news) ? news : [], since3),
  ];
  return { events, errors };
}

export async function scanTickers(tickers, opts) {
  const byTicker = {}, errors = [];
  for (const tk of tickers) {                       // en serie: el plan gratuito permite 60 llamadas/min
    const r = await scanTicker(tk, opts);
    byTicker[tk] = r.events; errors.push(...r.errors);
  }
  return { byTicker, errors };
}

// ── Guardar avisos (servicio de Supabase; único por usuario y clave) ───────────────────
export async function persistEvents(uid, events, { SU, SR, fetchImpl = fetch } = {}) {
  if (!events.length) return 0;
  const rows = events.map(e => ({ user_id: uid, key: e.key, ticker: e.ticker, kind: e.kind, level: e.level,
    text: e.text, url: e.url, event_date: e.event_date }));
  const r = await fetchImpl(`${SU}/rest/v1/radar_events?on_conflict=user_id,key`, {
    method: 'POST',
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`radar_events: HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return rows.length;
}

// Fecha de hoy en Madrid (YYYY-MM-DD)
export function madridDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
