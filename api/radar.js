// radar.js — tarea diaria (vercel.json): "lo que se cuece" en las acciones de cada usuario.
// Lee las posiciones de bolsa, consulta Finnhub (gratuito) y guarda los avisos en radar_events.
// Instinct los recoge en GET /api/instinct?route=alerts y los envía por WhatsApp sin repetirlos.
// ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE, FINNHUB_KEY, CRON_SECRET (Vercel la envía en cada ejecución).
import { stockTickers, scanTickers, persistEvents, madridDay } from './_lib/radar.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'CRON_SECRET no configurada en Vercel' });
  if ((req.headers['authorization'] || '') !== `Bearer ${secret}`) return res.status(401).json({ error: 'no autorizado' });
  const SU = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE, key = process.env.FINNHUB_KEY;
  if (!SU || !SR) return res.status(500).json({ error: 'Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE' });
  if (!key) return res.status(500).json({ error: 'Falta FINNHUB_KEY: el radar no puede consultar datos' });

  const r = await fetch(`${SU}/rest/v1/blocks?select=user_id,type,deleted,extra&type=eq.bolsa`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
  const blocks = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(blocks)) return res.status(502).json({ error: 'No se pudieron leer las posiciones', status: r.status });

  const byUser = {};
  for (const b of blocks) (byUser[b.user_id] = byUser[b.user_id] || []).push(b);
  const userTickers = Object.fromEntries(Object.entries(byUser).map(([u, bs]) => [u, stockTickers(bs)]));
  const all = [...new Set(Object.values(userTickers).flat())];
  const today = madridDay();
  const { byTicker, errors } = await scanTickers(all, { key, today });

  let stored = 0; const storeErrors = [];
  for (const [uid, tks] of Object.entries(userTickers)) {
    const ev = tks.flatMap(tk => byTicker[tk] || []);
    try { stored += await persistEvents(uid, ev, { SU, SR }); }
    catch (e) { storeErrors.push(String(e.message || e).slice(0, 200)); console.error('[radar]', e); }
  }
  const failed = storeErrors.length > 0;
  res.status(failed ? 502 : 200).json({ ok: !failed, today, users: Object.keys(userTickers).length, tickers: all,
    events: stored, source_errors: errors.slice(0, 10), store_errors: storeErrors });
}
