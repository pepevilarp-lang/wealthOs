// /api/groq.js — Proxy para Groq API (texto + visión)
// Variable de entorno requerida: GROQ_API_KEY

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
    console.error('[/api/groq] FALTA variable de entorno GROQ_API_KEY');
    return res.status(500).json({
      error: {
        message: 'GROQ_API_KEY no configurada en Vercel. Ve a Settings → Environment Variables y añádela.',
        type: 'missing_api_key'
      }
    });
  }

  try {
    const body = req.body || {};
    const { model, messages, max_tokens, temperature, system } = body;

    if (!model || !messages) {
      return res.status(400).json({
        error: { message: 'Faltan campos: model y messages son obligatorios.' }
      });
    }

    // Groq usa formato OpenAI: system message va como primer message con role:'system'
    const groqMessages = [];
    if (system) {
      groqMessages.push({ role: 'system', content: system });
    }
    
    // Convertir mensajes — adaptar formato de imagen si viene de Claude format
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        groqMessages.push(msg);
      } else if (Array.isArray(msg.content)) {
        // Puede tener bloques tipo {type:'image', source:{type:'base64',...}} (formato Claude)
        // o tipo {type:'image_url', image_url:{url:...}} (formato OpenAI/Groq)
        const convertedContent = msg.content.map(block => {
          // Formato Claude → convertir a Groq
          if (block.type === 'image' && block.source?.type === 'base64') {
            return {
              type: 'image_url',
              image_url: {
                url: `data:${block.source.media_type || 'image/png'};base64,${block.source.data}`
              }
            };
          }
          // Ya está en formato OpenAI/Groq
          return block;
        });
        groqMessages.push({ role: msg.role, content: convertedContent });
      } else {
        groqMessages.push(msg);
      }
    }

    const payload = {
      model,
      messages: groqMessages,
      max_tokens: max_tokens || 1024,
    };
    if (temperature !== undefined) payload.temperature = temperature;

    console.log(`[/api/groq] → model=${model}, msgs=${groqMessages.length}, max_tokens=${payload.max_tokens}`);

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[/api/groq] Groq API error:', response.status, JSON.stringify(data).slice(0, 500));
      return res.status(response.status).json({
        error: {
          message: data.error?.message || `Groq API error ${response.status}`,
          type: data.error?.type || 'groq_error',
          groq_error: data.error
        }
      });
    }

    // Groq devuelve formato OpenAI: { choices: [{ message: { content: '...' } }] }
    // Normalizamos a formato compatible con extractAIText del frontend
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json(data);

  } catch (err) {
    console.error('[/api/groq] Exception:', err.message);
    res.status(500).json({
      error: {
        message: `Error interno del proxy Groq: ${err.message}`,
        type: 'proxy_error'
      }
    });
  }
}
