export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    // Map Claude model to Groq model
    const body = { ...req.body };
    body.model = 'llama-3.3-70b-versatile';

    // Groq doesn't support document/image content blocks — flatten to text
    body.messages = body.messages.map(msg => {
      if (typeof msg.content === 'string') return msg;
      if (Array.isArray(msg.content)) {
        const textParts = msg.content
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('\n');
        const docParts = msg.content
          .filter(c => c.type === 'document' || c.type === 'image')
          .map(c => `[${c.type === 'document' ? 'PDF adjunto' : 'Imagen adjunta'} — extrae los datos financieros que aparezcan]`);
        return { ...msg, content: [...docParts, textParts].join('\n') };
      }
      return msg;
    });

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: body.model,
        messages: body.messages,
        max_tokens: body.max_tokens || 1000,
        temperature: 0.3,
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);

    // Convert Groq response to Claude format
    const claudeFormat = {
      content: [{ type: 'text', text: data.choices?.[0]?.message?.content || '' }],
      model: body.model,
      usage: data.usage,
    };
    return res.status(200).json(claudeFormat);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
