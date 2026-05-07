// /api/health.js — Endpoint de diagnóstico para verificar que todo funciona
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const checks = {
    timestamp: new Date().toISOString(),
    vercel: { ok: true, region: process.env.VERCEL_REGION || 'unknown' },
    env: {
      GROQ_API_KEY: process.env.GROQ_API_KEY
        ? `✓ present (${process.env.GROQ_API_KEY.slice(0,7)}...${process.env.GROQ_API_KEY.slice(-4)})`
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
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: 'Responde solo: "OK"' }],
          max_tokens: 10,
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
