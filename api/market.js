// /api/market — proxy de datos de mercado. Las claves de Twelve Data, Finnhub y FMP viven SOLO aquí
// (variables de entorno de Vercel) y nunca llegan al navegador. Solo atiende a usuarios con sesión.
//
// Formato (pensado para no reescribir las URLs de la app): /api/market?p=<proveedor>&u=<ruta>?<parámetros>
// Ejemplo: /api/market?p=td&u=/quote?symbol=VUAA&apikey=servidor
//   · p: td (Twelve Data) | fh (Finnhub) | fmp (Financial Modeling Prep)
//   · u: ruta del proveedor. Solo se admiten las rutas de la lista.
//   · apikey/token que mande el navegador se ignoran: se pone la clave real del servidor.
// Variables: TWELVEDATA_KEY, FINNHUB_KEY, FMP_KEY.
import { sessionUser } from './_lib/session.js';

const PROVIDERS = {
  td:  { base: 'https://api.twelvedata.com', env: 'TWELVEDATA_KEY', keyParam: 'apikey',
         paths: [/^\/quote$/, /^\/time_series$/, /^\/symbol_search$/, /^\/price$/] },
  fh:  { base: 'https://finnhub.io/api/v1', env: 'FINNHUB_KEY', keyParam: 'token',
         paths: [/^\/quote$/, /^\/search$/, /^\/news$/, /^\/company-news$/, /^\/stock\/profile2$/] },
  fmp: { base: 'https://financialmodelingprep.com/api/v3', env: 'FMP_KEY', keyParam: 'apikey',
         paths: [/^\/quote\/[A-Za-z0-9.^=\-]{1,24}$/, /^\/search$/] },
};

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Solo GET' });
  let uid;
  try { uid = await sessionUser(req); }
  catch (e) { return res.status(500).json({ error: e.message }); }
  if (!uid) return res.status(401).json({ error: 'Inicia sesión en Orbit para consultar precios.' });

  const q = { ...(req.query || {}) };
  const prov = PROVIDERS[String(q.p || '')];
  if (!prov) return res.status(400).json({ error: 'Proveedor no válido (td, fh o fmp).' });
  const raw = String(q.u || '');
  const [path, inner = ''] = raw.split('?');
  if (!prov.paths.some(re => re.test(path))) return res.status(400).json({ error: `Ruta no permitida: ${path}` });
  const key = process.env[prov.env];
  if (!key) return res.status(500).json({ error: `Falta ${prov.env} en Vercel` });

  const params = new URLSearchParams(inner);
  for (const [k, v] of Object.entries(q)) if (!['p', 'u'].includes(k)) params.set(k, Array.isArray(v) ? v[0] : String(v));
  params.delete('apikey'); params.delete('token');
  params.set(prov.keyParam, key);

  try {
    const r = await fetch(`${prov.base}${path}?${params.toString()}`, { signal: AbortSignal.timeout(9000) });
    const text = await r.text();
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(r.status).send(text);
  } catch (e) {
    return res.status(502).json({ error: `El proveedor no respondió: ${e.message}` });
  }
}
