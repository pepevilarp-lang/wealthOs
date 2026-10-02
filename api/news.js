// /api/news — proxy a NewsAPI (evita CORS en producción y no expone la key al cliente)
// Producción: define NEWS_API_KEY en Vercel (Settings → Environment Variables).
//
// Regla de producto: SOLO inglés y español. Se hace una llamada por idioma y se
// fusiona + deduplica en el servidor, de modo que al cliente NUNCA le llega otro idioma.
export default async function handler(req, res) {
  const key = process.env.NEWS_API_KEY;
  if (!key) {
    res.status(500).json({ status: 'error', message: 'NEWS_API_KEY no configurada en Vercel' });
    return;
  }

  const q = (req.query.q || '').toString().trim().slice(0, 500);
  const inTitle = String(req.query.inTitle || '') === '1';
  const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 20, 50);

  if (!q) { res.status(400).json({ status: 'error', message: 'missing q' }); return; }

  const LANGS = ['en', 'es']; // regla de producto

  const errors = [];
  try {
    const calls = LANGS.map(async (lang) => {
      const p = new URLSearchParams({
        sortBy: 'publishedAt',
        pageSize: String(pageSize),
        language: lang,
        apiKey: key,
      });
      if (inTitle) p.set('qInTitle', q); else p.set('q', q);
      try {
        const r = await fetch(`https://newsapi.org/v2/everything?${p.toString()}`, {
          headers: { 'User-Agent': 'OrbitApp/1.0' },
        });
        const d = await r.json();
        if (!r.ok || (d && d.status === 'error')) {
          errors.push(`${lang}: ${(d && (d.code || d.message)) || r.status}`);
          return [];
        }
        const arts = (d && d.articles) || [];
        // Etiquetamos el idioma (NewsAPI no lo devuelve por artículo)
        return arts.map((a) => ({ ...a, _lang: lang }));
      } catch (e) { errors.push(`${lang}: ${e.message}`); return []; }
    });

    const results = await Promise.all(calls);
    if (errors.length === LANGS.length) {
      console.error('[news] NewsAPI falló en todos los idiomas:', errors);
      res.status(502).json({ status: 'error', message: 'NewsAPI no respondió', errors });
      return;
    }
    const seen = new Set();
    const merged = [];
    for (const arr of results) {
      for (const a of arr) {
        const key2 = (a.url || a.title || '').split('?')[0];
        if (!key2 || seen.has(key2)) continue;
        if (!a.title || a.title === '[Removed]') continue;
        seen.add(key2);
        merged.push(a);
      }
    }
    // Orden por fecha desc
    merged.sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0));

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    res.status(200).json({ status: 'ok', totalResults: merged.length, articles: merged });
  } catch (e) {
    res.status(500).json({ status: 'error', message: String((e && e.message) || e) });
  }
}
