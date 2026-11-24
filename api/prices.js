// /api/prices — precios de las posiciones de bolsa (POST { positions: [{ ticker, isin, currency, quote_symbol }] }).
// Una sola vía de precios para la app: resuelve cada posición a su símbolo exacto (por ISIN) y cotiza con
// Yahoo Finance; Twelve Data de respaldo para EE. UU. Exige la sesión de Supabase. Ver api/_lib/quotes.js.
import { sessionUser } from './_lib/session.js';
import { quotePositions } from './_lib/quotes.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST con { positions: [...] }' });
  let uid;
  try { uid = await sessionUser(req); }
  catch (e) { return res.status(500).json({ error: e.message }); }
  if (!uid) return res.status(401).json({ error: 'Inicia sesión en Orbit para consultar precios.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const positions = Array.isArray(body.positions) ? body.positions.slice(0, 40) : null;
  if (!positions || !positions.length) return res.status(400).json({ error: 'Faltan las posiciones' });
  const clean = positions.map(p => ({
    ticker: String(p.ticker || '').slice(0, 24), isin: p.isin ? String(p.isin).slice(0, 12) : null,
    currency: p.currency ? String(p.currency).slice(0, 5) : null, priceCurrency: p.priceCurrency ? String(p.priceCurrency).slice(0, 5) : null,
    quote_symbol: p.quote_symbol ? String(p.quote_symbol).slice(0, 24) : null,
  }));
  const quotes = await quotePositions(clean, { tdKey: process.env.TWELVEDATA_KEY });
  res.setHeader('Cache-Control', 'private, max-age=60');
  return res.status(200).json({ quotes, at: new Date().toISOString() });
}
