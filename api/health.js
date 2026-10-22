// /api/health.js — Endpoint de diagnóstico para verificar que todo funciona
// Comprueba que la petición viene de la propia app. Los navegadores envían la cabecera
// Origin en las peticiones POST: si viene de otra web, se rechaza. Se compara con la cabecera
// host y con x-forwarded-host, porque detrás del proxy de Vercel puede llegar en cualquiera.
// No sustituye a la autenticación por sesión (pendiente).
function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let originHost;
  try { originHost = new URL(origin).host; } catch { originHost = null; }
  const hosts = [req.headers.host, req.headers['x-forwarded-host']]
    .filter(Boolean)
    .flatMap(h => String(h).split(',').map(x => x.trim().toLowerCase()));
  const ok = !!originHost && hosts.includes(originHost.toLowerCase());
  if (!ok) console.warn('[origen rechazado]', { origin, host: req.headers.host, xfh: req.headers['x-forwarded-host'] });
  return ok;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'origen no permitido' });

  const checks = {
    timestamp: new Date().toISOString(),
    vercel: { ok: true, region: process.env.VERCEL_REGION || 'unknown' },
    env: {
      // Nunca devolver fragmentos de ninguna clave: solo si está configurada.
      SUPABASE_SERVICE_ROLE: process.env.SUPABASE_SERVICE_ROLE ? '✓ present' : '✗ falta (Siri, Instinct y la hoja no funcionarán)',
      CRON_SECRET: process.env.CRON_SECRET ? '✓ present' : '✗ falta (el resumen diario no se envía)',
      VAPID_PUBLIC: process.env.VAPID_PUBLIC ? '✓ present' : '✗ falta (no se pueden activar notificaciones)',
      VAPID_PRIVATE: process.env.VAPID_PRIVATE ? '✓ present' : '✗ falta (no se pueden enviar notificaciones)',
      NEWS_API_KEY: process.env.NEWS_API_KEY ? '✓ present' : '✗ falta (sin noticias)',
      FINNHUB_KEY: process.env.FINNHUB_KEY ? '✓ present' : '✗ falta (el servidor no puede preparar las noticias del día si no abres la app)',
      GROQ_API_KEY: process.env.GROQ_API_KEY
        ? '✓ present'
        : '✗ MISSING — añade GROQ_API_KEY en Vercel Settings → Environment Variables',
    },
    groq: { tested: false, ok: false, error: null, model: null, response: null },
  };

  // Test live Groq call
  if (process.env.GROQ_API_KEY) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL_TEXT || 'openai/gpt-oss-120b',
          messages: [{ role: 'user', content: 'Responde solo: "OK"' }],
          max_tokens: 256,
          reasoning_effort: 'low',
          include_reasoning: false,
          temperature: 0,
        }),
      });
      checks.groq.tested = true;
      checks.groq.status = r.status;
      const data = await r.json();
      if (r.ok) {
        checks.groq.ok = true;
        checks.groq.model = data.model;
        checks.groq.response = data.choices?.[0]?.message?.content || '';
      } else {
        checks.groq.error = data.error?.message || JSON.stringify(data);
      }
    } catch (e) {
      checks.groq.tested = true;
      checks.groq.error = `Network error: ${e.message}`;
    }
  } else {
    checks.groq.error = 'No API key configured';
  }

  const allOk = process.env.GROQ_API_KEY && checks.groq.ok;
  return res.status(allOk ? 200 : 503).json(checks);
}
