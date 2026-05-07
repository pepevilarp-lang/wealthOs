// /api/claude.js — Proxy a Groq con manejo adecuado de documentos
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'AI_NOT_CONFIGURED',
      message: 'GROQ_API_KEY no está configurada en Vercel.',
      help: 'Vercel → Settings → Environment Variables → Add GROQ_API_KEY → Redeploy',
    });
  }

  try {
    const inMessages = req.body?.messages || [];

    // Flatten document/image blocks to text — Groq Llama doesn't accept multimodal
    // The CLIENT must extract PDF text before sending. If a PDF block arrives without
    // pre-extracted text, we tell the user explicitly.
    const messages = inMessages.map(msg => {
      if (typeof msg.content === 'string') return msg;
      if (!Array.isArray(msg.content)) return msg;

      const parts = [];
      for (const c of msg.content) {
        if (c.type === 'text' && c.text) parts.push(c.text);
        else if (c.type === 'document') {
          if (c.extractedText) {
            parts.push(`[CONTENIDO DEL PDF EXTRAÍDO]\n${c.extractedText.slice(0, 12000)}\n[FIN DEL PDF]`);
          } else {
            parts.push('[Se adjuntó un PDF pero no se pudo extraer texto. Pídele al usuario los datos clave.]');
          }
        } else if (c.type === 'image') {
          parts.push('[Imagen adjunta — no puedo leer imágenes en este modo. Pídele al usuario los datos visibles en la imagen.]');
        }
      }
      return { role: msg.role, content: parts.join('\n\n') };
    });

    const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: req.body?.model || 'llama-3.3-70b-versatile',
        messages,
        max_tokens: req.body?.max_tokens || 1000,
        temperature: req.body?.temperature ?? 0.3,
      }),
    });

    const data = await groqResp.json();

    if (!groqResp.ok) {
      return res.status(groqResp.status).json({
        error: 'GROQ_ERROR',
        status: groqResp.status,
        message: data.error?.message || 'Error en Groq',
        details: data,
      });
    }

    // Return Claude-shaped response
    return res.status(200).json({
      content: [{ type: 'text', text: data.choices?.[0]?.message?.content || '' }],
      model: data.model,
      usage: data.usage,
    });
  } catch (err) {
    return res.status(500).json({
      error: 'PROXY_ERROR',
      message: err.message,
    });
  }
}
