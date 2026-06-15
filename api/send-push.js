// send-push.js — resumen diario personalizado. Disparado por cron (vercel.json).
// ENV: VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT, SUPABASE_URL, SUPABASE_SERVICE_ROLE, FINNHUB_KEY, (opc) CRON_SECRET
import webpush from 'web-push';


export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'no autorizado' });
  }
  const SU = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE;
  if (!SU || !SR) return res.status(500).json({ error: 'Falta Supabase' });
  if (!process.env.VAPID_PUBLIC || !process.env.VAPID_PRIVATE) return res.status(500).json({ error: 'Falta VAPID' });

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:hola@orbit.app', process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);

  const subsRes = await fetch(`${SU}/rest/v1/push_subscriptions?select=endpoint,subscription,name`, {
    headers: { apikey: SR, Authorization: `Bearer ${SR}` }
  });
  const rows = await subsRes.json();
  if (!Array.isArray(rows)) return res.status(500).json({ error: 'No se pudieron leer suscripciones', detail: rows });

  let sent = 0, removed = 0;
  await Promise.all(rows.map(async (row) => {
    try {
      // Solo nombre real de pila. Si parece un email o usuario técnico, no lo usamos.
      let nm = (row.name || '').trim();
      if (nm.includes('@') || /[._0-9]/.test(nm)) nm = '';   // descarta cosas como "aina.martin02"
      nm = nm.split(/\s+/)[0];                                 // solo el primer nombre
      if (nm) nm = nm.charAt(0).toUpperCase() + nm.slice(1).toLowerCase();
      const title = nm ? `Buenos días, ${nm}` : 'Buenos días';
      const body = '¡Aquí tienes las noticias del día!';
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
