// /api/claude.js — Proxy para Claude API con soporte Vision
// Variables de entorno requeridas: ANTHROPIC_API_KEY (o CLAUDE_API_KEY)

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed. Use POST.' } });
  }

  // Comprobar API key
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.error('[/api/claude] FALTA variable de entorno ANTHROPIC_API_KEY');
    return res.status(500).json({
      error: {
        message: 'ANTHROPIC_API_KEY no configurada en Vercel. Ve a Settings → Environment Variables y añádela.',
        type: 'missing_api_key'
      }
    });
  }

  if (!apiKey.startsWith('sk-ant-')) {
    console.error('[/api/claude] API key tiene formato incorrecto');
    return res.status(500).json({
      error: {
        message: 'ANTHROPIC_API_KEY tiene formato inválido. Debe empezar por "sk-ant-".',
        type: 'invalid_api_key_format'
      }
    });
  }

  try {
    const body = req.body || {};
    const { model, max_tokens, messages, system, temperature } = body;

    if (!model || !messages) {
      return res.status(400).json({
        error: { message: 'Faltan campos: model y messages son obligatorios.' }
      });
    }

    // Construir payload
    const payload = {
      model,
      max_tokens: max_tokens || 2000,
      messages,
    };
    if (system) payload.system = system;
    if (temperature !== undefined) payload.temperature = temperature;

    console.log(`[/api/claude] Llamando a Anthropic API con modelo: ${model}, max_tokens: ${payload.max_tokens}`);

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });

    const responseText = await r.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseErr) {
      console.error('[/api/claude] Respuesta no es JSON:', responseText.slice(0, 500));
      return res.status(500).json({
        error: {
          message: 'La API de Anthropic devolvió una respuesta no-JSON.',
          raw: responseText.slice(0, 500)
        }
      });
    }

    if (!r.ok) {
      console.error('[/api/claude] Anthropic devolvió error:', r.status, data);
      return res.status(r.status).json({
        error: data.error || { message: `Anthropic API error ${r.status}` }
      });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(data);
  } catch (err) {
    console.error('[/api/claude] Excepción:', err);
    return res.status(500).json({
      error: {
        message: err.message || 'Internal server error',
        type: 'proxy_exception'
      }
    });
  }
}
