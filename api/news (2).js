// /api/news — proxy a NewsAPI (evita CORS en producción y no expone la key al cliente)
// Para producción: define NEWS_API_KEY en Vercel (Settings → Environment Variables)
// y, si tu repo es público, borra el valor de fallback de abajo.
export default async function handler(req, res) {
  const key = process.env.NEWS_API_KEY || 'e3cc78f5319b495fa8587a385cfa62bf';

  const q = (req.query.q || '').toString().trim().slice(0, 250);
  const lang = (req.query.lang || '').toString().trim(); // 'es', 'en'... opcional
  const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 20, 50);

  if (!q) {
    res.status(400).json({ status: 'error', message: 'missing q' });
    return;
  }

  try {
    const params = new URLSearchParams({
      q,
      sortBy: 'publishedAt',
      pageSize: String(pageSize),
      apiKey: key,
    });
    if (lang) params.set('language', lang);

    const r = await fetch(`https://newsapi.org/v2/everything?${params.toString()}`, {
      headers: { 'User-Agent': 'OrbitApp/1.0' },
    });
    const data = await r.json();

    // Cache en el edge de Vercel para no quemar la cuota (100 req/día en el plan gratis)
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    res.status(r.ok ? 200 : (r.status || 500)).json(data);
  } catch (e) {
    res.status(500).json({ status: 'error', message: String(e && e.message || e) });
  }
}
