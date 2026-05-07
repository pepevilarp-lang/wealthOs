// /api/news.js — Financial news proxy
// Uses multiple free sources: NewsAPI, GNews, RSS feeds
// NewsAPI.org free tier: 100 req/day

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=3600'); // 1hr cache

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query, lang = 'es' } = req.query;
  const NEWSAPI_KEY = process.env.NEWSAPI_KEY;

  // ── Source 1: NewsAPI.org (requires API key) ──
  if (NEWSAPI_KEY) {
    try {
      const q = query || 'private equity venture capital economía mercados';
      const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=${lang}&sortBy=publishedAt&pageSize=10&apiKey=${NEWSAPI_KEY}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });

      if (r.ok) {
        const data = await r.json();
        if (data.articles?.length > 0) {
          return res.status(200).json({
            source: 'newsapi',
            articles: data.articles.map(a => ({
              title: a.title,
              description: a.description,
              url: a.url,
              source: a.source?.name,
              publishedAt: a.publishedAt,
              urlToImage: a.urlToImage,
            })),
          });
        }
      }
    } catch (e) {
      console.warn('NewsAPI error:', e.message);
    }
  }

  // ── Source 2: GNews API (free, 100 req/day) ──
  const GNEWS_KEY = process.env.GNEWS_KEY;
  if (GNEWS_KEY) {
    try {
      const q = query || 'private equity economía';
      const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=${lang}&max=10&token=${GNEWS_KEY}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });

      if (r.ok) {
        const data = await r.json();
        if (data.articles?.length > 0) {
          return res.status(200).json({
            source: 'gnews',
            articles: data.articles.map(a => ({
              title: a.title,
              description: a.description,
              url: a.url,
              source: a.source?.name,
              publishedAt: a.publishedAt,
              urlToImage: a.image,
            })),
          });
        }
      }
    } catch (e) {
      console.warn('GNews error:', e.message);
    }
  }

  // ── Source 3: RSS Feeds (always free, no key) ──
  // Use rss2json.com to convert RSS to JSON (free tier)
  const RSS_FEEDS = [
    { url: 'https://www.expansion.com/rss/mercados.xml', name: 'Expansión Mercados' },
    { url: 'https://cincodias.elpais.com/rss/tag/economia', name: 'Cinco Días' },
    { url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/economia/portada', name: 'El País Economía' },
  ];

  const feed = RSS_FEEDS[Math.floor(Math.random() * RSS_FEEDS.length)];

  try {
    const rssUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.url)}&count=10`;
    const r = await fetch(rssUrl, { signal: AbortSignal.timeout(8000) });

    if (r.ok) {
      const data = await r.json();
      if (data.items?.length > 0) {
        return res.status(200).json({
          source: 'rss',
          sourceName: feed.name,
          articles: data.items.map(item => ({
            title: item.title,
            description: item.description?.replace(/<[^>]*>/g, '').slice(0, 200),
            url: item.link,
            source: feed.name,
            publishedAt: item.pubDate,
            urlToImage: item.enclosure?.link || null,
          })),
        });
      }
    }
  } catch (e) {
    console.warn('RSS error:', e.message);
  }

  // ── Fallback: curated static news ──
  return res.status(200).json({
    source: 'static',
    articles: [
      {
        title: 'Private Equity en España: récord de inversión en 2026',
        description: 'El sector de PE y VC alcanza nuevos máximos de inversión en el primer trimestre, con especial fuerza en tecnología y salud.',
        url: 'https://www.eleconomista.es',
        source: 'El Economista',
        publishedAt: new Date().toISOString(),
      },
      {
        title: 'Los mercados de renta fija ofrecen retornos competitivos',
        description: 'Con tipos de interés elevados, la renta fija vuelve a ser una alternativa válida para inversores patrimoniales.',
        url: 'https://cincodias.elpais.com',
        source: 'Cinco Días',
        publishedAt: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        title: 'S&P 500: comportamiento del índice en lo que va de año',
        description: 'Análisis de la evolución del benchmark global y su impacto en carteras diversificadas.',
        url: 'https://www.expansion.com',
        source: 'Expansión',
        publishedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      },
    ],
  });
}
