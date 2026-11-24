// quotes.js — precios de las posiciones de bolsa desde el servidor (una sola vía para la app, Instinct y la tarea diaria).
// 1) Cada posición se resuelve UNA vez a un símbolo exacto de Yahoo Finance, por ISIN si lo tiene (p. ej. un ETF irlandés
//    → su línea de Xetra en EUR). El símbolo, la bolsa y la moneda se guardan en la posición (quote_symbol…).
// 2) El precio sale del gráfico diario de Yahoo (último cierre o último precio de la sesión, con fecha, moneda y variación
//    del día). Si Yahoo falla y es un valor de EE. UU., se intenta Twelve Data. Si todo falla, error explícito: nunca se inventa.
// Yahoo Finance no tiene API oficial: si cambia, el error se ve en la posición y en /api/health.

const YQ = 'https://query1.finance.yahoo.com';
const YS = 'https://query2.finance.yahoo.com';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; Orbit/1.0)', Accept: 'application/json' };
// Preferencia de bolsa por moneda: sufijos de Yahoo (Xetra primero en EUR por liquidez)
const SUFFIX_PREF = { EUR: ['.DE', '.AS', '.MI', '.PA', '.MC', '.F'], GBP: ['.L'], CHF: ['.SW'], USD: [''] };
const CRYPTO = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'DOT', 'AVAX', 'LINK', 'LTC', 'BNB', 'MATIC', 'TRX']);
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const r2 = (x) => Math.round(x * 100) / 100;
const suffixOf = (s) => { const m = String(s).match(/(\.[A-Z]{1,3})$/); return m ? m[1] : ''; };
const ccyOf = (p) => String(p.priceCurrency || p.currency || '').toUpperCase() || null;

// Peniques: Yahoo da GBp/GBX en Londres → se pasa a libras para no multiplicar por 100 el valor
export function normalizeCcy(price, ccy) {
  const c = String(ccy || '');
  if (c === 'GBp' || c.toUpperCase() === 'GBX') return { price: price / 100, currency: 'GBP' };
  return { price, currency: c.toUpperCase() || null };
}

// Elige el símbolo de una búsqueda de Yahoo según la moneda de la posición
export function pickSymbol(quotes, ccy) {
  const ok = (quotes || []).filter(q => q && q.symbol && ['ETF', 'EQUITY', 'MUTUALFUND', 'CRYPTOCURRENCY', 'INDEX'].includes(String(q.quoteType || '').toUpperCase()));
  if (!ok.length) return null;
  const pref = SUFFIX_PREF[ccy] || [];
  for (const sfx of pref) {
    const hit = ok.find(q => suffixOf(q.symbol) === sfx && (sfx || !q.symbol.includes('.')));
    if (hit) return hit.symbol;
  }
  return ok[0].symbol;
}

async function getJson(url, fetchImpl) {
  const r = await fetchImpl(url, { headers: UA, signal: AbortSignal.timeout(8000) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error(`HTTP ${r.status}`);
  return j;
}

// Símbolo exacto de Yahoo para una posición (sin consultar si ya lo tiene guardado)
export async function resolveYahoo(pos, { fetchImpl = fetch } = {}) {
  if (pos.quote_symbol) return pos.quote_symbol;
  const t = String(pos.ticker || '').toUpperCase().trim(), ccy = ccyOf(pos);
  if (CRYPTO.has(t)) return `${t}-${ccy || 'USD'}`;
  if (pos.isin) {
    const j = await getJson(`${YS}/v1/finance/search?q=${encodeURIComponent(String(pos.isin).trim())}&quotesCount=10&newsCount=0`, fetchImpl);
    const sym = pickSymbol(j.quotes, ccy);
    if (sym) return sym;
  }
  if (!t) throw new Error('la posición no tiene ticker ni ISIN');
  if (t.includes('.') || t.includes('-') || t.includes('=')) return t;
  if (!ccy || ccy === 'USD') return t;
  // Sin ISIN y en otra moneda: se prueba el ticker en las bolsas de esa moneda
  const j = await getJson(`${YS}/v1/finance/search?q=${encodeURIComponent(t)}&quotesCount=10&newsCount=0`, fetchImpl);
  const sym = pickSymbol((j.quotes || []).filter(q => String(q.symbol).split('.')[0] === t), ccy);
  if (sym) return sym;
  throw new Error(pos.isin ? `el ISIN ${pos.isin} no aparece en Yahoo Finance ni ${t} en ${ccy}: revisa el ISIN` : `no encuentro ${t} en ${ccy}: añade el ISIN de la posición`);
}

// Precio diario de Yahoo: último dato válido, su fecha, moneda y variación frente al cierre anterior
export async function yahooQuote(symbol, { fetchImpl = fetch } = {}) {
  const j = await getJson(`${YQ}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=10d&includePrePost=false`, fetchImpl);
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error((j && j.chart && j.chart.error && j.chart.error.description) || 'sin datos');
  const closes = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
  const ts = res.timestamp || [];
  const pts = ts.map((t, i) => ({ t, c: closes[i] })).filter(x => x.c != null && isFinite(x.c) && x.c > 0);
  if (!pts.length) throw new Error('sin cotizaciones recientes');
  const last = pts[pts.length - 1], prev = pts.length > 1 ? pts[pts.length - 2] : null;
  const meta = res.meta || {};
  const n = normalizeCcy(last.c, meta.currency), p0 = prev ? normalizeCcy(prev.c, meta.currency).price : null;
  if (!n.currency) throw new Error('la fuente no indica la moneda');
  return { symbol, price: r4(n.price), currency: n.currency, date: new Date(last.t * 1000).toISOString().slice(0, 10),
    change_pct: p0 ? r2((n.price / p0 - 1) * 100) : null, exchange: meta.exchangeName || meta.fullExchangeName || null, source: 'Yahoo Finance' };
}

// Respaldo para valores de EE. UU.: Twelve Data /quote
export async function twelveQuote(symbol, { key, fetchImpl = fetch } = {}) {
  if (!key) throw new Error('sin TWELVEDATA_KEY');
  const j = await getJson(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`, fetchImpl);
  if (j.status === 'error' || !(+j.close > 0)) throw new Error(j.message || 'sin precio');
  if (!j.currency) throw new Error('la fuente no indica la moneda');
  return { symbol, price: r4(+j.close), currency: String(j.currency).toUpperCase(), date: String(j.datetime || '').slice(0, 10) || null,
    change_pct: j.percent_change != null ? r2(+j.percent_change) : null, exchange: j.exchange || null, source: 'Twelve Data' };
}

// Cotiza una lista de posiciones. Devuelve un resultado por posición, en el mismo orden: { ok, ...cotización } o { ok:false, error }.
export async function quotePositions(positions, { tdKey, fetchImpl = fetch } = {}) {
  const out = [];
  for (const pos of positions) {
    let sym = null;
    try {
      sym = await resolveYahoo(pos, { fetchImpl });
      try { out.push({ ok: true, ...(await yahooQuote(sym, { fetchImpl })) }); continue; }
      catch (ey) {
        const us = !sym.includes('.') && !sym.includes('-') && (!ccyOf(pos) || ccyOf(pos) === 'USD');
        if (!us || !tdKey) throw new Error(`Yahoo Finance: ${ey.message}`);
        try { out.push({ ok: true, ...(await twelveQuote(sym, { key: tdKey, fetchImpl })) }); continue; }
        catch (et) { throw new Error(`Yahoo Finance: ${ey.message} · Twelve Data: ${et.message}`); }
      }
    } catch (e) { out.push({ ok: false, symbol: sym, error: String(e.message || e).slice(0, 160) }); }
  }
  return out;
}

// Aplica una cotización a una posición. fx = euros por unidad de cada moneda ({ EUR: 1, USD: 0.91 }).
// Si la cotización falló, se conserva el último precio válido y se marca como antiguo.
export function applyQuote(pos, q, fx) {
  if (!q || !q.ok) { pos.price_stale = true; pos.price_error = (q && q.error) || 'sin precio'; return false; }
  const rate = fx[q.currency];
  if (!(rate > 0)) { pos.price_stale = true; pos.price_error = `sin tipo de cambio del BCE para ${q.currency}`; return false; }
  pos.quote_symbol = q.symbol; if (q.exchange) pos.quote_exchange = q.exchange;
  pos.lastPrice = q.price; pos.priceCurrency = q.currency;
  pos.valueNative = r2((+pos.qty || 0) * q.price);
  pos.value = r2(pos.valueNative * rate);
  pos.price_date = q.date; pos.price_source = q.source; pos.day_change_pct = q.change_pct;
  pos.price_stale = false; delete pos.price_error;
  return true;
}

// Euros por unidad de cada moneda, con el tipo de referencia del BCE (Frankfurter)
export async function ecbRates(currencies, { fetchImpl = fetch } = {}) {
  const need = [...new Set(currencies.filter(c => c && c !== 'EUR'))];
  const out = { EUR: 1 };
  if (!need.length) return out;
  const j = await getJson(`https://api.frankfurter.app/latest?from=EUR&to=${need.join(',')}`, fetchImpl);
  for (const c of need) if (j.rates && j.rates[c] > 0) out[c] = 1 / j.rates[c];
  out._date = j.date || null;
  return out;
}

// Tarea diaria: actualiza los precios de todas las cuentas de bolsa (todas las personas usuarias) con la clave de servicio.
// Por cuenta: cotiza, convierte con el BCE, recalcula el valor y guarda con control de versión (updated_at): si la app
// la ha cambiado mientras tanto, no se pisa y se informa. Las posiciones que fallan conservan su último precio (antiguo).
export async function refreshBolsaBlocks({ SU, SR, tdKey, fetchImpl = fetch }) {
  const h = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
  const r = await fetchImpl(`${SU}/rest/v1/blocks?select=id,user_id,extra,value,updated_at,deleted&type=eq.bolsa`, { headers: h });
  const rows = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(rows)) throw new Error(`No se pudieron leer las cuentas de bolsa (HTTP ${r.status})`);
  const out = { blocks: 0, updated: 0, failed: [], skipped: [] };
  for (const b of rows.filter(x => !x.deleted)) {
    const extra = b.extra || {}, all = Array.isArray(extra.positions) ? extra.positions : [];
    const live = all.filter(p => p && !p.deleted && !p.isRoboAdvisor && (p.ticker || p.isin) && +p.qty > 0);
    if (!live.length) continue;
    out.blocks++;
    try {
      const qs = await quotePositions(live, { tdKey, fetchImpl });
      const fx = await ecbRates(qs.filter(q => q.ok).map(q => q.currency), { fetchImpl });
      live.forEach((p, i) => { if (applyQuote(p, qs[i], fx)) out.updated++; else out.failed.push(`${p.ticker || p.isin}: ${p.price_error}`); });
      const total = r2(all.filter(p => p && !p.deleted).reduce((s, p) => s + (+p.value || 0), 0));
      const now = new Date().toISOString();
      extra.lastPriceAttempt = now;
      if (live.every(p => !p.price_stale)) extra.lastPriceUpdate = now;
      extra.priceErrors = live.filter(p => p.price_stale).map(p => p.ticker);
      const u = await fetchImpl(`${SU}/rest/v1/blocks?id=eq.${b.id}&updated_at=eq.${encodeURIComponent(b.updated_at)}`, {
        method: 'PATCH', headers: { ...h, Prefer: 'return=representation' },
        body: JSON.stringify({ extra, value: total, eur_value: total, updated_at: now }) });
      const saved = await u.json().catch(() => null);
      if (!u.ok) throw new Error(`no se pudo guardar (HTTP ${u.status})`);
      if (!Array.isArray(saved) || !saved.length) out.skipped.push(`${b.id}: cambiada desde la app mientras se actualizaba; se reintenta mañana o al abrir la app`);
    } catch (e) { out.failed.push(`cuenta ${b.id}: ${String(e.message || e).slice(0, 160)}`); console.error('[precios]', b.id, e); }
  }
  return out;
}
