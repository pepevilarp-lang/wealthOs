// /api/news.js — Proxy RSS para noticias financieras
// No requiere API key — simplemente proxea feeds RSS para evitar CORS

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const feedUrl = req.query.url;
  if (!feedUrl) return res.status(400).json({ error: 'Missing ?url= parameter' });

  try {
    const r = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WealthOS/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      },
      signal: AbortSignal.timeout(8000)
    });
    
    if (!r.ok) {
      return res.status(r.status).json({ error: `Feed returned ${r.status}` });
    }
    
    const text = await r.text();
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300'); // Cache 5 min
    res.status(200).send(text);
  } catch (err) {
    console.error('[/api/news]', err.message);
    res.status(500).json({ error: err.message });
  }
}
