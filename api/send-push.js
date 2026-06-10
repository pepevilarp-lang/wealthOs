// send-push.js — resumen diario personalizado. Disparado por cron (vercel.json).
// ENV: VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT, SUPABASE_URL, SUPABASE_SERVICE_ROLE, FINNHUB_KEY, (opc) CRON_SECRET
import webpush from 'web-push';

async function topNews() {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${process.env.FINNHUB_KEY}`);
    if (!r.ok) return [];
    const a = await r.json();
    return Array.isArray(a) ? a.filter(x => x.headline).slice(0, 3) : [];
  } catch (_) { return []; }
}

export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'no autorizado' });
  }
  const SU = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE;
  if (!SU || !SR) return res.status(500).json({ error: 'Falta Supabase' });
  if (!process.env.VAPID_PUBLIC || !process.env.VAPID_PRIVATE) return res.status(500).json({ error: 'Falta VAPID' });

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:hola@orbit.app', process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);

  const news = await topNews();
  const firstHeadline = news.length ? news[0].headline : '';

  const subsRes = await fetch(`${SU}/rest/v1/push_subscriptions?select=endpoint,subscription,name`, {
    headers: { apikey: SR, Authorization: `Bearer ${SR}` }
  });
  const rows = await subsRes.json();
  if (!Array.isArray(rows)) return res.status(500).json({ error: 'No se pudieron leer suscripciones', detail: rows });

  let sent = 0, removed = 0;
  await Promise.all(rows.map(async (row) => {
    try {
      const nm = (row.name || '').trim();
      const title = nm ? `Buenos días, ${nm} ☀️` : 'Buenos días ☀️';
      const body = firstHeadline
        ? `¡Aquí tienes las noticias del día! ${firstHeadline}`
        : '¡Aquí tienes las noticias del día!';
      const payload = JSON.stringify({ title, body, url: './?goto=insights', tag: 'orbit-daily' });
      await webpush.sendNotification(row.subscription, payload);
      sent++;
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        removed++;
        await fetch(`${SU}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(row.endpoint)}`, {
          method: 'DELETE', headers: { apikey: SR, Authorization: `Bearer ${SR}` }
        });
      }
    }
  }));

  res.status(200).json({ ok: true, sent, removed, total: rows.length });
}
