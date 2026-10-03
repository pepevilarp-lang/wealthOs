// /api/groq.js — Proxy para Groq API (con anti-spam + retry 429)
// Variable de entorno requerida: GROQ_API_KEY
// Protecciones: solo peticiones desde la propia app, lista cerrada de modelos,
// tope de tokens, traducción de modelos retirados. Pendiente: exigir la sesión de Supabase del usuario.
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

// ── Modelos ─────────────────────────────────────────────────────────────────
// Groq retira modelos periódicamente (https://console.groq.com/docs/deprecations).
// La app sigue pidiendo los nombres antiguos; aquí se traducen a los sustitutos oficiales.
// Para cambiar de modelo sin tocar código: variables GROQ_MODEL_TEXT / GROQ_MODEL_VISION en Vercel.
const MODEL_TEXT   = process.env.GROQ_MODEL_TEXT   || 'openai/gpt-oss-120b';
const MODEL_VISION = process.env.GROQ_MODEL_VISION || 'qwen/qwen3.8-27b';

const RETIRED_TO_CURRENT = {
  'llama-3.3-70b-versatile': MODEL_TEXT,                     // retirado el 16/08/2026
  'meta-llama/llama-4-scout-17b-16e-instruct': MODEL_VISION, // retirado el 17/07/2026
};
// Retirados el 21/09/2026 SIN sustituto. Se usaban para búsqueda web (noticias con URL, datos
// macro "reales"). Un modelo sin acceso a internet inventaría esos datos: se rechazan.
const WEB_SEARCH_RETIRED = new Set(['groq/compound', 'groq/compound-mini']);

const ALLOWED_MODELS = new Set([
  ...Object.keys(RETIRED_TO_CURRENT),
  MODEL_TEXT,
  MODEL_VISION,
]);
const MAX_TOKENS_CAP = 4000;   // la app pide como máximo 3500
const MAX_MESSAGES = 60;

const lastRequestMap = new Map(); // 🔒 cooldown por IP

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') return res.status(204).end();   // sin CORS: solo la propia app

  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ error: { message: 'Origen no permitido.', type: 'forbidden_origin' } });
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

    if (!model || !Array.isArray(messages) || !messages.length) {
      return res.status(400).json({
        error: { message: 'Faltan campos: model y messages.' }
      });
    }
    if (WEB_SEARCH_RETIRED.has(model)) {
      return res.status(410).json({ error: {
        message: 'Esta función usaba búsqueda web (groq/compound-mini), retirada por Groq el 21/09/2026 sin sustituto. Desactivada para no mostrar datos inventados.',
        type: 'model_retired_no_replacement'
      } });
    }
    if (!ALLOWED_MODELS.has(model)) {
      console.warn('[groq] modelo no permitido:', model);
      return res.status(400).json({ error: { message: `Modelo no permitido: ${model}`, type: 'model_not_allowed' } });
    }
    if (messages.length > MAX_MESSAGES) {
      return res.status(400).json({ error: { message: 'Demasiados mensajes.', type: 'too_many_messages' } });
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

    // Modelo real: sustituto oficial del retirado; si hay imágenes, siempre el de visión
    const hasImages = groqMessages.some(m => Array.isArray(m.content) && m.content.some(b => b && b.type === 'image_url'));
    const resolved = hasImages ? MODEL_VISION : (RETIRED_TO_CURRENT[model] || model);

    const payload = {
      model: resolved,
      messages: groqMessages,
      max_tokens: Math.min(Number(max_tokens) || 1024, MAX_TOKENS_CAP)
    };
    if (resolved.startsWith('openai/gpt-oss')) {
      // Modelo que razona antes de responder: el razonamiento consume tokens del límite.
      // Esfuerzo bajo, sin devolver el razonamiento, y margen mínimo para que la respuesta no salga vacía.
      payload.reasoning_effort = 'low';
      payload.include_reasoning = false;
      payload.max_tokens = Math.min(Math.max(payload.max_tokens, 1024), MAX_TOKENS_CAP);
    }

    if (temperature !== undefined) payload.temperature = temperature;

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };

    console.log(`→ Groq request model=${model} → ${resolved}, msgs=${groqMessages.length}`);

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

    // Compatibilidad: parte de la app lee data.content[0].text (formato antiguo). Se añade
    // sin quitar el formato de Groq (choices), que es el que usa el resto.
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text === 'string' && !Array.isArray(data.content)) {
      data.content = [{ type: 'text', text }];
    }
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
