// send-push.js — resumen diario personalizado. Disparado por cron (vercel.json).
// ENV: VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT, SUPABASE_URL, SUPABASE_SERVICE_ROLE, CRON_SECRET (obligatoria: Vercel la envía en cada ejecución del cron)
import webpush from 'web-push';


export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'CRON_SECRET no configurada en Vercel' });
  if ((req.headers['authorization'] || '') !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'no autorizado' });
  }
  const SU = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE;
  if (!SU || !SR) return res.status(500).json({ error: 'Falta Supabase' });
  if (!process.env.VAPID_PUBLIC || !process.env.VAPID_PRIVATE) return res.status(500).json({ error: 'Falta VAPID' });

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:hola@orbit.app', process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);

  const subsRes = await fetch(`${SU}/rest/v1/push_subscriptions?select=endpoint,subscription,name&pref_daily=not.is.false`, {
    headers: { apikey: SR, Authorization: `Bearer ${SR}` }
  });
  const rows = await subsRes.json();
  if (!Array.isArray(rows)) return res.status(500).json({ error: 'No se pudieron leer suscripciones', detail: rows });

  let sent = 0, removed = 0, failed = 0;
  const errors = [];
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
        const d = await fetch(`${SU}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(row.endpoint)}`, {
          method: 'DELETE', headers: { apikey: SR, Authorization: `Bearer ${SR}` }
        });
        if (!d.ok) console.error('[send-push] no se pudo borrar una suscripción caducada:', d.status);
      } else {
        failed++;
        errors.push(String((err && (err.statusCode || err.message)) || err).slice(0, 120));
        console.error('[send-push] envío fallido:', err && (err.statusCode || err.message));
      }
    }
  }));

  res.status(failed && !sent ? 502 : 200).json({ ok: failed === 0, sent, removed, failed, errors: errors.slice(0, 5), total: rows.length });
}
