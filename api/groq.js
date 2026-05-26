// /api/groq.js — Proxy para Groq API (con anti-spam + retry 429)
// Variable de entorno requerida: GROQ_API_KEY

const lastRequestMap = new Map(); // 🔒 cooldown por IP

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

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: {
        message: 'GROQ_API_KEY no configurada en Vercel',
        type: 'missing_api_key'
      }
    });
  }

  // 🔒 detectar IP del usuario
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.socket?.remoteAddress ||
    'unknown';

  const now = Date.now();
  const last = lastRequestMap.get(ip) || 0;

  // ⛔ cooldown: 5 segundos entre requests por IP
  const COOLDOWN_MS = 5000;

  if (now - last < COOLDOWN_MS) {
    return res.status(429).json({
      error: {
        message: 'Estás haciendo demasiadas solicitudes. Espera unos segundos.',
        type: 'rate_limit_frontend'
      }
    });
  }

  lastRequestMap.set(ip, now);

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const callGroq = async (payload, headers, attempt = 0) => {
    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json();

    // 🔁 retry automático en 429 de Groq
    if (response.status === 429 && attempt < 3) {
      const waitTime = 500 * Math.pow(2, attempt);
      console.warn(`⏳ Groq 429 → retry en ${waitTime}ms`);
      await sleep(waitTime);
      return callGroq(payload, headers, attempt + 1);
    }

    return { response, data };
  };

  try {
    const body = req.body || {};
    const { model, messages, max_tokens, temperature, system } = body;

    if (!model || !messages) {
      return res.status(400).json({
        error: { message: 'Faltan campos: model y messages.' }
      });
    }

    const groqMessages = [];

    if (system) {
      groqMessages.push({ role: 'system', content: system });
    }

    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        groqMessages.push(msg);
      } else if (Array.isArray(msg.content)) {
        const converted = msg.content.map(block => {
          if (block.type === 'image' && block.source?.type === 'base64') {
            return {
              type: 'image_url',
              image_url: {
                url: `data:${block.source.media_type || 'image/png'};base64,${block.source.data}`
              }
            };
          }
          return block;
        });

        groqMessages.push({ role: msg.role, content: converted });
      } else {
        groqMessages.push(msg);
      }
    }

    const payload = {
      model,
      messages: groqMessages,
      max_tokens: max_tokens || 1024
    };

    if (temperature !== undefined) payload.temperature = temperature;
    if (body.compound_custom) payload.compound_custom = body.compound_custom;

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };

    if (model.startsWith('groq/compound')) {
      headers['Groq-Model-Version'] = 'latest';
    }

    console.log(`→ Groq request model=${model}, msgs=${groqMessages.length}`);

    const { response, data } = await callGroq(payload, headers);

    if (!response.ok) {
      return res.status(response.status).json({
        error: {
          message: data.error?.message || 'Groq API error',
          type: data.error?.type || 'groq_error',
          status: response.status
        }
      });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({
      error: {
        message: `Error interno: ${err.message}`,
        type: 'proxy_error'
      }
    });
  }
}
